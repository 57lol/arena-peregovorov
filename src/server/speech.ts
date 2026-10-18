// Голос: озвучка реплик собеседника (TTS) и распознавание речи игрока (STT).
// Основной голос — ElevenLabs через свой воркер (TTS_PROVIDER=elevenlabs), запасной и голос по умолчанию — Yandex
// SpeechKit, распознавание — SpeechKit. Всё необязательное: нет ключа, лимит, сбой — игрок слышит SpeechKit или
// читает реплику без звука.

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { budget as sharedBudget, type Budget } from './budget'
import { CACHE_DIR, hashOf } from './cache'
import { clientIp, quotaOf, judgeOf, type ClientQuota } from './client'
import { usageMiddleware } from './usage'
import { direct, DIRECT_VERSION, forEleven, forEnglish, isLive, liveMode, liveRole, liveVoiceFor, naturalMode, polish, POLISH_VERSION, spellOut, spokenOf } from './direct'
import { knownAudio } from './eleven-known'
import { ELEVEN_KNOWN } from './eleven-known.data'
import { DAY, HOUR, limiter, clientLimiter, limitOf } from './limits'
import { yandex } from './llm'
import type { Emotion } from '../engine/types'
import { accent, render, resolveStress, unstress, type AskJson } from './stress'
import { stripTags } from './tags'
import { WAIT } from './timeouts'
import { hedge, hedgeDelay } from './sttHedge'
import { looksEnglish } from '../engine/lang'
import { streamConfigured } from './sttStream'
import { castFor, ELEVEN_FORMAT, elevenBody, elevenConnect, elevenRequest, mainTts, MAIN_TTS, mp3Ms, price1k, speechkit, styleFor, ttsStatus, voicesOf, YANDEX_VOICES, type TtsRequest } from './tts'

const STT_URL = 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize'

/** Реплика на английском (дело на английском): русские ударения и правила чтения к ней не применяем, только forEnglish. */
const english = (text: string) => looksEnglish(stripTags(text))

/** «196 р» в распознанном тексте — это рубли, как в листке на столе. */
export const tidyTranscript = (t: string) => t.trim().replace(/(\d)\s*р\.?(?=[\s,.!?]|$)/gu, '$1 ₽')

const EMOTION = z.enum(['neutral', 'pleased', 'happy', 'thinking', 'annoyed', 'angry'])
const TtsBody = z.object({
  text: z.string().trim().min(1).max(1000),
  voice: z.string().min(1).max(60),
  emotion: EMOTION.optional(),
  /** по умолчанию — голос игры; elevenlabs — лаборатория (голос ElevenLabs по id, те же правила) */
  provider: z.enum(['yandex', 'elevenlabs']).default('yandex'),
  api: z.enum(['v1', 'v3']).optional(),
  /** «естественная речь» (режиссёр речи, direct.ts): по умолчанию — как велит NATURAL_SPEECH, лаборатория задаёт явно */
  natural: z.boolean().optional(),
  /** заменить голос на парный голос livetts */
  live: z.boolean().optional(),
  /** тест по ссылке ?tts=eleven: ElevenLabs, даже если основной голос — SpeechKit */
  test: z.enum(['eleven']).optional(),
  /** амплуа лица (PERSONAS.role): livetts берёт его, если голос его умеет */
  role: z.string().max(20).optional(),
  /** кто говорит (портрет): по нему ElevenLabs берёт голос лица (CAST) */
  who: z.string().max(40).optional(),
})
type TtsBody = z.infer<typeof TtsBody>
/** Голос реплики без текста: то, что игра шлёт в /api/turn (tts) — сервер озвучит реплику сам, как только она пишется. */
export type TtsVoice = Omit<TtsBody, 'text' | 'emotion' | 'provider'> & { provider?: string }

export interface SpeechOptions {
  key?: string
  fetch?: typeof fetch
  /** фраз озвучки и распознаваний SpeechKit на один IP в сутки (по умолчанию без лимита: жюри может сидеть за одним IP) */
  ttsPerIp?: number
  sttPerIp?: number
  /** на весь сервер в сутки — чтобы один бот не выел грант */
  perDay?: number
  /** общий бюджет в рублях (LLM_TOTAL_RUB): на 100% голос молчит */
  budget?: Budget
  /** быстрая модель для омографов, которые не решили правила (stress.ts); null — без неё */
  stressAsk?: AskJson | null
}

/**
 * Омографы в незнакомой реплике, которые не решили правила, решает YandexGPT Lite: выбор из вариантов с пояснениями,
 * 24 из 24 на трудных фразах, медиана 0,29 с (~/Arena-materials/final/stress/data/ask_eval.json). Нужна редко: в 713
 * репликах из кэшей правила решили всё сами. Не ответила за STRESS_LLM_MS (500 мс) — вариант по умолчанию.
 * STRESS_LLM=off — без неё.
 */
function stressAsk(env = process.env): AskJson | undefined {
  if (env.STRESS_LLM === 'off' || env.LLM_PROVIDER !== 'yandex' || !env.YANDEX_API_KEY || !env.YANDEX_FOLDER_ID) return undefined
  const llm = yandex(undefined, undefined, env.STRESS_LLM_MODEL ?? env.YANDEX_FALLBACK_MODEL ?? 'yandexgpt-lite')
  const schema = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'array', items: { type: 'integer' } } } }
  return (system, user, ms) => llm.json({ system, user, temperature: 0, maxTokens: 40, timeoutMs: ms, schema: { name: 'stress', schema } })
}

interface Clip {
  audio: Uint8Array<ArrayBuffer>
  ms: number
  cache: 'hit' | 'miss'
  api?: string
  /** ElevenLabs: первый байт и звук целиком, мс от начала синтеза */
  took?: string
}

/** Отказ без сбоя: лимит, очередь, бюджет. В сбои ElevenLabs не идёт. */
class Refusal extends Error {
  status: 403 | 429 | 503
  constructor(message: string, status: 403 | 429 | 503 = 429) {
    super(message)
    this.status = status
  }
}

/** Не больше n синтезов сразу (потоки тарифа ElevenLabs), остальные ждут своей очереди не дольше ms. */
function slots(n: () => number) {
  let busy = 0
  const queue: (() => void)[] = []
  return {
    take(ms: number): Promise<boolean> {
      if (busy < n()) {
        busy++
        return Promise.resolve(true)
      }
      return new Promise((resolve) => {
        const go = () => {
          clearTimeout(timer)
          busy++
          resolve(true)
        }
        const timer = setTimeout(() => {
          queue.splice(queue.indexOf(go), 1)
          resolve(false)
        }, Math.max(0, ms))
        queue.push(go)
      })
    },
    free() {
      busy--
      queue.shift()?.()
    },
  }
}

