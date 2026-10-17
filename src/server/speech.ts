// Голос через Yandex SpeechKit: озвучка реплик собеседника (TTS) и распознавание речи игрока (STT).
// Всё необязательное: нет ключа, лимит, сбой SpeechKit — клиент просто остаётся без звука.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { budget as sharedBudget, type Budget } from './budget'
import { CACHE_DIR, hashOf } from './cache'
import { direct, DIRECT_VERSION, isLive, liveMode, liveRole, liveVoiceFor, naturalMode, polish, POLISH_VERSION, spellOut } from './direct'
import { yandex } from './llm'
import { accent, render, resolveStress, unstress, type AskJson, type StressEngine } from './stress'
import { aitunnelModel, castFor, familyOf, mainTts, mannerOf, mp3Ms, price1k, styleFor, synthesize, wavMs, ttsStatus, voicesOf, YANDEX_VOICES, type MainTts, type TtsProvider } from './tts'

const STT_URL = 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize'

export { styleFor } from './tts'
/** Голоса SpeechKit, которые принимает /api/tts без поля provider (каталог с ролями — tts.ts, справка — ~/Arena-materials/VOICES.md). */
export const VOICES = YANDEX_VOICES.map((v) => v.id) as [string, ...string[]]

/** «196 р» в распознанном тексте — это рубли, как в листке на столе. */
export const tidyTranscript = (t: string) => t.trim().replace(/(\d)\s*р\.?(?=[\s,.!?]|$)/gu, '$1 ₽')

const EMOTION = z.enum(['neutral', 'pleased', 'happy', 'thinking', 'annoyed', 'angry'])
const TtsBody = z.object({
  text: z.string().trim().min(1).max(1000),
  voice: z.string().min(1).max(60),
  emotion: EMOTION.optional(),
  /** по умолчанию SpeechKit; остальные — для лаборатории и сравнения голосов, если есть ключ */
  provider: z.enum(['yandex', 'openai', 'elevenlabs', 'salute']).default('yandex'),
  api: z.enum(['v1', 'v3']).optional(),
  instructions: z.string().trim().max(400).optional(),
  /** «естественная речь» (режиссёр речи, direct.ts): по умолчанию — как велит NATURAL_SPEECH, лаборатория задаёт явно */
  natural: z.boolean().optional(),
  /** заменить голос на парный голос livetts */
  live: z.boolean().optional(),
  /** тест по ссылке ?tts=eleven: ElevenLabs через воркер вместо основного голоса */
  test: z.enum(['eleven']).optional(),
  /** амплуа лица (PERSONAS.role): livetts берёт его, если голос его умеет */
  role: z.string().max(20).optional(),
  /** кто говорит (портрет): по нему внешний провайдер (TTS_PROVIDER) выбирает свой голос и манеру */
  who: z.string().max(40).optional(),
})

export interface SpeechOptions {
  key?: string
  fetch?: typeof fetch
  /** фраз озвучки и распознаваний на один IP в сутки (по умолчанию без лимита: жюри может сидеть за одним IP) */
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
export function stressAsk(env = process.env): AskJson | undefined {
  if (env.STRESS_LLM === 'off' || env.LLM_PROVIDER !== 'yandex' || !env.YANDEX_API_KEY || !env.YANDEX_FOLDER_ID) return undefined
  const llm = yandex(undefined, undefined, env.STRESS_LLM_MODEL ?? env.YANDEX_FALLBACK_MODEL ?? 'yandexgpt-lite')
  const schema = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'array', items: { type: 'integer' } } } }
  return (system, user, ms) => llm.json({ system, user, temperature: 0, maxTokens: 40, timeoutMs: ms, schema: { name: 'stress', schema } })
}

/** Как ударение понимает движок: SpeechKit — «+», OpenAI и ElevenLabs — U+0301, Gemini — без разметки. */
export function stressEngine(p: TtsProvider, env = process.env): StressEngine {
  if (p === 'yandex') return 'speechkit'
  if (p === 'elevenlabs') return 'eleven'
  if (p === 'aitunnel') return familyOf(aitunnelModel(env)) === 'gemini' ? 'gemini' : familyOf(aitunnelModel(env))
  return p === 'openai' ? 'openai' : 'gemini'
}

