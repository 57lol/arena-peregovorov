import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { buildReport } from '../engine/report'
import { initialState, step } from '../engine/turn'
import type { MoveAnalysis, Scenario, TurnRecord } from '../engine/types'
import { checkScenario } from '../engine/validate'
import { walkAwayMove, withContext, withFormalOffer } from '../engine/offline'
import { analyzeMove } from './analyze'
import { GenerateRequest, generateScenario } from './generate'
import { allScenarios, dict, findScenario, scenarios } from './library'
import { hashOf } from './cache'
import { llmMode, llmStatus, makeLLM, type LabLlm, type LLM } from './llm'
import { ttsStatus } from './tts'
import { naturalMode } from './direct'
import { makeSpeech, type Speech } from './speech'
import { voice } from './voice'
import { roomsApi } from './rooms'

const CACHE = process.env.CACHE_DIR ?? join(process.cwd(), '.cache')
const SAVED = join(CACHE, 'scenarios')
const ROOMS = join(CACHE, 'rooms')

const OfferSchema = z.record(z.string(), z.number().int().min(0))
const TurnBody = z.object({
  scenario: z.any().optional(),
  scenarioId: z.string().optional(),
  history: z.array(z.any()).default([]),
  playerText: z.string().trim().min(1).max(1500),
  offer: OfferSchema.optional(),
  // Кнопки интерфейса: «принять то, что на столе» и «встать и уйти» — без угадывания по тексту.
  accept: z.boolean().optional(),
  walkAway: z.boolean().optional(),
  /** голос включён: тело /api/tts без текста — сервер начнёт синтез реплики сразу, как её напишет модель */
  tts: z.object({ voice: z.string().max(60) }).passthrough().optional(),
})
const ReportBody = z.object({ scenario: z.any().optional(), scenarioId: z.string().optional(), history: z.array(z.any()) })

async function resolveScenario(body: { scenario?: unknown; scenarioId?: string }): Promise<Scenario> {
  if (body.scenario) {
    const check = checkScenario(body.scenario as Scenario)
    if (check.problems.some((p) => p.includes('вариант'))) throw new Error(`Сценарий сломан: ${check.problems.join('; ')}`)
    return body.scenario as Scenario
  }
  if (body.scenarioId) {
    const sc = findScenario(body.scenarioId)
    if (sc) return sc
    try {
      return JSON.parse(await readFile(join(SAVED, `${body.scenarioId.replace(/[^\w-]/g, '')}.json`), 'utf8'))
    } catch {
      // нет такого
    }
  }
  throw new Error('Не найден сценарий')
}

/** Историю от клиента не принимаем на веру: пересчитываем решения движком по разборам. */
function normalizeHistory(sc: Scenario, raw: unknown[]): TurnRecord[] {
  const out: TurnRecord[] = []
  let state = initialState(sc)
  for (const x of raw as Partial<TurnRecord>[]) {
    if (!x?.analysis || state.status !== 'open') break
    const analysis = { ...x.analysis, behaviors: x.analysis.behaviors ?? [] }
    const r = step(sc, state, analysis, dict, out.map((h) => h.analysis))
    out.push({
      turn: r.state.turn,
      playerText: String(x.playerText ?? ''),
      analysis,
      deltas: r.deltas,
      decision: r.decision,
      opponentLine: String(x.opponentLine ?? ''),
      emotion: String(x.emotion ?? 'neutral'),
      stateAfter: r.state,
    })
    state = r.state
  }
  return out
}