const CACHE_TTS = join(CACHE_DIR, 'tts')
const fileOf = (key: unknown) => join(CACHE_TTS, `${hashOf(key)}.mp3`)
/** Оплаченный звук не теряем из-за записи в кэш (квота диска на хостинге): предупреждение в лог, звук игроку. */
async function keep(file: string, audio: Uint8Array) {
  try {
    await mkdir(CACHE_TTS, { recursive: true })
    await writeFile(file, audio)
  } catch (e) {
    console.warn(`[speech] не записал кэш ${file}: ${(e as Error).message}`)
  }
}
const read = (file: string) => readFile(file).then((b) => new Uint8Array(b), () => undefined)

/** Звук по мере прихода: кто подключился позже, получает уже пришедшее и дальше по ходу. */
function tee() {
  const chunks: Uint8Array[] = []
  const waiting: (() => void)[] = []
  let ended = false
  const wake = () => waiting.splice(0).forEach((w) => w())
  return {
    chunks,
    get ended() {
      return ended
    },
    push(u: Uint8Array) {
      if (!u.length || ended) return
      chunks.push(u)
      wake()
    },
    end() {
      ended = true
      wake()
    },
    async *read(): AsyncGenerator<Uint8Array> {
      for (let i = 0; ; ) {
        while (i < chunks.length) yield chunks[i++]
        if (ended) return
        await new Promise<void>((r) => waiting.push(r))
      }
    },
  }
}
type Tee = ReturnType<typeof tee>

/** Второй кусок mp3 приклеиваем к первому без своей шапки ID3 (иначе посреди звука — мусорный кадр). */
function noId3(b: Uint8Array): Uint8Array {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return b
  return b.subarray(10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]))
}
const glue = (parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts))

/**
 * Что осталось озвучить, когда начало реплики уже звучит. Сравниваем по словам: регистр, знаки, «ё», ударения
 * и пометки [..] не в счёт (их правят после первого куска, и раньше из-за этого начало звучало дважды).
 * Конец начала переписан — говорим со следующей фразы; переписано почти всё — весь текст, как раньше.
 */
export function spokenTail(whole: string, start: string): string {
  if (whole.startsWith(start)) return whole.slice(start.length).trim()
  const norm = (w: string) => w.toLowerCase().replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]+/gu, '')
  const said = stripTags(unstress(start)).split(/\s+/).map(norm).filter(Boolean)
  if (!said.length) return whole.trim()
  const words = [...stripTagsKeep(whole).matchAll(/\S+/gu)].map((m) => ({ w: norm(unstress(m[0])), end: m.index + m[0].length })).filter((x) => x.w)
  let k = 0
  while (k < said.length && k < words.length && words[k].w === said[k]) k++
  if (k === words.length) return ''
  if (k === said.length) return whole.slice(words[k - 1].end).trim()
  if (k < Math.max(2, said.length * 0.6)) return whole
  // хвост начала переписан: пропускаем до конца фразы, на которой кончилось сказанное
  const after = words[Math.min(said.length, words.length) - 1].end
  const stop = /[.!?…]+/gu
  stop.lastIndex = after - 1
  const m = stop.exec(whole)
  return m ? whole.slice(m.index + m[0].length).trim() : ''
}
/** Пометки [..] — пробелами той же длины: позиции слов совпадают с исходной строкой. */
const stripTagsKeep = (t: string) => t.replace(/(?<![<[])\[[^[\]<>\n]{1,40}\](?!\])/gu, (m) => ' '.repeat(m.length))

