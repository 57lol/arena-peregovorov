import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseUpsells, withUpsellReply } from '../engine/upsells'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { buildReport } from '../engine/report'
import { initialState, step, type StepResult } from '../engine/turn'
import { TALK_ACTS, type MoveAnalysis, type Offer, type Scenario, type TurnRecord } from '../engine/types'
import { checkScenario } from '../engine/validate'
import { groundedOffline, walkAwayMove, withBareYes, withContext, withFormalOffer } from '../engine/offline'
import { startAnalysis, type AnalyzeResult, type AnalyzeRun } from './analyze'
import { isEn } from '../engine/lang'
import { GenerateRequest, generateScenario } from './generate'
import { allScenarios, dict, findScenario, scenarios } from './library'
import { CACHE_DIR, hashOf } from './cache'
import { quotaOf, judgeOf } from './client'
import { budget } from './budget'
import { usageMiddleware } from './usage'
import { juryAdmin } from './juryAdmin'
import { DAY, clientLimiter, limitOf, MINUTE } from './limits'
import { llmFromSpec, llmMode, llmStatus, makeLLM, voiceChoices, type LabLlm, type LLM } from './llm'
import { ttsStatus } from './tts'
import { naturalMode, rememberSpoken } from './direct'
import { unstress } from './stress'
import { makeSpeech, type Speech } from './speech'
import { completeLine, frameKey, voice, voicePrompt, type VoiceResult } from './voice'
import { stripTags } from './tags'
import { votesApp } from './votes'
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
  lang: z.enum(['ru', 'en']).optional(),
  title: str(300),
  sphere: str(100),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  harder: z.union([z.literal(0), z.literal(1)]).optional(),
  turnLimit: z.number().int().min(4).max(20),
  issues: z.array(z.object({
    id: Id,
    title: str(200),
    options: z.array(str(200)).min(2).max(6),
    aliases: z.array(z.array(str(100)).max(8)).max(6).optional(),
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
  upsells: z.array(z.object({
    id: Id, title: str(200), keywords: z.array(str(80)).max(8), cost: str(100), penalty: z.number().min(0).max(100),
    pitch: str(500), accepted: str(500), refused: str(500),
  })).max(6).optional(),
  opening: str(1500),
  blurb: str(500).optional(),
  goals: z.array(str(500)).max(10).optional(),
  lessons: z.array(str(500)).max(10).optional(),
})
const Analysis = z.object({
  upsells: z.array(z.object({ id: Id, choice: z.enum(['accepted', 'refused']), polite: z.boolean().optional() })).max(6).optional(),
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
  reaction: z.string().trim().max(80).optional(),
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
    let analysis: MoveAnalysis = { ...rest, behaviors: rest.behaviors ?? [], ...(offer ? { offer } : {}) }
    if (sc.upsells?.length) {
      analysis.upsells = parseUpsells(sc, String(x.playerText ?? '')).choices
      analysis = withUpsellReply(sc, String(x.playerText ?? ''), analysis, state)
    }
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

interface JobFirst {
  /** начало реплики с пометками для голоса */
  text: string
  /** то же для экрана */
  screen: string
  record: TurnRecord
  source: string
}
interface Job {
  who: string
  t0: number
  ms: Record<string, number | string>
  /** начало реплики подтверждено разбором — можно озвучивать; undefined — отдельного начала не будет */
  first: Promise<JobFirst | undefined>
  /** рамка реплики известна (разбор готов) */
  analyzed: Promise<void>
  done: Promise<{ said: VoiceResult; analysis: MoveAnalysis; r: StepResult; a: AnalyzeResult }>
  /** к заготовке пришёл настоящий ход */
  attached: boolean
  /** реплика и разбор готовы */
  over: () => boolean
  stopped: () => boolean
  stop: () => void
}

export function createApp(llm: LLM = makeLLM().llm, providerError?: string, speech: Speech = makeSpeech(), roomsDir = ROOMS, votesRoot = './public') {
  const app = new Hono()
  const count = clientLimiter()
  app.use('*', usageMiddleware())
  app.route('/', votesApp({ root: votesRoot }))
  app.route('/', juryAdmin())
  // вступления дел — тексты сервера: их можно озвучивать голосом ElevenLabs
  for (const sc of allScenarios) speech.issue(sc.opening)

  // 413 от лимита тела и прочие HTTP-ошибки — как есть, ошибки проверки — 400 по-русски
  // испорченное тело (не JSON) — ошибка запроса, а не сервера: c.req.json() бросает SyntaxError
  app.onError((e, c) =>
    e instanceof HTTPException ? (e.res ?? c.json({ error: e.message }, e.status))
    : e instanceof z.ZodError ? c.json({ error: zodText(e) }, 400)
    : e instanceof SyntaxError ? c.json({ error: 'Запрос не разобрался: тело — не JSON' }, 400)
    : c.json({ error: e.message }, 500))

  // только имя модели (у Яндекса в полном id зашит folder id облака) и режим pro/lite/offline — без сумм
  app.get('/api/health', async (c) =>
    c.json({ ok: true, mode: await llmMode(llm), provider: llm.name, model: llm.model.split('/').pop(), ...(llm.analyzer ? { analyzeModel: llm.analyzer.model.split('/').pop() } : {}), ...(llm.voice ? { voiceModel: `${llm.voice.name}:${llm.voice.model.split('/').pop()}` } : {}), ...(providerError ? { providerError } : {}), scenarios: allScenarios.length, speech: speech.status() }),
  )

  // Чужая модель на запрос — тот же лимит на пропуск, что у лаборатории.
  const labRoom = (c: Context) => count.take('lab', quotaOf(c), limitOf('LAB_IP_DAY_LIMIT', 200), DAY)

  // Модель реплики на запрос (страница сравнения моделей): только из разрешённого списка и не при LAB=off.
  // Разметка и решения движка при этом те же — меняются только слова собеседника.
  const voiceLlms = new Map<string, LLM>()
  function voiceLLM(want: string | undefined, c: Context): { llm?: LLM; note?: string } {
    if (!want || process.env.LAB === 'off' || llm.name === 'offline') return {}
    if (!voiceChoices().includes(want)) return { note: `модель ${want} не в списке` }
    if (!labRoom(c)) return { note: 'лимит лаборатории на сегодня' }
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
  function labLLM(want: string | undefined, c: Context): { llm: LLM; lab?: string } {
    if (!want || process.env.LAB === 'off' || !(want in llmStatus())) return { llm }
    let alt = labLlms.get(want)
    if (!alt) {
      const made = makeLLM(want)
      if (made.error) return { llm, lab: `нужен ключ ${llmStatus()[want as LabLlm].need}` }
      alt = made.llm
      labLlms.set(want, alt)
    }
    if (!labRoom(c)) return { llm, lab: 'лимит лаборатории на сегодня' }
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
  const tooFast = (c: Context) => llm.name !== 'offline' && !count.take('turn', quotaOf(c), limitOf('TURN_SESSION_MINUTE_LIMIT', 20), MINUTE)

  /**
   * Ход, который уже готовится. /api/prepare начинает его по тексту раннего commit Scribe, пока у игрока идёт пауза
   * конца реплики (0,5–1 с); /api/turn того же хода подхватывает начатое — разбор, реплику, её начало. Голос, счёт
   * партий и журнал — только у настоящего хода. Ключ — сессия и всё, что меняет ход; другой ход той же сессии
   * останавливает заготовку (игрок продолжил фразу — старую реплику дописывать незачем).
   */
  const jobs = new Map<string, Job>()

  async function turnInput(c: Context, body: z.infer<typeof TurnBody>) {
    const { llm, lab } = labLLM(c.req.header('x-lab-llm'), c)
    const sc = await resolveScenario({ ...body, scenario: body.scenario as Scenario | undefined })
    const history = normalizeHistory(sc, body.history)
    const before = history.length ? history[history.length - 1].stateAfter : initialState(sc)
    // естественная речь: общий флаг NATURAL_SPEECH или лаборатория (заголовок x-lab-natural: 1 / 0)
    const nh = process.env.LAB === 'off' ? undefined : c.req.header('x-lab-natural')
    const natural = nh ? nh === '1' : naturalMode() === 'on' || naturalMode() === 'live'
    // voices+: модель ставит «+» в омографах; на экран — без плюсов, синтезу — с ними (rememberSpoken)
    const marks = !nh && naturalMode() === 'voices+'
    const q = quotaOf(c)
    const who = `${q.key}|${q.ip}`
    const key = hashOf({
      who, sc: body.scenarioId ?? hashOf(sc), history: history.map((h) => [h.playerText, h.opponentLine, h.analysis]), text: body.playerText,
      reaction: body.reaction, offer: body.offer, accept: body.accept, walkAway: body.walkAway, natural, marks, lab, voiceLlm: body.voiceLlm ?? c.req.header('x-voice-llm'),
    })
    return { llm, lab, sc, history, before, natural, marks, who, key }
  }
  type TurnInput = Awaited<ReturnType<typeof turnInput>>

  function stopOthers(who: string, key: string) {
    for (const [k, j] of jobs) {
      if (j.who !== who || k === key || j.attached) continue
      j.stop()
      jobs.delete(k)
    }
  }

  /** Разбор → решение → реплика. Начало реплики (first) — как только его подтвердил разбор. */
  function startJob(t: TurnInput, body: z.infer<typeof TurnBody>, speaker: LLM): Job {
    const { llm, lab, sc, history, before, natural, marks } = t
    const t0 = Date.now()
    const ms: Record<string, number | string> = {}
    let stopped = false
    let gotFirst!: (f: JobFirst | undefined) => void
    const first = new Promise<JobFirst | undefined>((r) => (gotFirst = r))
    let analyzed!: () => void
    const analysisSeen = new Promise<void>((r) => (analyzed = r))

    /** Разбор → решение движка. Уход по кнопке — служебная реплика: разбор как есть, без контекста. */
    const decide = (found: MoveAnalysis) => {
      let analysis = body.walkAway ? found : withContext(withFormalOffer(withBareYes(body.playerText, withUpsellReply(sc, body.playerText, found, before), history), fitOffer(sc, body.offer)), before, history, dict)
      if (body.accept) analysis = { ...analysis, accepts: true }
      return { analysis, r: step(sc, before, analysis, dict, history.map((h) => h.analysis)) }
    }
    const keyOf = (r: ReturnType<typeof step>) => frameKey(sc, history, body.playerText, r.decision, r.state)
    /** Реплика по решению. Её начало уходит в голос и в поток, только когда решение подтверждено (open). */
    const speak = (r: ReturnType<typeof step>, basis: string) => {
      const ac = new AbortController()
      const at = Date.now() - t0
      let piece: string | undefined
      let confirmed: { analysis: MoveAnalysis; source: string } | undefined
      let sent = false
      const release = () => {
        if (sent || stopped || !confirmed || piece === undefined) return
        sent = true
        ms.first = Date.now() - t0
        const rr = decide(confirmed.analysis).r
        const safe = completeLine(sc, voicePrompt(sc, history, body.playerText, rr.decision, rr.state).frame, piece)
        const record: TurnRecord = {
          turn: rr.state.turn, playerText: body.playerText, analysis: decide(confirmed.analysis).analysis,
          deltas: rr.deltas, decision: rr.decision, stateAfter: rr.state,
          opponentLine: stripTags(unstress(safe)), emotion: 'neutral',
        }
        gotFirst({ text: piece, screen: stripTags(unstress(piece)), record, source: confirmed.source })
      }
      const said = voice(speaker, sc, history, body.playerText, r.decision, r.state, {
        natural,
        marks,
        reaction: body.reaction,
        fallback: llm,
        signal: ac.signal,
        onFirst: (p) => {
          piece = p
          release()
        },
      })
      return { at, said, ac, basis, key: keyOf(r), get sent() { return sent }, open: (analysis: MoveAnalysis, source: string) => ((confirmed = { analysis, source }), release()) }
    }
    let cur: ReturnType<typeof speak> | undefined

    const run = async () => {
      // Уход по кнопке — служебная реплика, а не приём: не размечаем, иначе «Я ухожу» станет ультиматумом в разборе.
      // Спекуляция — только у модели с потоком: промах обрывается сразу и почти ничего не стоит.
      const spec = !body.walkAway && !lab && process.env.SPECULATE !== 'off' && !!speaker.stream
      const analyzer = lab ? llm : (isEn(sc) && llm.analyzerEn) || llm.analyzer || llm
      // быстрый разметчик — запасной Claude (YandexGPT Pro): рамку реплики знаем через ~0,8 с, а не через ~2,2 с
      const quick = spec && process.env.ANALYZE_QUICK !== 'off' ? analyzer.backup : undefined
      const ar: AnalyzeRun = body.walkAway
        ? { ready: { analysis: walkAwayMove(), source: 'offline' }, keep: async () => {} }
        : await startAnalysis(analyzer, sc, dict, history, body.playerText, before.lastOpponentOffer, quick)
      let final: AnalyzeResult | undefined = ar.ready && { ...ar.ready, ...(body.walkAway ? { source: 'button' as never } : {}) }
      const frame = (a: AnalyzeResult, basis: string) => {
        if (stopped) throw new Error('Ход больше не нужен')
        const d = decide(a.analysis)
        if (cur?.key !== keyOf(d.r)) {
          cur?.ac.abort()
          cur = speak(d.r, basis)
        }
        return cur
      }
      if (!final) {
        // Спекуляция: пока модели размечают ход, реплику уже пишет модель — по разбору правил. Рамка та же, что по
        // настоящему разбору, — берём её; нет — обрываем и пишем заново. Разбор и оценка хода — по модели.
        const rulesKey = spec ? frame({ analysis: groundedOffline(sc, body.playerText, dict), source: 'offline' }, 'rules').key : undefined
        let quickA: AnalyzeResult | undefined
        const quickSeen = ar.quick?.then((q) => {
          if (!q || final || stopped || cur?.sent) return
          quickA = q
          ms.quick = Date.now() - t0
          // Pro и правила сошлись — начало можно озвучить сразу: при конфликте эта рамка важнее Sonnet.
          // Не сошлись — реплика по Pro, а звучит она, когда подтвердит Sonnet.
          if (frame(q, 'quick').key === rulesKey) cur!.open(q.analysis, q.source)
        }).catch(() => {})
        let main = await ar.main!
        ms.main = Date.now() - t0
        // Выбор зависит от разборов, а не от порядка ответов или готовности первой фразы.
        await quickSeen
        if (stopped) throw new Error('Ход больше не нужен')
        if (main.source === 'offline' && quickA) main = quickA
        final = quickA && cur?.key === rulesKey && keyOf(decide(main.analysis).r) !== rulesKey ? quickA : main
        if (cur || spec) frame(final, final === quickA ? 'quick' : 'main').open(final.analysis, final.source)
        if (final === quickA && main !== quickA) ms.record = 'quick'
        if (spec) ms.spec = cur!.basis === 'rules' ? 'hit' : 'miss'
      }
      ms.analyze = Date.now() - t0
      analyzed()
      if (!cur) frame(final, 'main').open(final.analysis, final.source)
      await ar.keep(final)
      const said = await cur!.said
      gotFirst(undefined)
      const { analysis, r } = decide(final.analysis)
      for (const [k, x] of Object.entries(said.ms ?? {})) if (x !== undefined && k !== 'first') ms[k] = cur!.at + x
      return { said, analysis, r, a: final }
    }
    const done = run()
    let over = false
    done.then(() => (over = true), () => { over = true; gotFirst(undefined) })
    const job: Job = {
      over: () => over,
      who: t.who,
      t0,
      ms,
      first,
      analyzed: analysisSeen,
      done,
      attached: false,
      stopped: () => stopped,
      stop: () => {
        stopped = true
        cur?.ac.abort()
      },
    }
    void done.finally(() => setTimeout(() => jobs.get(t.key) === job && jobs.delete(t.key), 60_000).unref?.()).catch(() => {})
    jobs.set(t.key, job)
    return job
  }

  // Ход заранее: голосовой клиент шлёт текст раннего commit Scribe, пока у игрока идёт пауза конца реплики.
  // Без голоса и звука: только разбор и реплика. Лаборатория и чужая модель реплики — без заготовок.
  app.post('/api/prepare', BODY, async (c) => {
    const body = TurnBody.parse(await c.req.json())
    if (llm.name === 'offline' || body.voiceLlm || c.req.header('x-lab-llm') || c.req.header('x-voice-llm') || process.env.PREPARE === 'off') return c.json({ ok: false })
    if (!count.take('prep', quotaOf(c), limitOf('PREPARE_SESSION_MINUTE_LIMIT', 20), MINUTE)) return c.json({ ok: false }, 429)
    const t = await turnInput(c, body)
    if (t.before.status !== 'open') return c.json({ ok: false }, 409)
    stopOthers(t.who, t.key)
    if (!jobs.get(t.key) || jobs.get(t.key)!.stopped()) startJob(t, body, llm.voice ?? llm)
    return c.json({ ok: true }, 202)
  })

  app.post('/api/turn', BODY, async (c) => {
    const body = TurnBody.parse(await c.req.json())
    if (tooFast(c)) return c.json({ error: 'Слишком часто: подождите минуту' }, 429)
    const t = await turnInput(c, body)
    const { lab, sc, history, before } = t
    if (before.status !== 'open') return c.json({ error: 'Переговоры уже закончены', state: before }, 409)

    const t0 = Date.now()
    // реплику пишет своя модель (VOICE_LLM или выбранная на запрос), лаборатория — целиком своей; не ответила — основная
    const asked = lab ? {} : voiceLLM(body.voiceLlm ?? c.req.header('x-voice-llm'), c)
    const speaker = lab ? t.llm : asked.llm ?? t.llm.voice ?? t.llm
    stopOthers(t.who, t.key)
    const ready = jobs.get(t.key)
    const job = ready && !ready.stopped() && (!ready.attached || !ready.over()) ? ready : startJob(t, body, speaker)
    job.attached = true
    // поток ответа (stream: true): начало реплики и ссылка на звук — раньше, чем ход целиком
    let emit: ((ev: object) => void) | undefined
    // голос включён: сервер озвучивает реплику сам, с первой фразы; игра берёт звук по ссылке или тем же /api/tts
    const sound = body.tts ? speech.live(body.tts, c) : undefined

    const turn = async () => {
      void job.analyzed.then(() => sound?.connect())
      // заготовка успела всю реплику — звук одним куском, без склейки начала и остатка
      const whole = job.over()
      let lineSent = false
      const early = job.first.then((f) => {
        if (!f) return
        lineSent = true
        if (!whole) sound?.first(f.text)
        emit?.({ t: 'line', text: f.screen, record: f.record, sources: { analysis: f.source, voice: 'partial' }, ...(sound ? { audio: sound.url } : {}) })
      })
      const { said, analysis, r, a } = await job.done
      await early
      // на экран — без пометок для голоса и без «+»; синтезу — с ними (rememberSpoken), ElevenLabs их поймёт
      const v = { ...said, line: stripTags(unstress(said.line)) }
      rememberSpoken(v.line, said.line)
      speech.issue(v.line)
      sound?.finish(said.line, v.emotion)
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
      if (!lineSent) emit?.({ t: 'line', text: v.line, record, sources: { analysis: a.source, voice: v.source }, ...(sound ? { audio: sound.url } : {}) })
      const done = r.state.status !== 'open'
      await budget().addPlay(history.length === 0, done)
      const judge = judgeOf(c)
      console.log(`[игра] судья=${JSON.stringify(judge?.name ?? 'Аноним')} id=${judge?.id ?? '-'} дело=${sc.id} ход=${r.state.turn} завершена=${done}`)
      // мс от прихода хода; заготовка начата раньше — на prepared мс
      const lead = t0 - job.t0
      const ms: Record<string, number | string> = Object.fromEntries(Object.entries(job.ms).map(([k, x]) => [k, typeof x === 'number' ? x - lead : x]))
      if (lead > 0) ms.prepared = lead
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
    const mayAsk = count.take('gen', quotaOf(c), limitOf('GENERATE_SESSION_DAY_LIMIT', 20), DAY)
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
