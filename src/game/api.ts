// Тонкий клиент к серверу игры. Если сервер недоступен, ход считается прямо в браузере
// офлайн-разметчиком и шаблонами: игра проходится и без сети.

import { BEHAVIOR_DICT } from '../engine/behaviors'
import { analyzeOffline, templateLine, walkAwayMove, withContext, withFormalOffer } from '../engine/offline'
import { stateAfter, step } from '../engine/turn'
import type { Difficulty, Offer, Scenario, Tone, TurnRecord } from '../engine/types'
import { loadLab } from './lab/config'

const labHeaders = (): Record<string, string> => {
  const l = typeof window === 'undefined' ? {} : loadLab()
  return l.llm ? { 'x-lab-llm': l.llm } : {}
}

export interface TurnInput {
  scenario: Scenario
  /** сценарий из библиотеки — отправляем id, свой — целиком */
  fromLibrary: boolean
  history: TurnRecord[]
  text: string
  offer?: Offer
  accept?: boolean
  walkAway?: boolean
}

export interface TurnResult {
  record: TurnRecord
  /** откуда разбор и реплика: llm, cache, offline, local (сервер недоступен) */
  source: string
}

async function post<T>(path: string, body: unknown, ms = 90_000): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    // лаборатория (/?lab) может сыграть ход другой моделью
    headers: { 'content-type': 'application/json', ...labHeaders() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  })
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

export async function playTurn(t: TurnInput): Promise<TurnResult> {
  const body = {
    ...(t.fromLibrary ? { scenarioId: t.scenario.id } : { scenario: t.scenario }),
    history: t.history,
    playerText: t.text,
    ...(t.offer ? { offer: t.offer } : {}),
    ...(t.accept ? { accept: true } : {}),
    ...(t.walkAway ? { walkAway: true } : {}),
  }
  try {
    const r = await post<{ record: TurnRecord; sources: { analysis: string; voice: string } }>('/api/turn', body)
    return { record: r.record, source: r.sources.voice === r.sources.analysis ? r.sources.voice : `${r.sources.analysis}/${r.sources.voice}` }
  } catch (e) {
    // 400 и 409 — ошибка в самом ходе, показываем её. Сеть, 5xx, 404/405 статического хостинга без API —
    // играем локально, чтобы игра проходилась и там, где сервера нет вовсе.
    if (e instanceof ApiError && (e.status === 400 || e.status === 409)) throw e
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
  model?: string
  providerError?: string
  /** голос: озвучка и распознавание через SpeechKit, если на сервере есть ключ */
  speech?: { tts: boolean; stt: boolean }
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