export function makeSpeech(opts: SpeechOptions = {}) {
  const env = process.env
  const key = opts.key ?? (env.SPEECH === 'off' ? undefined : env.YANDEX_API_KEY)
  const f = opts.fetch ?? fetch
  const quota = opts.budget ?? sharedBudget()
  const limits = {
    tts: opts.ttsPerIp ?? limitOf('TTS_IP_DAY_LIMIT', Infinity),
    stt: opts.sttPerIp ?? limitOf('STT_IP_DAY_LIMIT', Infinity),
    all: opts.perDay ?? limitOf('SPEECH_DAY_LIMIT', Infinity),
  }
  const count = limiter()
  const clients = clientLimiter(count)
  /** SpeechKit: место для пропуска и сервера на сутки; take — занять. */
  const room = (kind: 'tts' | 'stt', who: ClientQuota) => clients.left(kind, who, limits[kind], DAY) && count.left('all', limits.all, DAY)
  const take = (kind: 'tts' | 'stt', who: ClientQuota) => room(kind, who) && clients.take(kind, who, limits[kind], DAY) && count.take('all', limits.all, DAY)
  // ключ без роли SpeechKit (401/403) — выключаем эту половину до перезапуска, а не долбим API
  const denied = { tts: false, stt: false }
  const deny = (kind: 'tts' | 'stt', status: number | undefined) => {
    if (status !== 401 && status !== 403) return
    denied[kind] = true
    console.warn(`[speech] ${kind}: SpeechKit ответил ${status} — у сервисного аккаунта нет роли ai.speechkit-${kind}.user, выключаю`)
  }

  const yandexTtsReady = () => !!key && !denied.tts
  const primaryTts = () => (env.SPEECH === 'off' ? undefined : mainTts(env))
  const elevenReady = () => env.SPEECH !== 'off' && ttsStatus(env).elevenlabs.ready
  if (env.TTS_PROVIDER && !(MAIN_TTS as readonly string[]).includes(env.TTS_PROVIDER))
    console.warn(`[speech] TTS_PROVIDER=${env.TTS_PROVIDER} игра не берёт (голос OpenAI на проде запрещён): говорит SpeechKit. Основной голос — TTS_PROVIDER=elevenlabs`)

  // ElevenLabs: очередь по потокам тарифа, сбои подряд и пауза после трёх, символы за сутки на весь сайт
  const eleven = { slots: slots(() => limitOf('ELEVEN_CONCURRENCY', 5)), fails: 0, until: 0, usage: { day: '', chars: 0 } }
  const elevenOn = () => primaryTts() === 'elevenlabs' && Date.now() >= eleven.until
  const charsLeft = (n: number) => {
    const today = new Date().toISOString().slice(0, 10)
    if (eleven.usage.day !== today) eleven.usage = { day: today, chars: 0 }
    return eleven.usage.chars + n <= limitOf('ELEVEN_DAILY_CHARS', 20_000)
  }
  // кто сейчас говорит: eleven — браузер берёт фразы-паузы ElevenLabs и не меняет темп голоса
  const status = () => {
    const voice = elevenOn() ? 'elevenlabs' : yandexTtsReady() ? 'speechkit' : null
    return { tts: !!voice || !!primaryTts(), stt: !!key && !denied.stt, voice, ...(voice === 'elevenlabs' ? { eleven: true } : {}), ...(streamConfigured(env) ? { scribe: true } : {}) }
  }

  // Тексты, которые сервер выдал сам: реплики /api/turn, вступления дел, собранные дела. ElevenLabs озвучивает только их.
  const issued = new Map<string, number>()
  const issue = (text: string) => {
    const t = text.trim()
    issued.delete(t)
    issued.set(t, Date.now() + DAY)
    if (issued.size > 5000) issued.delete(issued.keys().next().value!)
  }
  const isIssued = (text: string) => (issued.get(text.trim()) ?? 0) > Date.now()

  const ask = opts.stressAsk === undefined ? stressAsk(env) : opts.stressAsk ?? undefined
  // текст без ударений модели → с ударениями «+» (словарь, правила, нейросеть для омографов — paid); уже стоящие «+»
  // (forEleven) не трогает. Прогрев и запрос клиента ждут одно и то же.
  const accents = new Map<string, Promise<string>>()
  const speakable = (plain: string, paid: boolean): Promise<string> => {
    const use = paid ? ask : undefined
    const k = `${use ? 1 : 0}${plain}`
    let p = accents.get(k)
    if (!p) {
      p = resolveStress(accent(plain), use, WAIT.stress())
      accents.set(k, p)
      if (accents.size > 2000) accents.delete(accents.keys().next().value!)
    }
    return p
  }

  const app = new Hono()
  app.use('*', usageMiddleware())
  // синтезы, которые идут прямо сейчас: файл кэша → звук; второй запрос той же реплики ждёт первый
  const inflight = new Map<string, Promise<Clip>>()
  const elevenJobs = new Map<string, { first: Promise<boolean>; done: Promise<Clip> }>()
  const HEADERS = { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000, immutable', 'access-control-expose-headers': 'x-audio-ms, x-cache, x-tts-api, x-tts-voice, x-tts-fallback, x-tts-ms' }
  const send = (c: Context, clip: Pick<Clip, 'audio' | 'ms'>, extra: Record<string, string>) =>
    c.body(clip.audio, 200, { ...HEADERS, ...(clip.ms ? { 'x-audio-ms': String(clip.ms) } : {}), ...extra })

  // Воркеры иногда возвращают daily cap текстом даже с кодом 200.
  async function checkEleven(r: Response) {
    const mime = r.headers.get('content-type') ?? ''
    if (!r.ok || /json|text\//i.test(mime)) {
      throw Object.assign(new Error(`ElevenLabs → ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`), { status: r.ok ? 502 : r.status })
    }
  }

  /**
   * Синтез ElevenLabs одного файла: кэш, лимиты (charge — с кого списать), место в очереди до deadline, «занято» (429) —
   * один повтор. first — ElevenLabs начал отвечать (или звук уже в кэше), done — звук целиком в кэше и в бюджете.
   */
  function elevenJob(q: TtsRequest, file: string, deadline: number, charge: () => void) {
    let started!: (ok: boolean) => void
    const first = new Promise<boolean>((r) => (started = r))
    const done = (async (): Promise<Clip> => {
      const cached = await read(file)
      if (cached) {
        started(true)
        return { audio: cached, ms: mp3Ms(cached), cache: 'hit' }
      }
      const t0 = Date.now()
      let first = 0
      const chunks: Uint8Array[] = []
      await elevenPiece(q, (u) => {
        if (!chunks.length) { first = Date.now() - t0; started(true) }
        chunks.push(u)
      }, deadline, charge)
      const audio = glue(chunks)
      return { audio, ms: mp3Ms(audio), cache: 'miss', took: `${first},${Date.now() - t0}` }
    })()
    done.catch(() => {
      started(false)
      // Ошибку уже учёл elevenPiece.
    })
    return { first, done }
  }

  /** Сбой ElevenLabs: три подряд — 5 минут говорит SpeechKit. Лимит, очередь и «занято» после повтора — не сбой. */
  function elevenFailed(e: Error & { status?: number }) {
    if (e instanceof Refusal || e.status === 429) return
    console.warn(`[speech] ElevenLabs: ${e.message}`)
    if (++eleven.fails >= 3) {
      eleven.until = Date.now() + 5 * 60_000
      eleven.fails = 0
      console.warn('[speech] ElevenLabs: три сбоя подряд, 5 минут говорим SpeechKit')
    }
  }

  // Куски, которые синтезируются прямо сейчас: заход хода начинают заранее (preheat), ход подхватывает тот же звук —
  // второй запрос того же куска получает уже пришедшее и дальше по мере прихода, второй раз не платим.
  const piecesNow = new Map<string, { chunks: Uint8Array[]; listeners: Set<(u: Uint8Array) => void>; done: Promise<void> }>()

  /** Кусок реплики голосом ElevenLabs потоком: звук отдаём по мере прихода (onChunk), «занято» (429) — один повтор. */
  async function elevenPiece(q: TtsRequest, onChunk: (u: Uint8Array) => void, deadline: number, charge: () => void): Promise<void> {
    const file = fileOf({ p: 'elevenlabs', fmt: ELEVEN_FORMAT, voice: q.voice, body: elevenBody(q, env) })
    const now = piecesNow.get(file)
    if (now) {
      for (const u of now.chunks) onChunk(u)
      now.listeners.add(onChunk)
      try {
        return await now.done
      } finally {
        now.listeners.delete(onChunk)
      }
    }
    const entry = { chunks: [] as Uint8Array[], listeners: new Set([onChunk]), done: Promise.resolve() }
    entry.done = synthPiece(q, file, (u) => {
      entry.chunks.push(u)
      for (const l of entry.listeners) l(u)
    }, deadline, charge)
    piecesNow.set(file, entry)
    try {
      await entry.done
    } finally {
      piecesNow.delete(file)
    }
  }

  async function synthPiece(q: TtsRequest, file: string, onChunk: (u: Uint8Array) => void, deadline: number, charge: () => void): Promise<void> {
    const body = elevenBody(q, env)
    const cached = await read(file)
    if (cached) { onChunk(cached); return }
    if (!charsLeft(body.text.length)) throw new Refusal('ElevenLabs: символы на сегодня кончились')
    const usage = eleven.usage
    usage.chars += body.text.length
    let reservation: Awaited<ReturnType<Budget['reserveTts']>>
    let occupied = false, accepted = false
    try {
      reservation = await quota.reserveTts(body.text.length, false, body.text.length / 1000 * price1k(body.model_id, env))
      if (!reservation) throw new Refusal('Озвучка на сегодня закончилась')
      charge()
      occupied = await eleven.slots.take(deadline - Date.now())
      if (!occupied) throw new Refusal('ElevenLabs: все потоки заняты')
      for (let attempt = 0; ; attempt++) {
        const r = await elevenRequest(q, f, env)
        if (r.status === 429 && attempt === 0) {
          await r.body?.cancel()
          await new Promise((ok) => setTimeout(ok, 400))
          continue
        }
        await checkEleven(r)
        // Принятый синтез может быть оплачен даже при обрыве тела.
        accepted = true
        const chunks: Uint8Array[] = []
        for await (const u of r.body!) {
          chunks.push(u)
          onChunk(u)
        }
        const audio = glue(chunks)
        if (audio.length < 500) throw new Error('ElevenLabs: пустой ответ')
        eleven.fails = 0
        // В том числе опоздавший звук: переключение игрока на SpeechKit его не теряет.
        await keep(file, audio)
        return
      }
    } catch (e) {
      elevenFailed(e as Error)
      throw e
    } finally {
      if (occupied) eleven.slots.free()
      if (!accepted) {
        usage.chars -= body.text.length
        await reservation?.release()
      }
    }
  }

  // Реплики, которые озвучиваются прямо сейчас: id → звук по мере синтеза (GET /api/tts/live/:id);
  // голос + текст на экране → тот же звук целиком (для /api/tts старого клиента — второй раз не синтезируем).
  interface LiveSound {
    out: Tee
    head: Promise<{ api: string; voice: string; fallback?: string; error?: string; took?: string }>
    done: Promise<Clip | undefined>
  }
  const lives = new Map<string, LiveSound>()
  const livesByText = new Map<string, LiveSound>()
  const textKey = (voice: string, who: string | undefined, screen: string) => `${voice}|${who ?? ''}|${screen.trim()}`

  /**
   * Озвучка реплики, пока модель её дописывает. first — начало реплики (прошло проверку): ElevenLabs начинает сразу;
   * finish — реплика целиком: после начала синтезируем остаток и приклеиваем к нему, звук целиком ложится
   * в кэш. Без first — вся реплика одним куском. ElevenLabs не начал отвечать за WAIT.elevenFirst или его нет —
   * реплика целиком голосом SpeechKit. Звук идёт по url с первых байт.
   */
  // англицизмы и сокращения — как их говорят (forEleven), ударения — знаком U+0301 (render), пометки модели остаются
  async function livePrep(text: string, voice: string, who: string | undefined, roomy: boolean): Promise<TtsRequest> {
    if (english(text)) return { text: forEnglish(unstress(text), 'eleven').replace(/[«»"]/g, ''), voice, who, live: true }
    const marked = await speakable(forEleven(unstress(text)), roomy)
    return { text: render(spellOut(marked), 'eleven').replace(/[«»"]/g, ''), voice, who, live: true }
  }

  /**
   * Заход хода (первые слова ответа) голосом, пока игрок ещё в паузе: синтез начинается заранее, тем же голосом и
   * с теми же лимитами, что у живой реплики. Ход с тем же заходом подхватит этот звук (piecesNow, кэш) без второй оплаты.
   */
  function heater(b: TtsVoice, c: Context): ((text: string) => void) | undefined {
    const asIs = !b.provider && b.api === undefined && b.natural === undefined && b.live === undefined
    if (env.SPEECH === 'off' || !asIs || !(elevenOn() || (b.test === 'eleven' && elevenReady())) || Date.now() < eleven.until) return undefined
    const who = quotaOf(c)
    const voice = castFor(b.who, b.voice, env)
    const perSession = limitOf('ELEVEN_SESSION_HOUR_LIMIT', 60), perIp = limitOf('ELEVEN_IP_DAY_LIMIT', 300)
    let charged = false
    const charge = () => {
      if (charged) return
      if (!clients.take('el:s', who, perSession, HOUR) || !clients.take('el:day', who, perIp, DAY)) throw new Refusal('Лимит голоса ElevenLabs')
      charged = true
    }
    elevenConnect(f, env)
    return (text) => {
      const roomy = clients.left('el:s', who, perSession, HOUR) && clients.left('el:day', who, perIp, DAY)
      void livePrep(text, voice, b.who, roomy)
        .then((q) => elevenPiece({ ...q, opener: true }, () => {}, Date.now() + WAIT.elevenFirst(), charge))
        .catch((e: Error) => console.warn(`[speech] заход заранее: ${e.message}`))
    }
  }

  function live(b: TtsVoice, c: Context) {
    if (env.SPEECH === 'off') return undefined
    const asIs = !b.provider && b.api === undefined && b.natural === undefined && b.live === undefined
    const el = asIs && (elevenOn() || (b.test === 'eleven' && elevenReady()))
    if (!el && !yandexTtsReady()) return undefined
    const id = randomUUID()
    if (el) elevenConnect(f, env)
    const out = tee()
    // когда в поток ушёл первый байт звука — для строки задержек хода в журнале
    let firstAt: number | undefined
    const push0 = out.push
    out.push = (u: Uint8Array) => {
      if (firstAt === undefined && u.length) firstAt = Date.now()
      push0(u)
    }
    const who = quotaOf(c)
    const voice = el ? castFor(b.who, b.voice, env) : b.voice
    const perSession = limitOf('ELEVEN_SESSION_HOUR_LIMIT', 60), perIp = limitOf('ELEVEN_IP_DAY_LIMIT', 300)
    let roomy: boolean | undefined
    let charged = false
    const charge = () => {
      if (charged) return
      if (!clients.take('el:s', who, perSession, HOUR) || !clients.take('el:day', who, perIp, DAY)) throw new Refusal('Лимит голоса ElevenLabs')
      charged = true
    }
    const prep = (text: string) => {
      roomy ??= clients.left('el:s', who, perSession, HOUR) && clients.left('el:day', who, perIp, DAY)
      return livePrep(text, voice, b.who, roomy)
    }
    let firstText: string | undefined
    let firstOpener = false
    // куски после начала (продолжение после захода и остаток): синтез каждого начинается сразу, параллельно,
    // а байты идут в поток по порядку и по мере прихода — не ждём конца синтеза куска (на v3 это 2–3 с тишины)
    interface Piece { text: string; chunks: Uint8Array[]; ended: boolean; error?: unknown; wake?: () => void }
    const extras: Piece[] = []
    // куски после начала встают в очередь ElevenLabs только после того, как начало зазвучало (или не смогло):
    // иначе при занятой очереди остаток отнял бы место у первых слов
    let firstGo!: () => void
    const firstGone = new Promise<void>((r) => (firstGo = r))
    const startPiece = (text: string): Piece => {
      const pc: Piece = { text, chunks: [], ended: false }
      void firstGone.then(() => prep(text))
        .then((q) => elevenPiece(q, (u) => { pc.chunks.push(u); pc.wake?.() }, Date.now() + WAIT.eleven(), charge))
        .then(() => {}, (e: unknown) => { pc.error = e })
        .finally(() => { pc.ended = true; pc.wake?.() })
      return pc
    }
    /** Байты куска — в поток, как приходят; первый кусок файла без своей шапки ID3. */
    const drain = async (pc: Piece) => {
      for (let i = 0; ; ) {
        while (i < pc.chunks.length) {
          const u = pc.chunks[i]
          out.push(i++ === 0 ? noId3(u) : u)
        }
        if (pc.ended) break
        await new Promise<void>((r) => (pc.wake = r))
      }
      if (pc.error) throw pc.error
    }
    let moreWake: (() => void) | undefined
    let gotFirst!: (t: string) => void
    const firstP = new Promise<string>((r) => (gotFirst = r))
    let gotWhole!: (w: { text: string; emotion?: Emotion }) => void
    const whole = new Promise<{ text: string; emotion?: Emotion }>((r) => (gotWhole = r))
    let known: Awaited<LiveSound['head']> | undefined
    let setHead!: (h: Awaited<LiveSound['head']>) => void
    const head = new Promise<Awaited<LiveSound['head']>>((r) => (setHead = (h) => {
      known = known ? Object.assign(known, h) : h
      r(known)
    }))

    // мс от начала синтеза: подготовка текста (ударения), первый байт ElevenLabs
    const took: number[] = []
    let wholeKnown = false
    const play = async (): Promise<Clip | undefined> => {
      let reason = ''
      let remaining: string | undefined
      let spokenSoFar = ''
      if (el) {
        const start = await Promise.race([firstP, whole.then((w) => w.text)])
        const piece = firstText === start
        let dead = false
        let complete = false
        try {
          // Подготовка и кэш тоже могут отказать — запасной голос подхватит весь текст.
          const ready = piece ? undefined : await read(fileOf({ p: 'elevenlabs', fmt: ELEVEN_FORMAT, voice, body: elevenBody(await prep(start), env) }))
          if (ready) {
            firstGo()
            setHead({ api: 'elevenlabs', voice })
            out.push(ready)
            out.end()
            return { audio: ready, ms: mp3Ms(ready), cache: 'hit' }
          }
          const t0 = Date.now()
          let heard!: () => void
          const firstByte = new Promise<boolean>((r) => (heard = () => { firstGo(); r(true) }))
          // Ошибка обработана сразу: whole может прийти заметно позже первого куска.
          const prepStart = () => prep(start).then((q) => (piece && firstOpener ? { ...q, opener: true } : q))
          const p1 = prepStart().then((q) => {
            took.push(Date.now() - t0)
            return elevenPiece(q, (u) => {
              if (dead) return
              if (!out.chunks.length) took.push(Date.now() - t0)
              heard()
              out.push(u)
            }, t0 + WAIT.elevenFirst(), charge)
          }).then(() => ({ error: undefined }), (error: unknown) => ({ error }))
          void p1.then(firstGo)
          let timer: ReturnType<typeof setTimeout> | undefined
          const ok = await Promise.race([firstByte, p1.then(() => false), new Promise<boolean>((r) => (timer = setTimeout(r, WAIT.elevenFirst(), false)))])
          clearTimeout(timer)
          if (!ok) {
            void p1.then(async (first) => {
              if (first.error) return
              const w = await whole
              if (!piece) return
              const tail = w.text.startsWith(start) ? w.text.slice(start.length).trim() : ''
              const q = await prepStart()
              const initial = await read(fileOf({ p: 'elevenlabs', fmt: ELEVEN_FORMAT, voice, body: elevenBody(q, env) }))
              if (!initial) return
              const chunks: Uint8Array[] = [initial]
              if (stripTags(tail)) {
                const rest: Uint8Array[] = []
                await elevenPiece(await prep(tail), (u) => rest.push(u), Date.now() + WAIT.eleven(), charge)
                chunks.push(noId3(glue(rest)))
              }
              if (w.text.startsWith(start)) await keep(fileOf({ p: 'elevenlabs', fmt: ELEVEN_FORMAT, voice, body: elevenBody(await prep(w.text), env) }), glue(chunks))
            }).catch((e: Error) => console.warn(`[speech] поздний звук: ${e.message}`))
            const settled = await Promise.race([p1, Promise.resolve(undefined)])
            throw settled?.error ?? new Refusal('ElevenLabs не успел', 503)
          }
          setHead({ api: 'elevenlabs', voice, took: took.join(',') })
          const first = await p1
          if (first.error) throw first.error
          complete = true
          spokenSoFar = start
          if (piece) {
            // продолжение после захода — по кускам, пока реплика не готова целиком
            for (let i = 0; ; i++) {
              while (i >= extras.length && !wholeKnown) await new Promise<void>((r) => (moreWake = r))
              if (i >= extras.length) break
              await drain(extras[i])
              spokenSoFar = `${spokenSoFar} ${extras[i].text}`
            }
            const w = await whole
            // остаток обычно уже синтезируется (finish); сюда — только если что-то не покрыто кусками
            remaining = spokenTail(w.text, spokenSoFar)
            if (stripTags(remaining)) await drain(startPiece(remaining))
          }
        } catch (e) {
          firstGo()
          dead = true
          reason = (e as Error).message
          // Без подтверждённого куска нельзя узнать озвученные слова: повторяем весь текст.
          remaining = complete ? spokenTail((await whole).text, spokenSoFar) : undefined
          console.warn(`[speech] запасной голос: ${reason}`)
        }
      }
      if (!el || reason) {
        const w = await whole
        const text = remaining ?? w.text
        try {
          if (!yandexTtsReady()) throw new Refusal('Озвучка временно недоступна', 503)
          const clip = await yandexClip(who, { ...b, text: stripTags(unstress(text)), emotion: w.emotion })
          setHead({ api: clip.api ?? 'speechkit', voice: clip.voice, ...(reason ? { fallback: reason } : {}) })
          out.push(out.chunks.length ? noId3(clip.audio) : clip.audio)
          out.end()
          const audio = glue(out.chunks)
          return { ...clip, audio, ms: mp3Ms(audio) || clip.ms }
        } catch (e) {
          setHead({ api: 'none', voice, error: (e as Error).message })
          out.end()
          return undefined
        }
      }
      out.end()
      const audio = glue(out.chunks)
      const w = await whole
      if (!reason) await keep(fileOf({ p: 'elevenlabs', fmt: ELEVEN_FORMAT, voice, body: elevenBody(await prep(w.text), env) }), audio)
      return { audio, ms: mp3Ms(audio), cache: 'miss' }
    }
    const sound: LiveSound = { out, head, done: play().catch((e: Error) => {
      console.warn(`[speech] живой звук: ${e.message}`)
      setHead({ api: 'none', voice, error: e.message })
      out.end()
      return undefined
    }) }
    lives.set(id, sound)
    void sound.done.finally(() => setTimeout(() => {
      lives.delete(id)
      for (const [key, value] of livesByText) if (value === sound) livesByText.delete(key)
    }, 5 * 60_000).unref?.())
    return {
      url: `/api/tts/live/${id}`,
      /** Date.now() первого байта звука в потоке (undefined — звука ещё нет) */
      get firstAt() {
        return firstAt
      },
      /** звук синтезирован целиком (или не удался) */
      ended: sound.done.then(() => Date.now()),
      /** кто уже говорит (elevenlabs, v3…; fallback — почему не ElevenLabs), если звук пошёл */
      get voice() {
        return known && known.api !== 'none' ? { api: known.api, ...(known.fallback ? { fallback: known.fallback } : {}) } : undefined
      },
      /** скоро первая фраза: открыть соединение с воркером, если оно успело закрыться */
      connect() {
        if (el) elevenConnect(f, env)
      },
      /** начало реплики (с пометками для голоса), которое уже не изменится */
      first(text: string, opener = false) {
        if (firstText !== undefined || !stripTags(text)) return
        firstText = text
        firstOpener = opener
        gotFirst(text)
      },
      /** следующий кусок после начала (продолжение после захода): синтез сразу, звучит за предыдущими */
      more(text: string) {
        if (!stripTags(text)) return
        if (firstText === undefined) {
          firstText = text
          return gotFirst(text)
        }
        if (!el || wholeKnown) return
        extras.push(startPiece(text))
        moreWake?.()
      },
      /** реплика целиком (с пометками для голоса) */
      finish(text: string, emotion?: Emotion) {
        // остаток после уже озвученных кусков — в синтез сразу, параллельно с ними (раньше ждал, пока они прозвучат)
        if (el && !wholeKnown && firstText !== undefined && firstText !== text) {
          const tail = spokenTail(text, [firstText, ...extras.map((x) => x.text)].join(' '))
          if (stripTags(tail)) extras.push(startPiece(tail))
        }
        wholeKnown = true
        moreWake?.()
        gotWhole({ text, emotion })
        const k = textKey(b.voice, b.who, stripTags(unstress(text)))
        livesByText.set(k, sound)
        if (livesByText.size > 200) livesByText.delete(livesByText.keys().next().value!)
      },
    }
  }

  /**
   * Реплика голосом ElevenLabs. Только тексты, которые выдал сервер, в пределах лимитов на сессию и IP.
   * Не начал отвечать за WAIT.elevenFirst — пусть говорит SpeechKit, а опоздавший звук ляжет в кэш (лаборатория ждёт
   * сколько нужно). Refusal — почему не ElevenLabs.
   */
  async function sayEleven(c: Context, b: TtsBody, lab: boolean): Promise<Response | Refusal> {
    const t0 = Date.now()
    const voice = lab ? b.voice : castFor(b.who, b.voice, env)
    const ready = await knownAudio(voice, b.text)
    if (ready) return send(c, { audio: ready, ms: mp3Ms(ready) }, { 'x-cache': 'known', 'x-tts-api': 'elevenlabs', 'x-tts-voice': voice })
    if (!isIssued(b.text)) return new Refusal('ElevenLabs озвучивает только реплики игры', 403)
    if (Date.now() < eleven.until) return new Refusal('ElevenLabs на паузе после сбоев', 503)
    const who = quotaOf(c)
    const perSession = limitOf('ELEVEN_SESSION_HOUR_LIMIT', 60), perIp = limitOf('ELEVEN_IP_DAY_LIMIT', 300)
    const roomy = clients.left('el:s', who, perSession, HOUR) && clients.left('el:day', who, perIp, DAY)
    // англицизмы и сокращения — как их говорят (forEleven), ударения — знаком U+0301 (render), пометки модели остаются
    const said = unstress(spokenOf(b.text))
    const spoken = english(said) ? forEnglish(said, 'eleven') : render(spellOut(await speakable(forEleven(said), roomy)), 'eleven')
    const q = { text: spoken.replace(/[«»"]/g, ''), voice, ...(lab ? {} : { who: b.who }) }
    const file = fileOf({ p: 'elevenlabs', fmt: ELEVEN_FORMAT, voice, body: elevenBody(q, env) })
    let job = elevenJobs.get(file)
    const joined = !!job
    if (!job) {
      const charge = () => {
        if (!clients.take('el:s', who, perSession, HOUR) || !clients.take('el:day', who, perIp, DAY)) throw new Refusal('Лимит голоса ElevenLabs')
      }
      job = elevenJob(q, file, t0 + (lab ? WAIT.eleven() : WAIT.elevenFirst()), charge)
      elevenJobs.set(file, job)
      void job.done.catch(() => {}).finally(() => elevenJobs.delete(file))
    }
    if (!lab) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<boolean>((r) => (timer = setTimeout(r, Math.max(0, t0 + WAIT.elevenFirst() - Date.now()), false)))
      const inTime = await Promise.race([job.first, late])
      clearTimeout(timer)
      if (!inTime) return new Refusal('ElevenLabs не успел', 503)
    }
    try {
      const clip = await job.done
      return send(c, clip, { 'x-cache': joined ? 'warm' : clip.cache, 'x-tts-api': 'elevenlabs', 'x-tts-voice': voice, ...(clip.took ? { 'x-tts-ms': clip.took } : {}) })
    } catch (e) {
      return e instanceof Refusal ? e : new Refusal((e as Error).message, 503)
    }
  }

  /** Реплика голосом SpeechKit: свой кэш; лимит и платная разметка ударений — только для того, чего в кэше нет. */
  async function yandexClip(who: ClientQuota, b: Omit<TtsBody, 'provider'>): Promise<Clip & { joined: boolean; voice: string }> {
    const mode = naturalMode(env)
    const natural = b.natural ?? (mode === 'on' || mode === 'live')
    const voice = b.live ?? liveMode(mode) ? liveVoiceFor(b.voice) : b.voice
    // аккуратная разметка (voices+): ударения и редкие паузы; лаборатория с явным natural её не получает
    const neat = !natural && b.natural === undefined && mode === 'voices+'
    // на экране реплика остаётся как есть, размечаем только текст для синтеза; ударения «+» — везде, кроме
    // режиссёра речи и явных настроек лаборатории (там сравнивают голос как есть)
    const plain = b.text.replace(/[«»"]/g, '')
    const clean = stripTags(spokenOf(b.text))
    const en = english(clean)
    const marked = en ? forEnglish(unstress(clean), 'speechkit').replace(/[«»"]/g, '') : !natural && b.natural === undefined ? render((await speakable(unstress(clean), room('tts', who))).replace(/[«»"]/g, ''), 'speechkit') : clean.replace(/[«»"]/g, '')
    // английский — без режиссёра речи и русских пауз: их правила о русском тексте
    const text = en ? marked : natural ? direct(plain, b.emotion) : neat ? polish(marked, b.emotion) : marked
    const style = styleFor(voice, b.emotion)
    // амплуа livetts под эмоцию — и с режиссёром речи, и без него
    const role = isLive(voice) ? liveRole(voice, b.emotion, b.role) : undefined
    const nat = natural ? { n: DIRECT_VERSION, ...(role ? { r: role } : {}) } : neat ? { p: POLISH_VERSION, ...(role ? { r: role } : {}) } : role ? { r: role } : {}
    const v3only = YANDEX_VOICES.find((v) => v.id === voice)?.v3only
    // SpeechKit по умолчанию — v3; TTS_YANDEX_API=v1 возвращает старую озвучку для голосов, которые её знают
    const api = b.api ?? (env.TTS_YANDEX_API === 'v1' && !v3only ? 'v1' : 'v3')
    // ключ v1 — тот же, что у озвучки до v3: старый кэш живёт
    const v1file = fileOf({ v: 1, text, voice, ...style, ...nat })
    const file = api === 'v1' ? v1file : fileOf({ v: 3, text, voice, ...style, ...nat })
    let job = inflight.get(file)
    const joined = !!job
    if (!job) {
      job = (async (): Promise<Clip> => {
        const cached = await read(file)
        if (cached) return { audio: cached, ms: Math.round((cached.length * 8) / 64), cache: 'hit' }
        if (!take('tts', who)) throw new Refusal('Лимит озвучки на сегодня')
        const reservation = await quota.reserveTts(text.length, isLive(voice))
        if (!reservation) throw new Refusal('Озвучка на сегодня закончилась')
        const r = await speechkit(key!, { text, voice, emotion: b.emotion, api: b.api ?? (api === 'v1' ? 'v1' : undefined), liveRole: role }, f).catch(async (e: unknown) => { await reservation.release(); throw e })
        // v3 упал и ответил v1 — кладём под ключ v1, чтобы v3 попробовать снова в следующий раз
        await keep(r.api !== api ? v1file : file, r.audio)
        return { audio: r.audio, ms: r.ms ?? Math.round((r.audio.length * 8) / 64), cache: 'miss', api: r.api }
      })()
      inflight.set(file, job)
      void job.catch(() => {}).finally(() => inflight.delete(file))
    }
    try {
      return { ...(await job), joined, voice }
    } catch (e) {
      if (!(e instanceof Refusal)) deny('tts', (e as { status?: number }).status)
      throw e
    }
  }

  async function sayYandex(c: Context, b: TtsBody, extra: Record<string, string>): Promise<Response> {
    if (!yandexTtsReady()) return c.json({ error: 'Озвучка временно недоступна' }, 503)
    try {
      const clip = await yandexClip(quotaOf(c), b)
      return send(c, clip, { ...extra, 'x-cache': clip.joined ? 'warm' : clip.cache, 'x-tts-voice': clip.voice, ...(clip.api ? { 'x-tts-api': clip.api } : {}) })
    } catch (e) {
      if (e instanceof Refusal) return c.json({ error: e.message }, e.status)
      return c.json({ error: (e as Error).message }, 502)
    }
  }

  /** Каталог голосов и какие провайдеры готовы — для страниц сравнения и лаборатории. Ключей наружу не отдаём. */
  app.get('/api/voices', (c) => {
    const st = ttsStatus({ ...env, YANDEX_API_KEY: key })
    if (denied.tts) st.yandex.ready = false
    return c.json({ yandex: { ...st.yandex, voices: voicesOf('yandex') }, elevenlabs: { ...st.elevenlabs, voices: voicesOf('elevenlabs') } })
  })

  app.post('/api/tts', bodyLimit({ maxSize: 8 * 1024 }), async (c) => {
    const b = TtsBody.parse(await c.req.json())
    const lab = b.provider === 'elevenlabs'
    if (lab && env.LAB === 'off') return c.json({ error: 'Лаборатория выключена' }, 403)
    if (lab && !elevenReady()) return c.json({ error: `Нужен ${ttsStatus(env).elevenlabs.need}` }, 503)
    if (!voicesOf(b.provider).some((v) => v.id === b.voice)) return c.json({ error: 'Нет такого голоса' }, 400)
    // основной голос ElevenLabs (или тест ?tts=eleven): игра шлёт голос SpeechKit и лицо, сервер берёт голос лица.
    // Лаборатория (явные api/natural/live) его не трогают. Не вышло — говорит SpeechKit.
    const asIs = !lab && b.api === undefined && b.natural === undefined && b.live === undefined
    // эту реплику уже озвучивает /api/turn (живой звук) — отдаём тот же звук целиком, второй раз не синтезируем
    const now = asIs ? livesByText.get(textKey(b.voice, b.who, b.text)) : undefined
    const ready = now && (await now.done)
    if (now && ready) {
      const h = await now.head
      return send(c, ready, { 'x-cache': 'warm', 'x-tts-api': h.api, 'x-tts-voice': h.voice, ...(h.fallback ? { 'x-tts-fallback': encodeURIComponent(h.fallback) } : {}) })
    }
    const wants = lab || (asIs && (elevenOn() || (b.test === 'eleven' && elevenReady())))
    let fallback = ''
    if (wants) {
      const r = await sayEleven(c, b, lab).catch((e: Error) => new Refusal(e.message, 503))
      if (r instanceof Response) return r
      if (lab) return c.json({ error: r.message }, r.status)
      fallback = r.message
    }
    return sayYandex(c, b, fallback ? { 'x-tts-fallback': encodeURIComponent(fallback) } : {})
  })

  /**
   * Живой звук реплики: отдаём с первых байт, пока синтез идёт (<audio src> играет сразу). Заголовок — когда известно,
   * кто говорит: x-tts-api, а при подмене ElevenLabs на SpeechKit — x-tts-fallback. Запрос куска (Range, Safari) —
   * когда звук готов целиком.
   */
  app.get('/api/tts/live/:id', async (c) => {
    const j = lives.get(c.req.param('id'))
    if (!j) return c.json({ error: 'Звук уже недоступен' }, 404)
    const h = await j.head
    if (h.api === 'none') return c.json({ error: h.error ?? 'Озвучка не удалась' }, 503)
    const headers: Record<string, string> = {
      ...HEADERS,
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      'x-tts-api': h.api,
      'x-tts-voice': h.voice,
      ...(h.took ? { 'x-tts-ms': h.took } : {}),
      ...(h.fallback ? { 'x-tts-fallback': encodeURIComponent(h.fallback) } : {}),
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '')
    // Chrome просит у <audio> «bytes=0-» — это «с начала»: пока звук синтезируется, отдаём поток (200), не ждём конца
    const whole = range && (range[1] === '' || range[1] === '0') && range[2] === '' && !j.out.ended
    if (range && !whole) {
      const clip = await j.done
      if (!clip) return c.json({ error: 'Озвучка не удалась' }, 503)
      const size = clip.audio.length
      const from = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      const to = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1
      if (from >= size || from > to) return c.body(null, 416, { 'content-range': `bytes */${size}` })
      return c.body(clip.audio.slice(from, to + 1), 206, { ...headers, 'accept-ranges': 'bytes', 'content-range': `bytes ${from}-${to}/${size}`, 'x-audio-ms': String(clip.ms) })
    }
    const it = j.out.read()
    const body = new ReadableStream<Uint8Array>({
      async pull(ctl) {
        const { done, value } = await it.next()
        if (done) ctl.close()
        else ctl.enqueue(value)
      },
      cancel() {
        void it.return(undefined)
      },
    })
    return c.body(body, 200, headers)
  })

  /**
   * Новые голоса ElevenLabs в первый раз грузятся 8–9 с: при старте сервера каждое лицо из вступлений коротко говорит
   * «Так.» — только если этого ещё нет в кэше (тогда голос уже звучал и ничего не стоит).
   */
  async function prewarm() {
    if (primaryTts() !== 'elevenlabs') return
    const seen = new Set<string>()
    for (const { who, voice, text } of ELEVEN_KNOWN) {
      if (seen.has(voice)) continue
      seen.add(voice)
      // лица на v3 говорят живые реплики v4 Turbo (elevenBody) — прогреваем голос и в ней
      for (const live of [false, true]) {
        const q = { text: english(text) ? 'Okay.' : 'Так.', voice, who, live }
        const body = elevenBody(q, env)
        if (live && body.model_id === elevenBody({ ...q, live: false }, env).model_id) continue
        const job = elevenJob(q, fileOf({ p: 'elevenlabs', fmt: ELEVEN_FORMAT, voice, body }), Date.now() + WAIT.eleven(), () => {})
        const clip = await job.done.catch((e: Error) => console.warn(`[speech] прогрев ${who}: ${e.message}`))
        if (clip?.cache === 'miss') console.log(`[speech] прогрет голос ${who}${live ? ' (живые реплики)' : ''}`)
      }
    }
  }

  /** Одна попытка распознавания. Зависла, сеть или 5xx — пробуем ещё раз; 401/403 и 4xx — нет. */
  const recognize = async (pcm: Uint8Array<ArrayBuffer>, signal: AbortSignal, lang = 'ru-RU'): Promise<string> => {
    const q = new URLSearchParams({ lang, format: 'lpcm', sampleRateHertz: '16000' })
    const r = await f(`${STT_URL}?${q}`, { method: 'POST', body: pcm, headers: { Authorization: `Api-Key ${key}`, 'content-type': 'application/octet-stream' }, signal })
    deny('stt', r.status)
    if (!r.ok) throw Object.assign(new Error(`SpeechKit stt → ${r.status}`), { status: r.status })
    return ((await r.json()) as { result?: string }).result ?? ''
  }

  // Тело — сырой PCM: 16 кГц, моно, 16 бит little-endian. Браузер сам перегоняет свою запись в этот формат.
  // Синхронное распознавание берёт до 30 секунд и до 1 МБ. Каждый запрос — строка в журнале (без текста речи).
  app.post('/api/stt', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'Запись длиннее 30 секунд' }, 413) }), async (c) => {
    const t0 = Date.now()
    const ip = clientIp(c)
    const pcm = new Uint8Array(await c.req.arrayBuffer())
    // язык дела: ?lang=en — английский (дело на английском), по умолчанию русский
    const lang = c.req.query('lang') === 'en' ? 'en-US' : 'ru-RU'
    const notes: string[] = []
    const answer = async (): Promise<Response> => {
      if (!status().stt) return c.json({ error: 'Распознавание выключено' }, 503)
      if (pcm.length > 30 * 32000 || pcm.length % 2) return c.json({ error: 'Нужен PCM 16 кГц, до 30 секунд' }, 400)
      if (pcm.length < 16000 * 2 * 0.3) return c.json({ error: 'Слишком короткая запись' }, 400)
      if (!take('stt', quotaOf(c))) return c.json({ error: 'Лимит распознавания на сегодня' }, 429)
      if (!(await quota.sttAllowed())) return c.json({ error: 'Распознавание на сегодня закончилось' }, 429)
      try {
        const text = await hedge(async (signal, attempt) => {
          try {
            signal.throwIfAborted()
            const sec = Math.ceil(pcm.length / 32000 / 15) * 15
            // Списываем и отменённую попытку: провайдер мог уже принять звук.
            if (!(await quota.reserveStt(sec))) throw Object.assign(new Error('Бюджет STT исчерпан'), { status: 429 })
            signal.throwIfAborted()
            return await recognize(pcm, signal, lang)
          } catch (e) {
            notes.push(`попытка ${attempt}: ${(e as Error).message}`)
            throw e
          }
        }, {
          delayMs: hedgeDelay(pcm.length / 32000), timeoutMs: WAIT.stt(), signal: c.req.raw.signal,
          retry: (e) => (e as { status?: number }).status === undefined || (e as { status: number }).status >= 500,
        })
        return c.json({ text: tidyTranscript(text) })
      } catch (e) {
        return c.json({ error: (e as Error).message }, (e as { status?: number }).status === 429 ? 429 : 502)
      }
    }
    const r = await answer()
    console.log(`${new Date().toISOString()} [stt] судья=${JSON.stringify(judgeOf(c)?.name ?? 'Аноним')} id=${judgeOf(c)?.id ?? '-'} ip=${ip} ${pcm.length} байт → ${r.status}, ${Date.now() - t0} мс${notes.length ? ` (${notes.join('; ')})` : ''}`)
    return r
  })

  return { app, status, live, heater, issue, prewarm }
}

export type Speech = ReturnType<typeof makeSpeech>