export function createApp(llm: LLM = makeLLM().llm, providerError?: string, speech: Speech = makeSpeech(), roomsDir = ROOMS) {
  const app = new Hono()

  // 413 от лимита тела и прочие HTTP-ошибки — как есть, ошибки проверки — 400
  app.onError((e, c) => (e instanceof HTTPException ? e.getResponse() : c.json({ error: e.message }, e instanceof z.ZodError ? 400 : 500)))

  // только имя модели (у Яндекса в полном id зашит folder id облака) и режим pro/lite/offline — без сумм
  app.get('/api/health', async (c) =>
    c.json({ ok: true, mode: await llmMode(llm), provider: llm.name, model: llm.model.split('/').pop(), ...(llm.analyzer ? { analyzeModel: llm.analyzer.model.split('/').pop() } : {}), ...(providerError ? { providerError } : {}), scenarios: allScenarios.length, speech: speech.status() }),
  )

  // Лаборатория (/?lab): ход можно сыграть другой моделью — заголовок x-lab-llm. Модель создаётся один раз,
  // без ключа заголовок молча не действует. Свой суточный лимит на IP, LAB=off выключает всё.
  const labLlms = new Map<string, LLM>()
  const labCount = new Map<string, number>()
  let labDay = ''
  const labLimit = Number(process.env.LAB_IP_DAY_LIMIT || Infinity)
  function labLLM(want: string | undefined, ip: string): { llm: LLM; lab?: string } {
    if (!want || process.env.LAB === 'off' || !(want in llmStatus())) return { llm }
    const today = new Date().toISOString().slice(0, 10)
    if (today !== labDay) {
      labCount.clear()
      labDay = today
    }
    const n = labCount.get(ip) ?? 0
    if (n >= labLimit) return { llm, lab: 'лимит лаборатории на сегодня' }
    let alt = labLlms.get(want)
    if (!alt) {
      const made = makeLLM(want)
      if (made.error) return { llm, lab: `нужен ключ ${llmStatus()[want as LabLlm].need}` }
      alt = made.llm
      labLlms.set(want, alt)
    }
    labCount.set(ip, n + 1)
    return { llm: alt, lab: `${alt.name}:${alt.model.split('/').pop()}` }
  }

  app.get('/api/lab', async (c) =>
    c.json({
      enabled: process.env.LAB !== 'off',
      /** общий флаг естественной речи (NATURAL_SPEECH): off | on | live */
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
    try {
      return c.json(await resolveScenario({ scenarioId: c.req.param('id') }))
    } catch {
      return c.json({ error: 'Не найден сценарий' }, 404)
    }
  })

  // «Ссылка для команды» на своё дело: кладём дело на диск и отдаём короткий id — таблица собеседника
  // не попадает в адрес. Дело с тем же содержимым получает тот же id.
  app.post('/api/scenarios', bodyLimit({ maxSize: 200 * 1024 }), async (c) => {
    const { scenario } = z.object({ scenario: z.record(z.string(), z.any()) }).parse(await c.req.json())
    const sc = scenario as unknown as Scenario
    let broken = true
    try {
      broken = checkScenario(sc).problems.some((p) => p.includes('вариант') || p.includes('пунктов'))
    } catch {
      // не дело вовсе
    }
    if (broken || typeof sc.id !== 'string') return c.json({ error: 'Дело сломано' }, 400)
    const same = (a: unknown) => JSON.stringify(a) === JSON.stringify(sc)
    if (same(findScenario(sc.id))) return c.json({ id: sc.id })
    const saved = await resolveScenario({ scenarioId: sc.id }).catch(() => null)
    if (same(saved)) return c.json({ id: sc.id })
    const id = `gen-${hashOf(sc).slice(0, 12)}`
    await mkdir(SAVED, { recursive: true })
    await writeFile(join(SAVED, `${id}.json`), JSON.stringify({ ...sc, id }, null, 1))
    return c.json({ id })
  })

  app.post('/api/turn', async (c) => {
    const body = TurnBody.parse(await c.req.json())
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
    const { llm, lab } = labLLM(c.req.header('x-lab-llm'), ip)
    const sc = await resolveScenario(body)
    const history = normalizeHistory(sc, body.history)
    const before = history.length ? history[history.length - 1].stateAfter : initialState(sc)
    if (before.status !== 'open') return c.json({ error: 'Переговоры уже закончены', state: before }, 409)

    // Уход по кнопке — служебная реплика, а не приём: не размечаем, иначе «Я ухожу» станет ультиматумом в разборе.
    const a: { analysis: MoveAnalysis; source: string; error?: string } = body.walkAway
      ? { analysis: walkAwayMove(), source: 'button' }
      : await analyzeMove(lab ? llm : (llm.analyzer ?? llm), sc, dict, history, body.playerText, before.lastOpponentOffer)
    let analysis = body.walkAway ? a.analysis : withContext(withFormalOffer(a.analysis, body.offer), before, history, dict)
    if (body.accept) analysis = { ...analysis, accepts: true }
    const r = step(sc, before, analysis, dict, history.map((h) => h.analysis))
    // естественная речь: общий флаг NATURAL_SPEECH или лаборатория (заголовок x-lab-natural: 1 / 0)
    const nh = process.env.LAB === 'off' ? undefined : c.req.header('x-lab-natural')
    const natural = nh ? nh === '1' : naturalMode() === 'on' || naturalMode() === 'live'
    const v = await voice(llm, sc, history, body.playerText, r.decision, r.state, natural)
    if (body.tts) speech.warm({ ...body.tts, text: v.line, emotion: v.emotion }, ip)
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
    return c.json({
      analysis,
      deltas: r.deltas,
      decision: r.decision,
      opponentLine: v.line,
      emotion: v.emotion,
      state: r.state,
      record,
      ...(done ? { report: buildReport(sc, [...history, record], dict) } : {}),
      sources: { analysis: a.source, voice: v.source, ...(lab ? { lab } : {}), ...(a.error || v.error ? { errors: [a.error, v.error].filter(Boolean) } : {}) },
    })
  })

  app.post('/api/report', async (c) => {
    const body = ReportBody.parse(await c.req.json())
    const sc = await resolveScenario(body)
    return c.json(buildReport(sc, normalizeHistory(sc, body.history), dict))
  })

  app.post('/api/scenario/generate', async (c) => {
    const req = GenerateRequest.parse(await c.req.json().catch(() => ({})))
    const r = await generateScenario(llm, req, scenarios)
    if (r.source === 'llm') {
      await mkdir(SAVED, { recursive: true })
      await writeFile(join(SAVED, `${r.scenario.id}.json`), JSON.stringify(r.scenario, null, 1))
    }
    return c.json(r)
  })

  // тренировки для команды: комната на дело, доска результатов по секрету руководителя
  app.route('/', roomsApi({ dir: roomsDir, resolve: (id) => resolveScenario({ scenarioId: id }), normalize: normalizeHistory }))

  app.route('/', speech.app)

  return app
}
