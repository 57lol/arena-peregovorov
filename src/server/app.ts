import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { buildReport } from '../engine/report'
import { initialState, step } from '../engine/turn'
import { TALK_ACTS, type MoveAnalysis, type Offer, type Scenario, type TurnRecord } from '../engine/types'
import { checkScenario } from '../engine/validate'
import { analyzeOffline, walkAwayMove, withContext, withFormalOffer } from '../engine/offline'
import { groundAnalysis } from '../engine/offerEvidence'
import { analyzeMove } from './analyze'
import { GenerateRequest, generateScenario } from './generate'
import { allScenarios, dict, findScenario, scenarios } from './library'
import { CACHE_DIR, hashOf } from './cache'
import { clientIp, sessionOf } from './client'
import { DAY, limiter, limitOf, MINUTE } from './limits'
import { llmFromSpec, llmMode, llmStatus, makeLLM, voiceChoices, type LabLlm, type LLM } from './llm'
import { ttsStatus } from './tts'
import { naturalMode, rememberSpoken } from './direct'
import { unstress } from './stress'
import { makeSpeech, type Speech } from './speech'
import { frameKey, voice } from './voice'
import { stripTags } from './tags'
import { roomsApi } from './rooms'

const SAVED = join(CACHE_DIR, 'scenarios')
const ROOMS = join(CACHE_DIR, 'rooms')

// Всё, что приходит от браузера, — с потолками: дело и история уходят в промпт модели, а это деньги.
const str = (max: number) => z.string().max(max)
const Id = z.string().regex(/^[\w-]{1,40}$/)
const Interest = z.object({ id: Id, text: str(1000), issue: Id.optional(), trustToReveal: z.number().min(0).max(100) })
const Profile = z.object({
  points: z.record(Id, z.array(z.number().min(-1000).max(1000)).max(6)),
  batna: z.number().min(-1000).max(1000),
  batnaText: str(1000),
  interests: z.array(Interest).max(8),
})
/** Своё дело из браузера: 3–6 пунктов по 2–6 вариантов, до 20 ходов, тексты с запасом против библиотеки и сборщика дел. */
const ScenarioInput = z.object({
  id: Id,
  title: str(300),
  sphere: str(100),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  harder: z.union([z.literal(0), z.literal(1)]).optional(),
  turnLimit: z.number().int().min(4).max(20),
  issues: z.array(z.object({
    id: Id,
    title: str(200),
    options: z.array(str(200)).min(2).max(6),
    kind: z.enum(['distributive', 'integrative', 'compatible']),
    preferences: z.object({ player: z.number().int(), opponent: z.number().int() }).optional(),
  })).min(3).max(6),
  player: z.object({ role: str(300), brief: str(3000), profile: Profile }),
  opponent: z.object({
    character: z.object({
      name: str(80), role: str(200), company: str(200), tone: z.enum(['friendly', 'neutral', 'cold', 'aggressive', 'evasive']),
      portrait: str(40), speech: str(3000), bio: str(3000),
      lines: z.record(str(30), z.array(str(500)).max(10)).optional(),
      voiceExamples: z.array(str(500)).max(8).optional(),
    }),
    brief: str(3000),
    profile: Profile,
  }),
  opening: str(1500),
  blurb: str(500).optional(),
  goals: z.array(str(500)).max(10).optional(),
  lessons: z.array(str(500)).max(10).optional(),
})
const Analysis = z.object({
  behaviors: z.array(z.object({ id: str(40), quote: str(300) })).max(20).default([]),
  offer: z.record(Id, z.number().int().min(0).max(5)).optional(),
  accepts: z.boolean().optional(),
  rest: z.boolean().optional(),
  walksAway: z.boolean().optional(),
  asksAbout: z.array(Id).max(6).optional(),
  toneViolation: z.boolean().optional(),
  talk: z.array(z.enum(TALK_ACTS as [string, ...string[]])).max(5).optional(),
})
/** Ход из истории: решения движок пересчитает сам, нужны только слова и разбор. */
const HistoryItem = z.object({ playerText: str(1500), opponentLine: str(1500), emotion: str(20).optional(), analysis: Analysis })
const History = z.array(HistoryItem).max(25).default([])
const OfferBody = z.record(Id, z.number().int().min(0).max(5))
const TurnBody = z.object({
  scenario: ScenarioInput.optional(),
  scenarioId: Id.optional(),
  history: History,
  playerText: z.string().trim().min(1).max(1500),
  offer: OfferBody.optional(),
  // Кнопки интерфейса: «принять то, что на столе» и «встать и уйти» — без угадывания по тексту.
  accept: z.boolean().optional(),
  walkAway: z.boolean().optional(),
  /** голос включён: тело /api/tts без текста — сервер начнёт синтез реплики сразу, как её напишет модель */
  tts: z.object({ voice: str(60) }).passthrough().optional(),
  /** модель реплики на этот ход («aitunnel:claude-sonnet-5.5») — для страницы сравнения; то же заголовком x-voice-llm */
  voiceLlm: str(80).optional(),
  /** ответ потоком (строки JSON): line — начало реплики и ссылка на звук, как только они готовы; done — ход целиком */
  stream: z.boolean().optional(),
})
const ReportBody = z.object({ scenario: ScenarioInput.optional(), scenarioId: Id.optional(), history: History })
const BODY = bodyLimit({ maxSize: 200 * 1024 })

