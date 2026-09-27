// Генерация сценария под запрос. LLM пишет историю: людей, пункты, варианты и роль каждого пункта.
// Таблицы очков и BATNA строит движок по ролям — языковые модели плохо считают баланс, а нам нужна
// гарантия, что зона соглашения есть и размен действительно создаёт ценность. Потом — две проверки;
// не прошло — повтор с замечаниями, потом подбор из библиотеки.

import { z } from 'zod'
import { auditScenario } from '../content/scenarios'
import { checkScenario } from '../engine/validate'
import type { Difficulty, Issue, Scenario, Tone } from '../engine/types'
import { maxScore } from '../engine/utility'
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

// Роль пункта → тип и веса (сколько очков пункт даёт максимум игроку и оппоненту).
const ROLES = {
  split: { kind: 'distributive', player: 30, opponent: 30 },        // делят: цена, оклад, ставка
  mine: { kind: 'integrative', player: 28, opponent: 8 },           // важно игроку, оппоненту почти всё равно
  theirs: { kind: 'integrative', player: 8, opponent: 26 },         // важно оппоненту, игроку почти всё равно
  shared: { kind: 'compatible', player: 18, opponent: 14 },         // оба хотят одного, но не знают
} as const
type Role = keyof typeof ROLES

const Raw = z.object({
  title: z.string().min(3),
  playerRole: z.string(),
  playerBrief: z.string(),
  playerBatnaText: z.string(),
  opponentName: z.string(),
  // пол — чтобы портрет и «встал/встала» совпадали с именем; в старых ответах его нет
  opponentGender: z.enum(['m', 'f']).optional(),
  opponentRole: z.string(),
  opponentCompany: z.string(),
  opponentSpeech: z.string(),
  opponentBio: z.string(),
  opponentBrief: z.string(),
  opponentBatnaText: z.string(),
  opening: z.string(),
  issues: z.array(z.object({
    id: z.string(),
    title: z.string(),
    role: z.enum(['split', 'mine', 'theirs', 'shared']),
    options: z.array(z.string()).min(3).max(5),
  })).min(4).max(5),
  interests: z.array(z.object({ issue: z.string(), text: z.string() })).min(2).max(5),
})

const str = { type: 'string' }
const SCHEMA = {
  name: 'scenario',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(Raw.shape),
    properties: {
      title: str, playerRole: str, playerBrief: str, playerBatnaText: str,
      opponentName: str, opponentGender: { type: 'string', enum: ['m', 'f'] }, opponentRole: str, opponentCompany: str, opponentSpeech: str, opponentBio: str,
      opponentBrief: str, opponentBatnaText: str, opening: str,
      issues: {
        type: 'array',
        // без границ YandexGPT иногда уходит в бесконечный список пунктов и обрывается посреди JSON
        minItems: 4,
        maxItems: 5,
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'title', 'role', 'options'],
          properties: { id: str, title: str, role: { type: 'string', enum: Object.keys(ROLES) }, options: { type: 'array', minItems: 3, maxItems: 5, items: str } },
        },
      },
      interests: {
        type: 'array',
        minItems: 2,
        maxItems: 5,
        items: { type: 'object', additionalProperties: false, required: ['issue', 'text'], properties: { issue: str, text: str } },
      },
    },
  },
}

