// Генерация сценария под запрос: LLM придумывает, движок проверяет. Не прошло — повтор с замечаниями,
// потом — подбор из библиотеки.

import { z } from 'zod'
import { auditScenario } from '../content/scenarios'
import { checkScenario } from '../engine/validate'
import type { Difficulty, Scenario, Tone } from '../engine/types'
import { hashOf } from './cache'
import type { LLM } from './llm'

export const GenerateRequest = z.object({
  sphere: z.string().max(80).default('закупки'),
  theme: z.string().max(300).default(''),
  playerRole: z.string().max(120).default(''),
  opponentTone: z.enum(['friendly', 'neutral', 'cold', 'aggressive', 'evasive']).default('neutral'),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  goals: z.string().max(400).default(''),
})
export type GenerateRequest = z.infer<typeof GenerateRequest>

const Raw = z.object({
  title: z.string(),
  turnLimit: z.number().int(),
  playerRole: z.string(),
  playerBrief: z.string(),
  playerBatna: z.number(),
  playerBatnaText: z.string(),
  opponentName: z.string(),
  opponentRole: z.string(),
  opponentCompany: z.string(),
  opponentSpeech: z.string(),
  opponentBio: z.string(),
  opponentBrief: z.string(),
  opponentBatna: z.number(),
  opponentBatnaText: z.string(),
  opening: z.string(),
  issues: z.array(z.object({
    id: z.string(),
    title: z.string(),
    options: z.array(z.string()),
    playerPoints: z.array(z.number()),
    opponentPoints: z.array(z.number()),
  })),
  interests: z.array(z.object({ id: z.string(), text: z.string(), issue: z.string(), trustToReveal: z.number() })),
})

const str = { type: 'string' }
const int = { type: 'integer' }
const SCHEMA = {
  name: 'scenario',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(Raw.shape),
    properties: {
      title: str, turnLimit: int, playerRole: str, playerBrief: str, playerBatna: int, playerBatnaText: str,
      opponentName: str, opponentRole: str, opponentCompany: str, opponentSpeech: str, opponentBio: str,
      opponentBrief: str, opponentBatna: int, opponentBatnaText: str, opening: str,
      issues: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['id', 'title', 'options', 'playerPoints', 'opponentPoints'],
          properties: { id: str, title: str, options: { type: 'array', items: str }, playerPoints: { type: 'array', items: int }, opponentPoints: { type: 'array', items: int } },
        },
      },
      interests: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'text', 'issue', 'trustToReveal'],
          properties: { id: str, text: str, issue: str, trustToReveal: int },
        },
      },
    },
  },
}

const SYSTEM = `Ты — методист, который придумывает учебные кейсы для тренажёра деловых переговоров по нескольким пунктам (как упражнение New Recruit).
Кейс должен быть правдоподобным, российским по реалиям, с живыми людьми, без канцелярита.

Как устроен кейс:
- 4 пункта (можно 3–5), в каждом 3–5 вариантов с конкретными цифрами или формулировками («30 дней», «1,2 млн ₽», «2 года»). id пунктов — латиницей, коротко.
- У каждой стороны свои очки за каждый вариант (целые, 0–40). Сумма максимумов по пунктам — около 100 у каждой стороны.
- Обязательно: 1 делимый пункт (стороны хотят противоположного и одинаково сильно, например цена);
  1 пункт, очень важный игроку и почти безразличный оппоненту; 1 пункт, очень важный оппоненту и почти безразличный игроку (на этом строится размен);
  желательно 1 совместимый пункт — обе стороны хотят одного и того же варианта, но не знают этого.
- BATNA каждой стороны — очки, которые она получит без сделки (около 30–45% от её максимума), и словами — какая это альтернатива.
- Должны существовать сделки, которые лучше BATNA для обоих. «Всё посередине» должно быть заметно хуже умного размена.
- У оппонента 2–4 скрытых интереса: что ему на самом деле важно и почему; issue — id пункта; trustToReveal 35–70 (чем сокровеннее, тем выше).
- opening — первая фраза оппонента, живая и короткая, с его стартовыми требованиями.
- turnLimit — 8–12.`

function userPrompt(req: GenerateRequest, problems: string[]): string {
  const tone = { friendly: 'дружелюбный', neutral: 'нейтральный', cold: 'холодный', aggressive: 'агрессивный', evasive: 'уклончивый' }[req.opponentTone]
  return `Сфера: ${req.sphere}
Тема: ${req.theme || 'на твой выбор'}
Роль игрока: ${req.playerRole || 'на твой выбор'}
Характер оппонента: ${tone}
Сложность: ${req.difficulty} из 3
Цели игрока: ${req.goals || 'не указаны'}
${problems.length ? `\nПрошлый вариант не прошёл проверку:\n- ${problems.join('\n- ')}\nИсправь это.` : ''}
Верни кейс JSON-объектом.`
}

