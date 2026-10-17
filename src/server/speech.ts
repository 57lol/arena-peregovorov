// Голос: озвучка реплик собеседника (TTS) и распознавание речи игрока (STT).
// Основной голос — ElevenLabs через свой воркер (TTS_PROVIDER=elevenlabs), запасной и голос по умолчанию — Yandex
// SpeechKit, распознавание — SpeechKit. Всё необязательное: нет ключа, лимит, сбой — игрок слышит SpeechKit или
// читает реплику без звука.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { budget as sharedBudget, type Budget } from './budget'
import { CACHE_DIR, hashOf } from './cache'
import { clientIp, sessionOf } from './client'
import { direct, DIRECT_VERSION, forEleven, isLive, liveMode, liveRole, liveVoiceFor, naturalMode, polish, POLISH_VERSION, spellOut, spokenOf } from './direct'
import { knownAudio } from './eleven-known'
import { ELEVEN_KNOWN } from './eleven-known.data'
import { DAY, HOUR, limiter, limitOf } from './limits'
import { yandex } from './llm'
import { accent, render, resolveStress, unstress, type AskJson } from './stress'
import { stripTags } from './tags'
import { WAIT } from './timeouts'
import { castFor, elevenBody, elevenRequest, mainTts, MAIN_TTS, mp3Ms, price1k, speechkit, styleFor, ttsStatus, voicesOf, YANDEX_VOICES, type TtsRequest } from './tts'