/** Ошибка проверки запроса — по-русски, для игрока. */
function zodText(e: z.ZodError): string {
  const i = e.issues[0]
  const where = i.path.join('.')
  if (where === 'playerText') return i.code === 'too_big' ? 'Реплика длиннее 1500 символов' : 'Пустая реплика'
  if (where.startsWith('history')) return 'История встречи не разобралась — начните встречу заново'
  if (where.startsWith('scenario')) return 'Дело сломано'
  return `Запрос не разобрался (${where || i.code})`
}

/** Только варианты, которые есть в деле: «вариант 99» и чужие пункты отбрасываем. */
function fitOffer(sc: Scenario, offer: Offer | undefined): Offer | undefined {
  if (!offer) return undefined
  const out = Object.fromEntries(Object.entries(offer).filter(([id, n]) => n !== undefined && n < (sc.issues.find((i) => i.id === id)?.options.length ?? 0)))
  return Object.keys(out).length ? out : undefined
}

async function resolveScenario(body: { scenario?: Scenario; scenarioId?: string }): Promise<Scenario> {
  if (body.scenario) {
    // размеры проверила схема; таблицы очков должны совпадать с вариантами, а замечания к качеству дела
    // (широкая зона, нет размена) играть не мешают
    const broken = checkScenario(body.scenario).problems.filter((p) => p.includes('вариант'))
    if (broken.length) throw new HTTPException(400, { message: `Дело сломано: ${broken.join('; ')}` })
    return body.scenario
  }
  if (body.scenarioId) {
    const sc = findScenario(body.scenarioId)
    if (sc) return sc
    try {
      return JSON.parse(await readFile(join(SAVED, `${body.scenarioId}.json`), 'utf8'))
    } catch {
      // нет такого
    }
  }
  throw new HTTPException(404, { message: 'Не найден сценарий' })
}

/** Историю от клиента не принимаем на веру: пересчитываем решения движком по разборам. */
function normalizeHistory(sc: Scenario, raw: unknown[]): TurnRecord[] {
  const out: TurnRecord[] = []
  let state = initialState(sc)
  for (const x of raw as Partial<TurnRecord>[]) {
    if (!x?.analysis || state.status !== 'open') break
    const { offer: asked, ...rest } = x.analysis
    const offer = fitOffer(sc, asked)
    const analysis: MoveAnalysis = { ...rest, behaviors: rest.behaviors ?? [], ...(offer ? { offer } : {}) }
    const r = step(sc, state, analysis, dict, out.map((h) => h.analysis))
    out.push({
      turn: r.state.turn,
      playerText: String(x.playerText ?? '').slice(0, 1500),
      analysis,
      deltas: r.deltas,
      decision: r.decision,
      opponentLine: String(x.opponentLine ?? '').slice(0, 1500),
      emotion: String(x.emotion ?? 'neutral').slice(0, 20),
      stateAfter: r.state,
    })
    state = r.state
  }
  return out
}

