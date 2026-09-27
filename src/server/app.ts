import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { buildReport } from '../engine/report'
import { initialState, step } from '../engine/turn'
import type { Scenario, TurnRecord } from '../engine/types'
import { checkScenario } from '../engine/validate'
import { withFormalOffer } from '../engine/offline'
import { analyzeMove } from './analyze'
import { GenerateRequest, generateScenario } from './generate'
import { dict, findScenario, scenarios } from './library'
import { makeLLM, type LLM } from './llm'
import { voice } from './voice'

const SAVED = join(process.env.CACHE_DIR ?? join(process.cwd(), '.cache'), 'scenarios')

const OfferSchema = z.record(z.string(), z.number().int().min(0))
const TurnBody = z.object({
  scenario: z.any().optional(),
  scenarioId: z.string().optional(),
  history: z.array(z.any()).default([]),
  playerText: z.string().trim().min(1).max(1500),
  offer: OfferSchema.optional(),
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

export function createApp(llm: LLM = makeLLM().llm, providerError?: string) {
  const app = new Hono()

  app.onError((e, c) => c.json({ error: e.message }, e instanceof z.ZodError ? 400 : 500))

  app.get('/api/health', (c) =>
    c.json({ ok: true, provider: llm.name, model: llm.model, ...(providerError ? { providerError } : {}), scenarios: scenarios.length }),
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

  app.post('/api/turn', async (c) => {
    const body = TurnBody.parse(await c.req.json())
    const sc = await resolveScenario(body)
    const history = normalizeHistory(sc, body.history)
    const before = history.length ? history[history.length - 1].stateAfter : initialState(sc)
    if (before.status !== 'open') return c.json({ error: 'Переговоры уже закончены', state: before }, 409)

    const a = await analyzeMove(llm, sc, dict, history, body.playerText, before.lastOpponentOffer)
    const analysis = withFormalOffer(a.analysis, body.offer)
    const r = step(sc, before, analysis, dict, history.map((h) => h.analysis))
    const v = await voice(llm, sc, dict, history, body.playerText, r.decision, r.state)
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
      sources: { analysis: a.source, voice: v.source, ...(a.error || v.error ? { errors: [a.error, v.error].filter(Boolean) } : {}) },
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

  return app
}