const STT_URL = 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize'

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
  /** SpeechKit: место в лимите IP и сервера на сутки; take — занять */
  const room = (kind: 'tts' | 'stt', ip: string) => count.left(`${kind}:${ip}`, limits[kind], DAY) && count.left('all', limits.all, DAY)
  const take = (kind: 'tts' | 'stt', ip: string) => room(kind, ip) && count.take(`${kind}:${ip}`, limits[kind], DAY) && count.take('all', limits.all, DAY)
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
  const eleven = { slots: slots(() => limitOf('ELEVEN_CONCURRENCY', 5)), fails: 0, until: 0, day: '', chars: 0 }
  const elevenOn = () => primaryTts() === 'elevenlabs' && Date.now() >= eleven.until
  const charsLeft = (n: number) => {
    const today = new Date().toISOString().slice(0, 10)
    if (eleven.day !== today) Object.assign(eleven, { day: today, chars: 0 })
    return eleven.chars + n <= limitOf('ELEVEN_DAILY_CHARS', 20_000)
  }
  // кто сейчас говорит: eleven — браузер берёт фразы-паузы ElevenLabs и не меняет темп голоса
  const status = () => {
    const voice = elevenOn() ? 'elevenlabs' : yandexTtsReady() ? 'speechkit' : null
    return { tts: !!voice || !!primaryTts(), stt: !!key && !denied.stt, voice, ...(voice === 'elevenlabs' ? { eleven: true } : {}) }
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
  // синтезы, которые идут прямо сейчас: файл кэша → звук; второй запрос той же реплики ждёт первый
  const inflight = new Map<string, Promise<Clip>>()
  const elevenJobs = new Map<string, { first: Promise<boolean>; done: Promise<Clip> }>()
  const HEADERS = { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000, immutable', 'access-control-expose-headers': 'x-audio-ms, x-cache, x-tts-api, x-tts-voice, x-tts-fallback' }
  const send = (c: Context, clip: Pick<Clip, 'audio' | 'ms'>, extra: Record<string, string>) =>
    c.body(clip.audio, 200, { ...HEADERS, ...(clip.ms ? { 'x-audio-ms': String(clip.ms) } : {}), ...extra })

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
      const body = elevenBody(q, env)
      if (!charsLeft(body.text.length)) throw new Refusal('ElevenLabs: символы на сегодня кончились')
      if (!(await quota.ttsAllowed(body.text.length))) throw new Refusal('Озвучка на сегодня закончилась')
      charge()
      if (!(await eleven.slots.take(deadline - Date.now()))) throw new Refusal('ElevenLabs: все потоки заняты')
      try {
        for (let attempt = 0; ; attempt++) {
          const r = await elevenRequest(q, f, env)
          if (r.status === 429 && attempt === 0) {
            await r.body?.cancel()
            await new Promise((ok) => setTimeout(ok, 400))
            continue
          }
          if (!r.ok) throw Object.assign(new Error(`ElevenLabs → ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`), { status: r.status })
          started(true)
          const audio = new Uint8Array(await r.arrayBuffer())
          if (audio.length < 500) throw new Error('ElevenLabs: пустой ответ')
          eleven.fails = 0
          eleven.chars += body.text.length
          await quota.addTts(body.text.length, false, (body.text.length / 1000) * price1k(body.model_id, env))
          await keep(file, audio)
          return { audio, ms: mp3Ms(audio), cache: 'miss' }
        }
      } finally {
        eleven.slots.free()
      }
    })()
    done.catch((e: Error & { status?: number }) => {
      started(false)
      // лимит, очередь и «занято» после повтора — не сбой ElevenLabs
      if (e instanceof Refusal || e.status === 429) return
      console.warn(`[speech] ElevenLabs: ${e.message}`)
      if (++eleven.fails >= 3) {
        eleven.until = Date.now() + 5 * 60_000
        eleven.fails = 0
        console.warn('[speech] ElevenLabs: три сбоя подряд, 5 минут говорим SpeechKit')
      }
    })
    return { first, done }
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
    const ip = clientIp(c), who = sessionOf(c)
    const perSession = limitOf('ELEVEN_SESSION_HOUR_LIMIT', 60), perIp = limitOf('ELEVEN_IP_DAY_LIMIT', 300)
    const roomy = count.left(`el:s:${who}`, perSession, HOUR) && count.left(`el:ip:${ip}`, perIp, DAY)
    // англицизмы и сокращения — как их говорят (forEleven), ударения — знаком U+0301 (render), пометки модели остаются
    const marked = await speakable(forEleven(unstress(spokenOf(b.text))), roomy)
    const q = { text: render(spellOut(marked), 'eleven').replace(/[«»"]/g, ''), voice, ...(lab ? {} : { who: b.who }) }
    const file = fileOf({ p: 'elevenlabs', voice, body: elevenBody(q, env) })
    let job = elevenJobs.get(file)
    const joined = !!job
    if (!job) {
      const charge = () => {
        if (!count.take(`el:s:${who}`, perSession, HOUR) || !count.take(`el:ip:${ip}`, perIp, DAY)) throw new Refusal('Лимит голоса ElevenLabs')
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
      return send(c, clip, { 'x-cache': joined ? 'warm' : clip.cache, 'x-tts-api': 'elevenlabs', 'x-tts-voice': voice })
    } catch (e) {
      return e instanceof Refusal ? e : new Refusal((e as Error).message, 503)
    }
  }

  /** Реплика голосом SpeechKit: свой кэш; лимит и платная разметка ударений — только для того, чего в кэше нет. */
  async function sayYandex(c: Context, b: TtsBody, extra: Record<string, string>): Promise<Response> {
    if (!yandexTtsReady()) return c.json({ error: 'Озвучка временно недоступна' }, 503)
    const ip = clientIp(c)
    const mode = naturalMode(env)
    const natural = b.natural ?? (mode === 'on' || mode === 'live')
    const voice = b.live ?? liveMode(mode) ? liveVoiceFor(b.voice) : b.voice
    // аккуратная разметка (voices+): ударения и редкие паузы; лаборатория с явным natural её не получает
    const neat = !natural && b.natural === undefined && mode === 'voices+'
    // на экране реплика остаётся как есть, размечаем только текст для синтеза; ударения «+» — везде, кроме
    // режиссёра речи и явных настроек лаборатории (там сравнивают голос как есть)
    const plain = b.text.replace(/[«»"]/g, '')
    const clean = stripTags(spokenOf(b.text))
    const marked = !natural && b.natural === undefined ? render((await speakable(unstress(clean), room('tts', ip))).replace(/[«»"]/g, ''), 'speechkit') : clean.replace(/[«»"]/g, '')
    const text = natural ? direct(plain, b.emotion) : neat ? polish(marked, b.emotion) : marked
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
        if (!take('tts', ip)) throw new Refusal('Лимит озвучки на сегодня')
        if (!(await quota.ttsAllowed(text.length))) throw new Refusal('Озвучка на сегодня закончилась')
        const r = await speechkit(key!, { text, voice, emotion: b.emotion, api: b.api ?? (api === 'v1' ? 'v1' : undefined), liveRole: role }, f)
        await quota.addTts(text.length, isLive(voice))
        // v3 упал и ответил v1 — кладём под ключ v1, чтобы v3 попробовать снова в следующий раз
        await keep(r.api !== api ? v1file : file, r.audio)
        return { audio: r.audio, ms: r.ms ?? Math.round((r.audio.length * 8) / 64), cache: 'miss', api: r.api }
      })()
      inflight.set(file, job)
      void job.catch(() => {}).finally(() => inflight.delete(file))
    }
    try {
      const clip = await job
      return send(c, clip, { ...extra, 'x-cache': joined ? 'warm' : clip.cache, 'x-tts-voice': voice, ...(clip.api ? { 'x-tts-api': clip.api } : {}) })
    } catch (e) {
      if (e instanceof Refusal) return c.json({ error: e.message }, e.status)
      deny('tts', (e as { status?: number }).status)
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
    const wants = lab || (asIs && (elevenOn() || (b.test === 'eleven' && elevenReady())))
    let fallback = ''
    if (wants) {
      const r = await sayEleven(c, b, lab)
      if (r instanceof Response) return r
      if (lab) return c.json({ error: r.message }, r.status)
      fallback = r.message
    }
    return sayYandex(c, b, fallback ? { 'x-tts-fallback': encodeURIComponent(fallback) } : {})
  })

  /**
   * Прогрев: /api/turn зовёт это, как только готов текст реплики, — синтез идёт, пока ответ летит к игроку.
   * Клиентский /api/tts с тем же телом подхватит готовый файл или ещё идущий синтез. Ошибки молча глотаем.
   */
  const warm = (body: Record<string, unknown>, from: Context) =>
    void Promise.resolve(
      app.request('/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': clientIp(from), cookie: from.req.header('cookie') ?? '' },
        body: JSON.stringify(body),
      }),
    ).catch(() => {})

  /**
   * Новые голоса ElevenLabs в первый раз грузятся 8–9 с: при старте сервера каждое лицо из вступлений коротко говорит
   * «Так.» — только если этого ещё нет в кэше (тогда голос уже звучал и ничего не стоит).
   */
  async function prewarm() {
    if (primaryTts() !== 'elevenlabs') return
    const seen = new Set<string>()
    for (const { who, voice } of ELEVEN_KNOWN) {
      if (seen.has(voice)) continue
      seen.add(voice)
      const q = { text: 'Так.', voice, who }
      const job = elevenJob(q, fileOf({ p: 'elevenlabs', voice, body: elevenBody(q, env) }), Date.now() + WAIT.eleven(), () => {})
      const clip = await job.done.catch((e: Error) => console.warn(`[speech] прогрев ${who}: ${e.message}`))
      if (clip?.cache === 'miss') console.log(`[speech] прогрет голос ${who}`)
    }
  }

  /** Одна попытка распознавания. Зависла, сеть или 5xx — пробуем ещё раз; 401/403 и 4xx — нет. */
  const recognize = async (pcm: Uint8Array<ArrayBuffer>): Promise<string> => {
    const q = new URLSearchParams({ lang: 'ru-RU', format: 'lpcm', sampleRateHertz: '16000' })
    const r = await f(`${STT_URL}?${q}`, { method: 'POST', body: pcm, headers: { Authorization: `Api-Key ${key}`, 'content-type': 'application/octet-stream' }, signal: AbortSignal.timeout(WAIT.stt()) })
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
    const notes: string[] = []
    const answer = async (): Promise<Response> => {
      if (!status().stt) return c.json({ error: 'Распознавание выключено' }, 503)
      if (pcm.length < 16000 * 2 * 0.3) return c.json({ error: 'Слишком короткая запись' }, 400)
      if (!take('stt', ip)) return c.json({ error: 'Лимит распознавания на сегодня' }, 429)
      if (!(await quota.sttAllowed())) return c.json({ error: 'Распознавание на сегодня закончилось' }, 429)
      for (let attempt = 1; ; attempt++) {
        try {
          const text = await recognize(pcm)
          // SpeechKit считает распознавание кусками по 15 секунд
          await quota.addStt(Math.ceil(pcm.length / 32000 / 15) * 15)
          return c.json({ text: tidyTranscript(text) })
        } catch (e) {
          const st = (e as { status?: number }).status
          notes.push(`попытка ${attempt}: ${(e as Error).message}`)
          if (attempt >= 2 || (st !== undefined && st < 500)) return c.json({ error: (e as Error).message }, 502)
        }
      }
    }
    const r = await answer()
    console.log(`${new Date().toISOString()} [stt] ${ip} ${pcm.length} байт → ${r.status}, ${Date.now() - t0} мс${notes.length ? ` (${notes.join('; ')})` : ''}`)
    return r
  })

  return { app, status, warm, issue, prewarm }
}

export type Speech = ReturnType<typeof makeSpeech>
