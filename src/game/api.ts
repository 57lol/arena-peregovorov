// Тонкий клиент к серверу игры. Если сервер недоступен, ход считается прямо в браузере
// офлайн-разметчиком и шаблонами: игра проходится и без сети.

import { BEHAVIOR_DICT } from '../engine/behaviors'
import { analyzeOffline, templateLine, walkAwayMove, withContext, withFormalOffer } from '../engine/offline'
import { stateAfter, step } from '../engine/turn'
import type { Difficulty, Offer, Scenario, Tone, TurnRecord } from '../engine/types'
import { loadLab } from './lab/config'

const labHeaders = (): Record<string, string> => {
  const l = typeof window === 'undefined' ? {} : loadLab()
  return { ...(l.llm ? { 'x-lab-llm': l.llm } : {}), ...(l.natural !== undefined ? { 'x-lab-natural': l.natural ? '1' : '0' } : {}) }
}

// Модель реплики по ссылке (ручная проверка моделей): ?llm=yandex до конца вкладки, ?llm=off — как по умолчанию.
// Короткое имя или «провайдер:модель» из VOICE_LLM_ALLOWED на сервере (по умолчанию там только эти три).
const LLM_ALIAS: Record<string, string> = {
  sonnet: 'aitunnel:claude-sonnet-5.5',
  sol: 'aitunnel:gpt-6.1-sol',
  yandex: 'yandex:yandexgpt-5.1',
}
function voiceLlmTest(): string | undefined {
  try {
    const q = new URLSearchParams(location.search).get('llm')
    if (q === 'off') sessionStorage.removeItem('peregovorka.llm')
    else if (q) sessionStorage.setItem('peregovorka.llm', LLM_ALIAS[q] ?? q)
    return sessionStorage.getItem('peregovorka.llm') ?? undefined
  } catch {
    return undefined
  }
}
// запомнить ?llm= сразу при загрузке: игра потом чистит адрес от параметров (share.ts)
if (typeof window !== 'undefined') voiceLlmTest()

export interface TurnInput {
  scenario: Scenario
  /** сценарий из библиотеки — отправляем id, свой — целиком */
  fromLibrary: boolean
  history: TurnRecord[]
  text: string
  reaction?: string
  offer?: Offer
  accept?: boolean
  walkAway?: boolean
  /** голос включён: тело /api/tts без текста — сервер начнёт синтез реплики сразу, как её получит */
  tts?: { voice: string }
}

export interface TurnResult {
  record: TurnRecord
  /** откуда разбор и реплика: llm, cache, offline, local (сервер недоступен) */
  source: string
  /** живой звук реплики (/api/tts/live/…), если просили голос */
  audio?: string
  /** кто его озвучивает, если сервер уже знает: elevenlabs, v3…; fallback — почему не ElevenLabs */
  audioVoice?: { api: string; fallback?: string }
}

/** Начало реплики, как только сервер его проверил: текст и ссылка на звук, который уже синтезируется. */
export interface TurnLine {
  text: string
  audio?: string
}

async function post<T>(path: string, body: unknown, ms = 90_000): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    // лаборатория (/?lab) может сыграть ход другой моделью
    headers: { 'content-type': 'application/json', ...labHeaders() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  })
  // ворота сайта: пропуск истёк, пока вкладка была открыта
  if (r.status === 401) throw new ApiError('Вход на сайт истёк — обновите страницу и войдите снова.', 401)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new ApiError(j?.error ?? `Сервер ответил ${r.status}`, r.status)
  return j as T
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Ответ сервера, который надо показать игроку, а не прятать за игрой без сети: ошибка в ходе, вход истёк, лимит. */
export const shownError = (e: unknown): e is ApiError => e instanceof ApiError && [400, 401, 409, 413, 429].includes(e.status)

type TurnReply = { record: TurnRecord; sources: { analysis: string; voice: string; voiceModel?: string }; audio?: string; audioVoice?: TurnResult['audioVoice'] }

/**
 * Ход потоком: сервер присылает строки JSON — line (начало реплики и ссылка на звук) раньше, чем ход целиком (done).
 * Старый сервер ответит обычным JSON — его и берём.
 */