export function makeSpeech(opts: SpeechOptions = {}) {
  const env = process.env
  const key = opts.key ?? (env.SPEECH === 'off' ? undefined : env.YANDEX_API_KEY)
  const f = opts.fetch ?? fetch
  const quota = opts.budget ?? sharedBudget()
  const limits = {
    tts: opts.ttsPerIp ?? Number(env.TTS_IP_DAY_LIMIT || Infinity),
    stt: opts.sttPerIp ?? Number(env.STT_IP_DAY_LIMIT || Infinity),
    all: opts.perDay ?? Number(env.SPEECH_DAY_LIMIT || Infinity),
  }
  // ключ без роли SpeechKit (401/403) — выключаем эту половину до перезапуска, а не долбим API
  const denied = { tts: false, stt: false }
  const counts = new Map<string, number>()
  let day = ''

  /** Простой счётчик на сутки: true — можно. */
  function allow(kind: 'tts' | 'stt', ip: string): boolean {
    const today = new Date().toISOString().slice(0, 10)
    if (today !== day) {
      counts.clear()
      day = today
    }
    const mine = `${kind}:${ip}`
    const n = counts.get(mine) ?? 0
    const all = counts.get('all') ?? 0
    if (n >= limits[kind] || all >= limits.all) return false
    counts.set(mine, n + 1)
    counts.set('all', all + 1)
    return true
  }

  async function yandex(url: string, init: RequestInit, kind: 'tts' | 'stt', ms: number): Promise<Response> {
    const r = await f(url, { ...init, headers: { Authorization: `Api-Key ${key}`, ...init.headers }, signal: AbortSignal.timeout(ms) })
    if (r.status === 401 || r.status === 403) {
      denied[kind] = true
      console.warn(`[speech] ${kind}: SpeechKit ответил ${r.status} — у сервисного аккаунта нет роли ai.speechkit-${kind}.user, выключаю`)
    }
    if (!r.ok) throw new Error(`SpeechKit ${kind} → ${r.status}`)
    return r
  }

  const yandexTtsReady = () => !!key && !denied.tts
  const primaryTts = () => env.SPEECH === 'off' ? undefined : mainTts(env)
  const status = () => ({ tts: yandexTtsReady() || !!primaryTts(), stt: !!key && !denied.stt })

  const ask = opts.stressAsk === undefined ? stressAsk(env) : opts.stressAsk ?? undefined
  const stressMs = Number(env.STRESS_LLM_MS ?? 500)
  // реплика → она же с ударениями «+» (словарь, правила, нейросеть для омографов); прогрев и запрос клиента ждут одно и то же
  const accents = new Map<string, Promise<string>>()
  const speakable = (text: string): Promise<string> => {
    // ударения, которые модель поставила в реплике сама, не берём: ошибается чаще, чем словарь и выбор из вариантов
    const plain = unstress(text)
    let p = accents.get(plain)
    if (!p) {
      p = resolveStress(accent(plain), ask, stressMs)
      accents.set(plain, p)
      if (accents.size > 2000) accents.delete(accents.keys().next().value!)
    }
    return p
  }

  const app = new Hono()
  // синтезы, которые идут прямо сейчас: файл кэша → звук
  const inflight = new Map<string, Promise<{ audio: Uint8Array<ArrayBuffer>; ms: number }>>()

  // чужие платные голоса (лаборатория, сравнение) — отдельный суточный потолок символов поверх общих лимитов
  let alt = { day: '', chars: 0 }
  const altCap = Number(env.TTS_ALT_DAILY_CHARS ?? 15000)
  const altAllowed = (n: number) => {
    const today = new Date().toISOString().slice(0, 10)
    if (alt.day !== today) alt = { day: today, chars: 0 }
    return alt.chars + n <= altCap
  }

  let elevenDay = { day: '', chars: 0 }
  const elevenCap = Number(env.ELEVEN_DAILY_CHARS ?? 20000)
  const elevenAllowed = (n: number) => {
    const today = new Date().toISOString().slice(0, 10)
    if (elevenDay.day !== today) elevenDay = { day: today, chars: 0 }
    if (elevenDay.chars + n > elevenCap) return false
    elevenDay.chars += n
    return true
  }

  // внешний провайдер сбоит — после трёх ошибок подряд даём ему паузу, игра тем временем говорит SpeechKit
  const outage = { fails: 0, until: 0 }

  /** Реплика у внешнего провайдера: свой кэш, свои лимиты, цена в общий бюджет (price1k). null — лимит. */
  async function external(c: Context, p: MainTts, b: z.infer<typeof TtsBody>): Promise<Response | null> {
    const st = ttsStatus(env)[p]
    const voice = castFor(p, b.who, b.voice, env)
    const instructions = mannerOf(b.who, b.emotion)
    // ударения — как понимает этот движок (stress.ts: render); OpenAI и Gemini разметку не слушаются — им без неё и без
    // ожидания нейросети для омографов. Рубли и проценты словами помогают всем
    const engine = stressEngine(p, env)
    const marked = engine === 'speechkit' || engine === 'eleven' ? await speakable(b.text) : unstress(b.text)
    const text = render(spellOut(marked), engine).replace(/[«»"]/g, '')
    const ext = /^gemini/.test(st.model) && p === 'aitunnel' ? 'wav' : 'mp3'
    const file = join(CACHE_DIR, 'tts', `${hashOf({ p, m: st.model, text, voice, i: instructions, e: b.emotion })}.${ext}`)
    const headers = { 'content-type': ext === 'wav' ? 'audio/wav' : 'audio/mpeg', 'cache-control': 'public, max-age=31536000, immutable', 'access-control-expose-headers': 'x-audio-ms, x-cache, x-tts-api, x-tts-voice', 'x-tts-voice': voice, 'x-tts-api': p }
    const send = (audio: Uint8Array<ArrayBuffer>, ms: number, cache: string) => c.body(audio, 200, { ...headers, 'x-cache': cache, ...(ms ? { 'x-audio-ms': String(ms) } : {}) })
    const running = inflight.get(file)
    if (running) {
      const r = await running.catch(() => null)
      if (r) return send(r.audio, r.ms, 'warm')
    }
    try {
      const audio = new Uint8Array(await readFile(file))
      return send(audio, ext === 'wav' ? wavMs(audio) : mp3Ms(audio), 'hit')
    } catch {
      // нет в кэше
    }
    if (!allow('tts', ipOf(c)) || !(await quota.ttsAllowed(text.length))) return null
    const job = synthesize(p, { text, voice, emotion: b.emotion, instructions }, f, env).then((r) => ({ audio: r.audio, ms: r.ms ?? 0 }))
    job.catch(() => {})
    inflight.set(file, job)
    try {
      const r = await job
      await quota.addTts(text.length, false, (text.length / 1000) * price1k(st.model, env))
      await mkdir(join(CACHE_DIR, 'tts'), { recursive: true })
      await writeFile(file, r.audio)
      return send(r.audio, r.ms, 'miss')
    } finally {
      inflight.delete(file)
    }
  }

  /** Каталог голосов и какие провайдеры готовы — для страниц сравнения и лаборатории. Ключей наружу не отдаём. */
  app.get('/api/voices', (c) => {
    const st = ttsStatus({ ...env, YANDEX_API_KEY: key })
    if (denied.tts) st.yandex.ready = false
    return c.json(Object.fromEntries((Object.keys(st) as TtsProvider[]).map((p) => [p, { ...st[p], voices: voicesOf(p) }])))
  })

  app.post('/api/tts', async (c) => {
    const b = TtsBody.parse(await c.req.json())
    const yandexOnly = b.provider === 'yandex'
    const asIs = yandexOnly && b.api === undefined && b.natural === undefined && b.live === undefined
    // тест ElevenLabs — только по ссылке и в пределах суточного потолка символов (ELEVEN_DAILY_CHARS)
    const eleven = asIs && b.test === 'eleven' && env.SPEECH !== 'off' && ttsStatus(env).elevenlabs.ready && elevenAllowed(b.text.length)
    const main = eleven ? 'elevenlabs' as const : asIs ? primaryTts() : undefined
    const ready = yandexOnly ? yandexTtsReady() : ttsStatus(env)[b.provider].ready
    if (!ready && !main) return c.json({ error: yandexOnly ? 'Озвучка выключена' : `Нужен ключ ${ttsStatus(env)[b.provider].need}` }, 503)
    if (!voicesOf(b.provider).some((v) => v.id === b.voice)) return c.json({ error: 'Нет такого голоса' }, 400)
    // основной внешний голос (TTS_PROVIDER): игра шлёт голос SpeechKit и лицо, сервер берёт голос этого лица у провайдера.
    // Лаборатория и ?voice=classic (явные api/natural/live) его не трогают. Не вышло — дальше обычный SpeechKit.
    if (main && Date.now() > outage.until) {
      const r = await external(c, main, b).catch((e: Error) => {
        if (++outage.fails >= 3) {
          outage.until = Date.now() + 5 * 60_000
          outage.fails = 0
          console.warn(`[speech] ${main}: три сбоя подряд, 5 минут говорим SpeechKit (${e.message})`)
        }
        return null
      })
      if (r) {
        outage.fails = 0
        return r
      }
    }
    if (yandexOnly && !yandexTtsReady()) return c.json({ error: 'Озвучка временно недоступна' }, 503)
    const mode = naturalMode(env)
    const natural = yandexOnly && (b.natural ?? (mode === 'on' || mode === 'live'))
    const voice = yandexOnly && (b.live ?? liveMode(mode)) ? liveVoiceFor(b.voice) : b.voice
    // аккуратная разметка (voices+): ударения и редкие паузы; лаборатория с явным natural её не получает
    const neat = yandexOnly && !natural && b.natural === undefined && mode === 'voices+'
    // на экране реплика остаётся как есть, размечаем только текст для синтеза; ударения «+» — везде, кроме
    // режиссёра речи и явных настроек лаборатории (там сравнивают голос как есть)
    const plain = b.text.replace(/[«»"]/g, '')
    const marked = yandexOnly && !natural && b.natural === undefined ? render((await speakable(b.text)).replace(/[«»"]/g, ''), 'speechkit') : plain
    const text = natural ? direct(plain, b.emotion) : neat ? polish(marked, b.emotion) : marked
    const style = styleFor(voice, b.emotion)
    // амплуа livetts под эмоцию — и с режиссёром речи, и без него
    const role = isLive(voice) ? liveRole(voice, b.emotion, b.role) : undefined
    const nat = natural ? { n: DIRECT_VERSION, ...(role ? { r: role } : {}) } : neat ? { p: POLISH_VERSION, ...(role ? { r: role } : {}) } : role ? { r: role } : {}
    const v3only = YANDEX_VOICES.find((v) => v.id === voice)?.v3only
    // SpeechKit по умолчанию — v3; TTS_YANDEX_API=v1 возвращает старую озвучку для голосов, которые её знают
    const api = yandexOnly ? (b.api ?? (env.TTS_YANDEX_API === 'v1' && !v3only ? 'v1' : 'v3')) : undefined
    const id = yandexOnly
      ? api === 'v1'
        ? { v: 1, text, voice, ...style, ...nat } // тот же ключ, что у озвучки до v3: старый кэш живёт
        : { v: 3, text, voice, ...style, ...nat }
      : { p: b.provider, m: ttsStatus(env)[b.provider].model, text, voice, emotion: b.emotion, i: b.instructions }
    const ext = b.provider === 'salute' ? 'wav' : 'mp3'
    const type = ext === 'wav' ? 'audio/wav' : 'audio/mpeg'
    const file = join(CACHE_DIR, 'tts', `${hashOf(id)}.${ext}`)
    const headers = { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable', 'access-control-expose-headers': 'x-audio-ms, x-cache, x-tts-api, x-tts-voice', 'x-tts-voice': voice }
    // длительность для печати в такт: у SpeechKit mp3 64 кбит/с, у ElevenLabs 128, у wav — из заголовка; у OpenAI браузер узнает сам
    const msOf = (n: number) => (yandexOnly ? (n * 8) / 64 : b.provider === 'elevenlabs' ? (n * 8) / 128 : 0)
    // эту же реплику уже синтезирует прогрев из /api/turn — ждём его, а не просим SpeechKit второй раз
    const running = inflight.get(file)
    if (running) {
      const r = await running.catch(() => null)
      if (r) return c.body(r.audio, 200, { ...headers, 'x-cache': 'warm', ...(r.ms ? { 'x-audio-ms': String(r.ms) } : {}) })
    }
    try {
      const audio = new Uint8Array(await readFile(file))
      const ms = ext === 'wav' ? wavMs(audio) : Math.round(msOf(audio.length))
      return c.body(audio, 200, { ...headers, 'x-cache': 'hit', ...(ms ? { 'x-audio-ms': String(ms) } : {}) })
    } catch {
      // нет в кэше
    }
    if (!allow('tts', ipOf(c))) return c.json({ error: 'Лимит озвучки на сегодня' }, 429)
    if (!(await quota.ttsAllowed(text.length))) return c.json({ error: 'Озвучка на сегодня закончилась' }, 429)
    if (!yandexOnly && !altAllowed(text.length)) return c.json({ error: 'Лимит на пробные голоса на сегодня' }, 429)
    const job = synthesize(b.provider, { text, voice, emotion: b.emotion, api: b.api ?? (api === 'v1' ? 'v1' : undefined), instructions: b.instructions, liveRole: role }, f, { ...env, YANDEX_API_KEY: key })
    const shared = job.then((r) => ({ audio: r.audio, ms: r.ms || Math.round(msOf(r.audio.length)) }))
    shared.catch(() => {}) // ошибку разберёт сам запрос ниже
    inflight.set(file, shared)
    try {
      const r = await job
      await quota.addTts(text.length, isLive(voice))
      if (!yandexOnly) alt.chars += text.length
      // v3 упал и ответил v1 — кладём под ключ v1, чтобы v3 попробовать снова в следующий раз
      const out = r.api && r.api !== api ? join(CACHE_DIR, 'tts', `${hashOf({ v: 1, text, voice, ...style, ...nat })}.mp3`) : file
      await mkdir(join(CACHE_DIR, 'tts'), { recursive: true })
      await writeFile(out, r.audio)
      const ms = r.ms || Math.round(msOf(r.audio.length))
      return c.body(r.audio, 200, { ...headers, 'x-cache': 'miss', ...(r.api ? { 'x-tts-api': r.api } : {}), ...(ms ? { 'x-audio-ms': String(ms) } : {}) })
    } catch (e) {
      const st = (e as { status?: number }).status
      if (yandexOnly && (st === 401 || st === 403)) {
        denied.tts = true
        console.warn(`[speech] tts: SpeechKit ответил ${st} — у сервисного аккаунта нет роли ai.speechkit-tts.user, выключаю`)
      }
      return c.json({ error: (e as Error).message }, 502)
    } finally {
      inflight.delete(file)
    }
  })

  /**
   * Прогрев: /api/turn зовёт это, как только готов текст реплики, — синтез идёт, пока ответ летит к игроку.
   * Клиентский /api/tts с тем же телом подхватит готовый файл или ещё идущий синтез. Ошибки молча глотаем.
   */
  const warm = (body: Record<string, unknown>, ip: string) =>
    void Promise.resolve(
      app.request('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) }),
    ).catch(() => {})

  // Тело — сырой PCM: 16 кГц, моно, 16 бит little-endian. Браузер сам перегоняет свою запись в этот формат.
  // Синхронное распознавание берёт до 30 секунд и до 1 МБ.
  app.post('/api/stt', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'Запись длиннее 30 секунд' }, 413) }), async (c) => {
    if (!status().stt) return c.json({ error: 'Распознавание выключено' }, 503)
    const pcm = new Uint8Array(await c.req.arrayBuffer())
    if (pcm.length < 16000 * 2 * 0.3) return c.json({ error: 'Слишком короткая запись' }, 400)
    if (!allow('stt', ipOf(c))) return c.json({ error: 'Лимит распознавания на сегодня' }, 429)
    if (!(await quota.sttAllowed())) return c.json({ error: 'Распознавание на сегодня закончилось' }, 429)
    const q = new URLSearchParams({ lang: 'ru-RU', format: 'lpcm', sampleRateHertz: '16000' })
    try {
      const r = await yandex(`${STT_URL}?${q}`, { method: 'POST', body: pcm, headers: { 'content-type': 'application/octet-stream' } }, 'stt', 20_000)
      // SpeechKit считает распознавание кусками по 15 секунд
      await quota.addStt(Math.ceil(pcm.length / 32000 / 15) * 15)
      const j = (await r.json()) as { result?: string }
      return c.json({ text: tidyTranscript(j.result ?? '') })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502)
    }
  })

  return { app, status, warm }
}

export type Speech = ReturnType<typeof makeSpeech>

function ipOf(c: Context): string {
  const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  if (fwd) return fwd
  try {
    return getConnInfo(c).remote.address ?? 'local'
  } catch {
    return 'local' // app.request в тестах — без сокета
  }
}