export function createApp(llm: LLM = makeLLM().llm, providerError?: string, speech: Speech = makeSpeech(), roomsDir = ROOMS) {
  const app = new Hono()
  const count = limiter()
  // вступления дел — тексты сервера: их можно озвучивать голосом ElevenLabs
  for (const sc of allScenarios) speech.issue(sc.opening)

  // 413 от лимита тела и прочие HTTP-ошибки — как есть, ошибки проверки — 400 по-русски
  app.onError((e, c) => (e instanceof HTTPException ? (e.res ?? c.json({ error: e.message }, e.status)) : e instanceof z.ZodError ? c.json({ error: zodText(e) }, 400) : c.json({ error: e.message }, 500)))

  // только имя модели (у Яндекса в полном id зашит folder id облака) и режим pro/lite/offline — без сумм
  app.get('/api/health', async (c) =>
    c.json({ ok: true, mode: await llmMode(llm), provider: llm.name, model: llm.model.split('/').pop(), ...(llm.analyzer ? { analyzeModel: llm.analyzer.model.split('/').pop() } : {}), ...(llm.voice ? { voiceModel: `${llm.voice.name}:${llm.voice.model.split('/').pop()}` } : {}), ...(providerError ? { providerError } : {}), scenarios: allScenarios.length, speech: speech.status() }),
  )

  // Чужая модель на запрос — чужие деньги: тот же суточный лимит на IP, что у лаборатории (LAB_IP_DAY_LIMIT).
  const labRoom = (ip: string) => count.take(`lab:${ip}`, limitOf('LAB_IP_DAY_LIMIT', 200), DAY)

  // Модель реплики на запрос (страница сравнения моделей): только из разрешённого списка и не при LAB=off.
  // Разметка и решения движка при этом те же — меняются только слова собеседника.
  const voiceLlms = new Map<string, LLM>()
  function voiceLLM(want: string | undefined, ip: string): { llm?: LLM; note?: string } {
    if (!want || process.env.LAB === 'off' || llm.name === 'offline') return {}
    if (!voiceChoices().includes(want)) return { note: `модель ${want} не в списке` }
    if (!labRoom(ip)) return { note: 'лимит лаборатории на сегодня' }
    let m = voiceLlms.get(want)
    if (!m) {
      try {
        m = llmFromSpec(want)
      } catch (e) {
        return { note: (e as Error).message }
      }
      voiceLlms.set(want, m)
    }
    return { llm: m }
  }

  // Лаборатория (/?lab): ход можно сыграть другой моделью — заголовок x-lab-llm. Модель создаётся один раз,
  // без ключа заголовок молча не действует. LAB=off выключает всё.
  const labLlms = new Map<string, LLM>()
  function labLLM(want: string | undefined, ip: string): { llm: LLM; lab?: string } {
    if (!want || process.env.LAB === 'off' || !(want in llmStatus())) return { llm }
    let alt = labLlms.get(want)
    if (!alt) {
      const made = makeLLM(want)
      if (made.error) return { llm, lab: `нужен ключ ${llmStatus()[want as LabLlm].need}` }
      alt = made.llm
      labLlms.set(want, alt)
    }
    if (!labRoom(ip)) return { llm, lab: 'лимит лаборатории на сегодня' }
    return { llm: alt, lab: `${alt.name}:${alt.model.split('/').pop()}` }
  }

  app.get('/api/lab', async (c) =>
    c.json({
      enabled: process.env.LAB !== 'off',
      /** общий флаг естественной речи (NATURAL_SPEECH): off | on | live | voices | voices+ */
      natural: naturalMode(),
      main: { provider: llm.name, model: llm.model.split('/').pop(), mode: await llmMode(llm) },
      llm: llmStatus(),
      tts: { ...ttsStatus(), yandex: { ...ttsStatus().yandex, ready: speech.status().tts } },
    }),
  )

  app.get('/api/scenarios', (c) =>
    c.json(scenarios.map((s) => ({ id: s.id, title: s.title, sphere: s.sphere, difficulty: s.difficulty, opponent: s.opponent.character.name }))),
  )
  app.get('/api/scenarios/:id', async (c) => {
    const id = Id.safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'Не найден сценарий' }, 404)
    return c.json(await resolveScenario({ scenarioId: id.data }))
  })

  // «Ссылка для команды» на своё дело: кладём дело на диск и отдаём короткий id — таблица собеседника
  // не попадает в адрес. Дело с тем же содержимым получает тот же id.
  app.post('/api/scenarios', BODY, async (c) => {
    const parsed = z.object({ scenario: ScenarioInput }).safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: 'Дело сломано' }, 400)
    const sc = parsed.data.scenario as Scenario
    await resolveScenario({ scenario: sc })
    // сравниваем в одном виде: схема задаёт порядок полей и отбрасывает лишнее
    const same = (a: unknown) => JSON.stringify(ScenarioInput.safeParse(a).data) === JSON.stringify(sc)
    if (same(findScenario(sc.id))) return c.json({ id: sc.id })
    const saved = await resolveScenario({ scenarioId: sc.id }).catch(() => null)
    if (same(saved)) return c.json({ id: sc.id })
    const id = `gen-${hashOf(sc).slice(0, 12)}`
    await mkdir(SAVED, { recursive: true })
    await writeFile(join(SAVED, `${id}.json`), JSON.stringify({ ...sc, id }, null, 1))
    return c.json({ id })
  })

  /** Ходов в минуту на сессию: человек больше не успеет, а бот за минуту сожжёт бюджет (без модели ход бесплатный). */
  const tooFast = (c: Context) => llm.name !== 'offline' && !count.take(`turn:${sessionOf(c)}`, limitOf('TURN_SESSION_MINUTE_LIMIT', 20), MINUTE)

  app.post('/api/turn', BODY, async (c) => {
    const body = TurnBody.parse(await c.req.json())
    if (tooFast(c)) return c.json({ error: 'Слишком часто: подождите минуту' }, 429)
    const ip = clientIp(c)
    const { llm, lab } = labLLM(c.req.header('x-lab-llm'), ip)
    const sc = await resolveScenario({ ...body, scenario: body.scenario as Scenario | undefined })
    const history = normalizeHistory(sc, body.history)
    const before = history.length ? history[history.length - 1].stateAfter : initialState(sc)
    if (before.status !== 'open') return c.json({ error: 'Переговоры уже закончены', state: before }, 409)

    const t0 = Date.now()
    const ms: Record<string, number | string> = {}
    // поток ответа (stream: true): начало реплики и ссылка на звук — раньше, чем ход целиком
    let emit: ((ev: object) => void) | undefined
    // естественная речь: общий флаг NATURAL_SPEECH или лаборатория (заголовок x-lab-natural: 1 / 0)
    const nh = process.env.LAB === 'off' ? undefined : c.req.header('x-lab-natural')
    const natural = nh ? nh === '1' : naturalMode() === 'on' || naturalMode() === 'live'
    // voices+: модель ставит «+» в омографах; на экран — без плюсов, синтезу — с ними (rememberSpoken)
    const marks = !nh && naturalMode() === 'voices+'
    // реплику пишет своя модель (VOICE_LLM или выбранная на запрос), лаборатория — целиком своей; не ответила — основная
    const asked = lab ? {} : voiceLLM(body.voiceLlm ?? c.req.header('x-voice-llm'), ip)
    const speaker = lab ? llm : asked.llm ?? llm.voice ?? llm
    // голос включён: сервер озвучивает реплику сам, с первой фразы; игра берёт звук по ссылке или тем же /api/tts
    const sound = body.tts ? speech.live(body.tts, c) : undefined

    /** Разбор → решение движка. Уход по кнопке — служебная реплика: разбор как есть, без контекста. */
    const decide = (found: MoveAnalysis) => {
      let analysis = body.walkAway ? found : withContext(withFormalOffer(found, fitOffer(sc, body.offer)), before, history, dict)
      if (body.accept) analysis = { ...analysis, accepts: true }
      return { analysis, r: step(sc, before, analysis, dict, history.map((h) => h.analysis)) }
    }
    /** Реплика по решению. Её начало уходит в голос и в поток, только когда решение подтверждено (open). */
    const speak = (r: ReturnType<typeof step>) => {
      const ac = new AbortController()
      const at = Date.now() - t0
      let first: string | undefined
      let open = false
      let sent = false
      const release = () => {
        if (sent || !open || first === undefined) return
        sent = true
        ms.first = Date.now() - t0
        sound?.first(first)
        emit?.({ t: 'line', text: stripTags(unstress(first)), ...(sound ? { audio: sound.url } : {}) })
      }
      const said = voice(speaker, sc, history, body.playerText, r.decision, r.state, {
        natural,
        marks,
        fallback: llm,
        signal: ac.signal,
        onFirst: (piece) => {
          first = piece
          release()
        },
      })
      return { at, said, ac, key: frameKey(sc, history, body.playerText, r.decision, r.state), open: () => ((open = true), release()) }
    }

    const turn = async () => {
      // Уход по кнопке — служебная реплика, а не приём: не размечаем, иначе «Я ухожу» станет ультиматумом в разборе.
      const analyzing: Promise<{ analysis: MoveAnalysis; source: string; error?: string }> = body.walkAway
        ? Promise.resolve({ analysis: walkAwayMove(), source: 'button' })
        : analyzeMove(lab ? llm : (llm.analyzer ?? llm), sc, dict, history, body.playerText, before.lastOpponentOffer)
      // Спекуляция: пока Pro размечает ход (~1 с), реплику уже пишет модель — по разбору правил. Рамка реплики та же,
      // что по настоящему разбору, — берём её; нет — обрываем и пишем заново. Разбор и оценка хода — всегда Pro.
      let guess: ReturnType<typeof speak> | undefined
      // только у модели с потоком: промах обрывается сразу и почти ничего не стоит
      if (!body.walkAway && !lab && process.env.SPECULATE !== 'off' && speaker.stream) {
        const quick = await Promise.race([analyzing.then(() => true), new Promise<boolean>((r) => setTimeout(r, 15, false))])
        if (!quick) guess = speak(decide(groundAnalysis(sc, body.playerText, analyzeOffline(sc, body.playerText, dict))).r)
      }
      const a = await analyzing
      ms.analyze = Date.now() - t0
      sound?.connect()
      const { analysis, r } = decide(a.analysis)
      let run = guess
      if (guess && guess.key !== frameKey(sc, history, body.playerText, r.decision, r.state)) {
        guess.ac.abort()
        run = undefined
      }
      if (guess) ms.spec = run ? 'hit' : 'miss'
      run ??= speak(r)
      run.open()
      const said = await run.said
      for (const [k, x] of Object.entries(said.ms ?? {})) if (x !== undefined && k !== 'first') ms[k] = run.at + x
      // на экран — без пометок для голоса и без «+»; синтезу — с ними (rememberSpoken), ElevenLabs их поймёт
      const v = { ...said, line: stripTags(unstress(said.line)) }
      rememberSpoken(v.line, said.line)
      speech.issue(v.line)
      sound?.finish(said.line, v.emotion)
      if (ms.first === undefined) emit?.({ t: 'line', text: v.line, ...(sound ? { audio: sound.url } : {}) })
      const record: TurnRecord = {
        turn: r.state.turn,
        playerText: body.playerText,
        analysis,
        deltas: r.deltas,
        decision: r.decision,
        opponentLine: v.line,
        emotion: v.emotion,
        stateAfter: r.state,
      }
      const done = r.state.status !== 'open'
      return {
        analysis,
        deltas: r.deltas,
        decision: r.decision,
        opponentLine: v.line,
        emotion: v.emotion,
        state: r.state,
        record,
        // звук реплики по ссылке; кто говорит — если уже известно (фразы-паузы браузер берёт тем же голосом)
        ...(sound ? { audio: sound.url, ...(sound.voice ? { audioVoice: sound.voice } : {}) } : {}),
        ...(done ? { report: buildReport(sc, [...history, record], dict) } : {}),
        sources: { ms, analysis: a.source, voice: v.source, ...(v.model ? { voiceModel: v.model } : {}), ...(lab ? { lab } : {}), ...(a.error || v.error || asked.note ? { errors: [a.error, v.error, asked.note].filter(Boolean) } : {}) },
      }
    }

    if (!body.stream) return c.json(await turn())
    const enc = new TextEncoder()
    const out = new ReadableStream<Uint8Array>({
      start(ctl) {
        emit = (ev) => {
          try {
            ctl.enqueue(enc.encode(`${JSON.stringify(ev)}\n`))
          } catch {
            // игрок ушёл со страницы — ход всё равно доигрываем: он в кэше, звук оплачен
          }
        }
        turn().then(
          (j) => emit!({ t: 'done', ...j }),
          (e: Error) => emit!({ t: 'error', error: e.message }),
        ).finally(() => {
          try {
            ctl.close()
          } catch {
            // поток уже закрыт
          }
        })
      },
    })
    return c.body(out, 200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
  })

  app.post('/api/report', BODY, async (c) => {
    const body = ReportBody.parse(await c.req.json())
    const sc = await resolveScenario({ ...body, scenario: body.scenario as Scenario | undefined })
    return c.json(buildReport(sc, normalizeHistory(sc, body.history), dict))
  })

  // Своё дело: до трёх запросов к Pro по 3000 токенов — свой суточный лимит на сессию
  app.post('/api/scenario/generate', bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    const req = GenerateRequest.parse(await c.req.json().catch(() => ({})))
    const mayAsk = count.take(`gen:${sessionOf(c)}`, limitOf('GENERATE_SESSION_DAY_LIMIT', 20), DAY)
    const r = await generateScenario(mayAsk ? llm : makeLLM('offline').llm, req, scenarios)
    if (r.source === 'llm') {
      await mkdir(SAVED, { recursive: true })
      await writeFile(join(SAVED, `${r.scenario.id}.json`), JSON.stringify(r.scenario, null, 1))
      speech.issue(r.scenario.opening)
    }
    return c.json(r)
  })

  // тренировки для команды: комната на дело, доска результатов по секрету руководителя
  app.route('/', roomsApi({ dir: roomsDir, resolve: (id) => resolveScenario({ scenarioId: id }), normalize: normalizeHistory }))

  app.route('/', speech.app)

  return app
}