export function toScenario(raw: z.infer<typeof Raw>, req: GenerateRequest): Scenario {
  const ids = raw.issues.map((i, n) => i.id.replace(/[^a-z0-9_]/gi, '') || `issue${n}`)
  const points = (side: 'playerPoints' | 'opponentPoints') =>
    Object.fromEntries(raw.issues.map((i, n) => [ids[n], i[side].map((x) => Math.round(x))]))
  const sc: Scenario = {
    id: `gen-${hashOf({ raw, req }).slice(0, 10)}`,
    title: raw.title,
    sphere: req.sphere,
    difficulty: req.difficulty as Difficulty,
    turnLimit: Math.max(6, Math.min(14, raw.turnLimit || 10)),
    issues: raw.issues.map((i, n) => ({ id: ids[n], title: i.title, options: i.options, kind: 'distributive' })),
    player: {
      role: raw.playerRole,
      brief: raw.playerBrief,
      profile: { points: points('playerPoints'), batna: raw.playerBatna, batnaText: raw.playerBatnaText, interests: [] },
    },
    opponent: {
      character: {
        name: raw.opponentName, role: raw.opponentRole, company: raw.opponentCompany,
        tone: req.opponentTone as Tone, portrait: `tone-${req.opponentTone}`, speech: raw.opponentSpeech, bio: raw.opponentBio,
      },
      brief: raw.opponentBrief,
      profile: {
        points: points('opponentPoints'),
        batna: raw.opponentBatna,
        batnaText: raw.opponentBatnaText,
        interests: raw.interests.map((it, n) => {
          const k = raw.issues.findIndex((i) => i.id === it.issue)
          return { id: it.id || `i${n}`, text: it.text, issue: k >= 0 ? ids[k] : undefined, trustToReveal: Math.max(30, Math.min(80, it.trustToReveal)) }
        }),
      },
    },
    opening: raw.opening,
  }
  return checkScenario(sc).scenario
}

export interface GenerateResult {
  scenario: Scenario
  source: 'llm' | 'library'
  attempts: number
  problems: string[]
}

export async function generateScenario(llm: LLM, req: GenerateRequest, library: Scenario[]): Promise<GenerateResult> {
  let problems: string[] = []
  let attempts = 0
  if (llm.name !== 'offline') {
    for (attempts = 1; attempts <= 3; attempts++) {
      try {
        const raw = Raw.parse(await llm.json({ system: SYSTEM, user: userPrompt(req, problems), temperature: 0.7, maxTokens: 3000, schema: SCHEMA }))
        const sc = toScenario(raw, req)
        const check = checkScenario(sc)
        // Вторая проверка — аудит методиста из content: размен ≥ ×1.1, ловушка, стартовый якорь.
        const audit = check.problems.length ? [] : auditScenario(check.scenario, 1.1).problems.filter((p) => !p.includes('compatible'))
        problems = [...check.problems, ...audit]
        if (!problems.length) return { scenario: check.scenario, source: 'llm', attempts, problems: [] }
      } catch (e) {
        problems = [`Ответ не разобрался: ${(e as Error).message.slice(0, 200)}`]
      }
    }
  }
  return { scenario: pickFromLibrary(req, library), source: 'library', attempts, problems }
}

/** Ближайший по сфере и сложности сценарий из библиотеки, с нужным характером оппонента. */
export function pickFromLibrary(req: GenerateRequest, library: Scenario[]): Scenario {
  const sphere = req.sphere.toLowerCase()
  const ranked = [...library].sort((a, b) => {
    const sa = a.sphere.toLowerCase().includes(sphere) || sphere.includes(a.sphere.toLowerCase()) ? 0 : 1
    const sb = b.sphere.toLowerCase().includes(sphere) || sphere.includes(b.sphere.toLowerCase()) ? 0 : 1
    return sa - sb || Math.abs(a.difficulty - req.difficulty) - Math.abs(b.difficulty - req.difficulty) || a.id.localeCompare(b.id)
  })
  const base = ranked[0]
  return {
    ...base,
    difficulty: req.difficulty as Difficulty,
    opponent: { ...base.opponent, character: { ...base.opponent.character, tone: req.opponentTone as Tone } },
  }
}