const SYSTEM = `Ты — методист, который придумывает учебные кейсы для тренажёра деловых переговоров по нескольким пунктам (как упражнение New Recruit).
Кейс правдоподобный, российский по реалиям, с живыми людьми, без канцелярита и пафоса. Пиши как человек, а не как отдел кадров.

Структура:
- 4 или 5 пунктов. У каждого — role:
  split — стороны хотят противоположного и одинаково сильно (цена, оклад, ставка). Ровно 1.
  mine — очень важно игроку, оппоненту почти всё равно. Ровно 1.
  theirs — очень важно оппоненту, игроку почти всё равно. 1 или 2.
  shared — обе стороны на самом деле хотят одного и того же, но каждая думает, что другая против. Ровно 1.
    Пример: поставщику длинная гарантия выгодна (он продаёт сервисный контракт), а закупщик уверен, что тот будет её урезать.
    Интерес оппонента по shared должен объяснять, почему ему выгоден тот же вариант, что и игроку.
- options — 3–5 конкретных вариантов («30 дней», «1,2 млн ₽», «раз в неделю»), СТРОГО по порядку: первый — лучший для игрока, последний — худший для игрока. Для shared первый — тот, который на самом деле нужен обоим.
- id пунктов — латиницей, коротко (price, payment, term...).
- opponentName — только имя и фамилия, живые и не шаблонные (не Иван Иванов, не Игорь Петров). Должность — в opponentRole, компания — в opponentCompany.
- opponentGender — m или f, по имени.
- playerBrief — к игроку на «вы»; что знает игрок: ситуация и что важно ему (про mine — прямо, про shared — пусть думает, что оппонент против).
- opponentBrief — как оппонент выглядит снаружи.
- playerBatnaText, opponentBatnaText — запасной вариант каждой стороны словами, конкретно.
- interests — 2–4 скрытых интереса оппонента: что ему на самом деле важно и почему; issue — id пункта (обязательно про theirs и про shared).
  text — от первого лица, так, как он сам признался бы собеседнику: «склад у меня старый, каждый ремонт съедает прибыль», «мне важнее деньги сразу — плачу за кредит».
  Без его имени, без «он/она/ему», без канцелярита («минимизировать риски», «обеспечить стабильный доход»).
- opening — первая фраза оппонента: коротко, по-живому, с его стартовыми требованиями по split и theirs (максимум в свою пользу).
- opponentSpeech — манера речи в двух-трёх фразах; opponentBio — пара живых деталей о человеке.`

function userPrompt(req: GenerateRequest, problems: string[]): string {
  const tone = { friendly: 'дружелюбный', neutral: 'нейтральный', cold: 'холодный', aggressive: 'напористый', evasive: 'уклончивый' }[req.opponentTone]
  return `Сфера: ${req.sphere}
Тема: ${req.theme || 'на твой выбор'}
Роль игрока: ${req.playerRole || 'на твой выбор'}
Характер оппонента: ${tone}
Цели игрока: ${req.goals || 'не указаны'}
${problems.length ? `\nПрошлый вариант не прошёл проверку:\n- ${problems.join('\n- ')}\nИсправь это.` : ''}
Верни кейс JSON-объектом.`
}

/** Очки по ролям: линейно по вариантам, вариант 0 — лучший для игрока. */
function pointsFor(role: Role, n: number, k: number) {
  const r = ROLES[role]
  const down = (w: number) => Array.from({ length: n }, (_, i) => Math.round((w * (n - 1 - i)) / (n - 1)))
  const up = (w: number) => Array.from({ length: n }, (_, i) => Math.round((w * i) / (n - 1)))
  const scale = k > 0 ? 0.6 : 1 // второй пункт той же роли весит меньше
  return {
    player: down(Math.round(r.player * scale)),
    opponent: role === 'shared' ? down(Math.round(r.opponent * scale)) : up(Math.round(r.opponent * scale)),
  }
}

// Сложность: чем выше, тем лучше альтернатива у оппонента и уже зона соглашения.
const OPP_BATNA: Record<Difficulty, number> = { 1: 0.25, 2: 0.32, 3: 0.4 }
const TRUST: Record<Role, number> = { shared: 30, mine: 40, theirs: 50, split: 65 }

export function toScenario(raw: z.infer<typeof Raw>, req: GenerateRequest): Scenario {
  const seen = new Map<Role, number>()
  const ids = raw.issues.map((i, n) => (i.id.replace(/[^a-z0-9_]/gi, '').toLowerCase() || `issue${n}`) + (raw.issues.findIndex((j) => j.id === i.id) < n ? n : ''))
  const tables = raw.issues.map((i) => {
    const k = seen.get(i.role) ?? 0
    seen.set(i.role, k + 1)
    return pointsFor(i.role, i.options.length, k)
  })
  const issues: Issue[] = raw.issues.map((i, n) => ({ id: ids[n], title: i.title, options: i.options, kind: ROLES[i.role].kind }))
  const pp = Object.fromEntries(ids.map((id, n) => [id, tables[n].player]))
  const op = Object.fromEntries(ids.map((id, n) => [id, tables[n].opponent]))
  const pMax = maxScore({ points: pp, batna: 0, batnaText: '', interests: [] }, issues)
  const oMax = maxScore({ points: op, batna: 0, batnaText: '', interests: [] }, issues)
  const d = req.difficulty as Difficulty
  const name = raw.opponentName.split(',')[0].trim()

  const sc: Scenario = {
    id: `gen-${hashOf({ raw, req }).slice(0, 10)}`,
    title: raw.title,
    sphere: req.sphere,
    difficulty: d,
    turnLimit: 10 + d,
    issues,
    player: {
      role: raw.playerRole,
      brief: raw.playerBrief,
      profile: { points: pp, batna: Math.round(pMax * 0.28), batnaText: raw.playerBatnaText, interests: [] },
    },
    opponent: {
      character: {
        name, role: raw.opponentRole, company: raw.opponentCompany,
        tone: req.opponentTone as Tone,
        portrait: raw.opponentGender === 'f' ? 'olga' : raw.opponentGender === 'm' ? 'rinat' : `tone-${req.opponentTone}`,
        speech: raw.opponentSpeech, bio: raw.opponentBio,
      },
      brief: raw.opponentBrief,
      profile: {
        points: op,
        batna: Math.round(oMax * OPP_BATNA[d]),
        batnaText: raw.opponentBatnaText,
        interests: raw.interests.map((it, n) => {
          const k = raw.issues.findIndex((i) => i.id === it.issue)
          return { id: `i${n + 1}`, text: it.text.trim().replace(/[.!\s]+$/u, ''), issue: k >= 0 ? ids[k] : undefined, trustToReveal: k >= 0 ? TRUST[raw.issues[k].role] : 70 }
        }),
      },
    },
    opening: raw.opening,
  }
  return sc
}