async function postStream(path: string, body: object, onLine: (l: TurnLine) => void, ms = 90_000): Promise<TurnReply> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...labHeaders() },
    body: JSON.stringify({ ...body, stream: true }),
    signal: AbortSignal.timeout(ms),
  })
  if (!r.ok || !r.headers.get('content-type')?.includes('ndjson')) {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new ApiError(j?.error ?? `Сервер ответил ${r.status}`, r.status)
    return j as TurnReply
  }
  const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += value
    for (let i; (i = buf.indexOf('\n')) >= 0; ) {
      const ev = JSON.parse(buf.slice(0, i)) as { t: string; error?: string } & Partial<TurnLine> & TurnReply
      buf = buf.slice(i + 1)
      if (ev.t === 'line' && ev.text) onLine({ text: ev.text, ...(ev.audio ? { audio: ev.audio } : {}) })
      else if (ev.t === 'done') return ev
      else if (ev.t === 'error') throw new ApiError(ev.error ?? 'Ход не сыгрался', 502)
    }
  }
  throw new ApiError('Ответ сервера оборвался', 502)
}

/** onLine — начало реплики раньше хода целиком (ход идёт потоком). */
export async function playTurn(t: TurnInput, onLine?: (l: TurnLine) => void): Promise<TurnResult> {
  const body = {
    ...(t.fromLibrary ? { scenarioId: t.scenario.id } : { scenario: t.scenario }),
    history: t.history,
    playerText: t.text,
    ...(t.reaction ? { reaction: t.reaction } : {}),
    ...(t.offer ? { offer: t.offer } : {}),
    ...(t.accept ? { accept: true } : {}),
    ...(t.walkAway ? { walkAway: true } : {}),
    ...(t.tts ? { tts: t.tts } : {}),
    ...(typeof window !== 'undefined' && voiceLlmTest() ? { voiceLlm: voiceLlmTest() } : {}),
  }
  try {
    const r = onLine ? await postStream('/api/turn', body, onLine) : await post<TurnReply>('/api/turn', body)
    // проверка модели по ссылке: в консоли видно, кто на самом деле написал реплику (не уложилась — основная)
    if (body.voiceLlm) console.info(`реплика: ${r.sources.voiceModel ?? r.sources.voice} (просили ${body.voiceLlm})`)
    return {
      record: r.record,
      source: r.sources.voice === r.sources.analysis ? r.sources.voice : `${r.sources.analysis}/${r.sources.voice}`,
      ...(r.audio ? { audio: r.audio } : {}),
      ...(r.audioVoice ? { audioVoice: r.audioVoice } : {}),
    }
  } catch (e) {
    // Ошибку хода, истёкший вход и лимит показываем. Сеть, 5xx, 404/405 статического хостинга без API —
    // играем локально, чтобы игра проходилась и там, где сервера нет вовсе.
    if (shownError(e)) throw e
    return { record: localTurn(t), source: 'local' }
  }
}

function localTurn(t: TurnInput): TurnRecord {
  const dict = BEHAVIOR_DICT
  const before = stateAfter(t.scenario, t.history, dict)
  let analysis = t.walkAway
    ? walkAwayMove()
    : withContext(withFormalOffer(analyzeOffline(t.scenario, t.text, dict), t.offer), before, t.history, dict)
  if (t.accept) analysis = { ...analysis, accepts: true }
  const r = step(t.scenario, before, analysis, dict, t.history.map((h) => h.analysis))
  const { line, emotion } = templateLine(t.scenario, r.decision, r.state, before.lastOpponentOffer)
  return { turn: r.state.turn, playerText: t.text, analysis, deltas: r.deltas, decision: r.decision, opponentLine: line, emotion, stateAfter: r.state }
}

export interface Health {
  ok: boolean
  provider: string
  /** режим нейросети под общим бюджетом: pro, lite (с 80%) или offline (100%) */
  mode?: 'pro' | 'lite' | 'offline'
  model?: string
  providerError?: string
  /** голос: озвучка и распознавание через SpeechKit, если на сервере есть ключ; eleven — говорит ElevenLabs */
  speech?: { tts: boolean; stt: boolean; eleven?: boolean }
}

export async function health(): Promise<Health | null> {
  try {
    const r = await fetch('/api/health', { signal: AbortSignal.timeout(4000) })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

export interface GenerateRequest {
  sphere: string
  theme: string
  playerRole: string
  opponentTone: Tone
  /** кто напротив и чего он добивается — ТЗ: «его роль и цели»; пусто — на выбор методиста */
  opponentRole?: string
  opponentGoals?: string
  difficulty: Difficulty
  goals: string
}

export interface GenerateResult {
  scenario: Scenario
  source: 'llm' | 'library'
  attempts: number
  problems: string[]
}

export function generate(req: GenerateRequest): Promise<GenerateResult> {
  // три попытки LLM по 25 секунд плюс проверки
  // пустые роль и цели собеседника не шлём: запрос без них тот же, что и раньше (и кэш тот же)
  const body = { ...req, opponentRole: req.opponentRole?.trim() || undefined, opponentGoals: req.opponentGoals?.trim() || undefined }
  return post<GenerateResult>('/api/scenario/generate', body, 150_000)
}