/** Все проблемы сценария: наша проверка + аудит методиста из content. */
export function scenarioProblems(sc: Scenario): { problems: string[]; scenario: Scenario } {
  const check = checkScenario(sc)
  if (check.problems.length) return check
  return { problems: auditScenario(check.scenario, 1.1).problems, scenario: check.scenario }
}

/**
 * Замечания к тексту, из-за которых дело не ломается, но звучит плохо: интерес от третьего лица
 * («Игорь хочет…») нельзя вложить в уста самому Игорю. Просим переписать, но если попытки кончились — берём как есть.
 */
export function storyProblems(raw: z.infer<typeof Raw>): string[] {
  const first = raw.opponentName.trim().split(/[\s,]+/)[0] ?? ''
  const stem = first.length >= 5 ? first.slice(0, first.length - 1).toLowerCase() : ''
  const third = /^(он|она|ему|ей|его|её|для него|для неё|хочет|стремится|боится|опасается|заинтересован\p{L}*)(?![\p{L}])/iu
  return raw.interests
    .filter((it) => third.test(it.text.trim()) || (stem && it.text.toLowerCase().includes(stem)))
    .map((it) => `интерес «${it.text.slice(0, 60)}…» написан от третьего лица — перепиши от первого, как сам ${first || 'оппонент'} сказал бы собеседнику`)
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
  let passable: Scenario | undefined // прошло проверки движка, но с замечаниями к тексту
  while (llm.name !== 'offline' && attempts < 3) {
    attempts++
    try {
      const raw = Raw.parse(await llm.json({ system: SYSTEM, user: userPrompt(req, problems), temperature: 0.7, maxTokens: 3000, schema: SCHEMA }))
      const r = scenarioProblems(toScenario(raw, req))
      const soft = r.problems.length ? [] : storyProblems(raw)
      if (!r.problems.length) passable = r.scenario
      problems = [...r.problems, ...soft]
      if (!problems.length) return { scenario: r.scenario, source: 'llm', attempts, problems: [] }
    } catch (e) {
      problems = [`Ответ не разобрался: ${(e as Error).message.slice(0, 300)}`]
    }
  }
  if (passable) return { scenario: passable, source: 'llm', attempts, problems: [] }
  return { scenario: pickFromLibrary(req, library), source: 'library', attempts, problems }
}

/** Ближайший по сфере и сложности сценарий из библиотеки, с нужным характером оппонента. */
export function pickFromLibrary(req: GenerateRequest, library: Scenario[]): Scenario {
  const sphere = req.sphere.toLowerCase()
  const near = (s: Scenario) => (s.sphere.toLowerCase().includes(sphere) || sphere.includes(s.sphere.toLowerCase()) ? 0 : 1)
  const ranked = [...library].sort(
    (a, b) => near(a) - near(b) || Math.abs(a.difficulty - req.difficulty) - Math.abs(b.difficulty - req.difficulty) || a.id.localeCompare(b.id),
  )
  const base = ranked[0]
  return {
    ...base,
    difficulty: req.difficulty as Difficulty,
    opponent: { ...base.opponent, character: { ...base.opponent.character, tone: req.opponentTone as Tone } },
  }
}
