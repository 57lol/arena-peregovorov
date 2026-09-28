// Генерация сценария под запрос. LLM пишет историю: людей, пункты, варианты и роль каждого пункта.
// Таблицы очков и BATNA строит движок по ролям — языковые модели плохо считают баланс, а нам нужна
// гарантия, что зона соглашения есть и размен действительно создаёт ценность. Потом — две проверки;
// не прошло — повтор с замечаниями, потом подбор из библиотеки.

import { z } from 'zod'
import { auditScenario, pickFromLibrary } from '../content/scenarios'
import { checkScenario } from '../engine/validate'
import type { Difficulty, Issue, Scenario, Tone } from '../engine/types'
import { looksFemale, pickFace } from '../content/faces'
import { mentionedIssues, parseOffer } from '../engine/offline'
import { openingAnchor } from '../engine/policy'
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
  // возраст — чтобы лицо из пула было похоже по годам; модель иногда пишет строкой
  opponentAge: z.coerce.number().int().min(18).max(90).optional().catch(undefined),
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
    // модель путает порядок вариантов; прямой вопрос «что лучше игроку» она путает реже — по нему и выравниваем
    bestForPlayer: z.string().optional(),
  })).min(4).max(5),
  interests: z.array(z.object({ issue: z.string(), text: z.string() })).min(2).max(5),
})

const str = { type: 'string' }
export const SCHEMA = {
  name: 'scenario',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(Raw.shape),
    properties: {
      title: str, playerRole: str, playerBrief: str, playerBatnaText: str,
      opponentName: str, opponentGender: { type: 'string', enum: ['m', 'f'] }, opponentAge: { type: 'integer' }, opponentRole: str, opponentCompany: str, opponentSpeech: str, opponentBio: str,
      opponentBrief: str, opponentBatnaText: str, opening: str,
      issues: {
        type: 'array',
        // без границ YandexGPT иногда уходит в бесконечный список пунктов и обрывается посреди JSON
        minItems: 4,
        maxItems: 5,
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'title', 'role', 'options', 'bestForPlayer'],
          properties: {
            id: str, title: str, role: { type: 'string', enum: Object.keys(ROLES) },
            options: { type: 'array', minItems: 3, maxItems: 5, items: str },
            bestForPlayer: str,
          },
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

export const SYSTEM = `Ты — методист, который придумывает учебные кейсы для тренажёра деловых переговоров по нескольким пунктам (как упражнение New Recruit).
Кейс правдоподобный, российский по реалиям, с живыми людьми, без канцелярита и пафоса. Пиши как человек, а не как отдел кадров.
Не пиши «минимизировать», «оптимальный», «обеспечить», «осуществлять», «данный», «в рамках», «является» — говори проще: «чтобы не потерять деньги», «побыстрее», «сделать».

Структура:
- 4 или 5 пунктов. У каждого — role:
  split — стороны хотят противоположного и одинаково сильно (цена, оклад, ставка). Ровно 1.
  mine — очень важно игроку, оппоненту почти всё равно. Ровно 1.
  theirs — очень важно оппоненту, игроку почти всё равно. 1 или 2.
  shared — обе стороны на самом деле хотят одного и того же, но каждая думает, что другая против. Ровно 1.
    Пример: поставщику длинная гарантия выгодна (он продаёт сервисный контракт), а закупщик уверен, что тот будет её урезать.
    Интерес оппонента по shared должен объяснять, почему ему выгоден тот же вариант, что и игроку.
- options — 3–5 конкретных вариантов («30 дней», «1,2 млн ₽», «раз в неделю»), СТРОГО по порядку: первый — лучший для игрока, последний — худший для игрока. Для shared первый — тот, который на самом деле нужен обоим.
- Варианты короткие, до 5 слов, без повтора названия пункта: пункт «Предоплата» → «нет», «1 месяц», «3 месяца», а не «предоплата за 3 месяца».
- Слово «игрок» — служебное, в тексты для людей (brief, opening, interests) его не пиши.
- bestForPlayer — дословно тот вариант из options, который выгоднее всего игроку (для shared — нужный обоим). Подумай отдельно: например, заказчику выгоднее меньшая цена и оплата после работ, исполнителю — наоборот.
- id пунктов — латиницей, коротко (price, payment, term...).
- opponentName — только имя и фамилия, живые и не шаблонные (не Иван Иванов, не Игорь Петров). Должность — в opponentRole, компания — в opponentCompany.
- opponentGender — m или f, по имени.
- opponentAge — возраст оппонента числом, 25–65, под его должность и биографию.
- playerBrief — к игроку на «вы»; что знает игрок: ситуация и что важно ему (про mine — прямо, про shared — пусть думает, что оппонент против).
- opponentBrief — как оппонент выглядит снаружи.
- playerBatnaText, opponentBatnaText — запасной вариант каждой стороны словами, конкретно.
- interests — 2–4 скрытых интереса оппонента: что ему на самом деле важно и почему; issue — id пункта (обязательно про theirs и про shared).
  text — от первого лица, так, как он сам признался бы собеседнику: «склад у меня старый, каждый ремонт съедает прибыль», «мне важнее деньги сразу — плачу за кредит».
  Без его имени, без «он/она/ему», без канцелярита («минимизировать риски», «обеспечить стабильный доход»).
- opening — первая фраза оппонента: коротко, по-живому, с его стартовыми требованиями по всем пунктам, кроме shared, — по каждому ПОСЛЕДНИЙ вариант из options, дословно (это максимум в его пользу). Про shared в opening молчит. У игрока нет имени — не называй его по имени.
- opponentSpeech — манера речи в двух-трёх фразах; opponentBio — пара живых деталей о человеке.`

// Модель раз за разом зовёт всех «Игорь Петров» / «Сергей Кузнецов». Подсказываем первую букву имени —
// выбор по хэшу запроса: одинаковый запрос даёт ту же подсказку, разные — разные.
const LETTERS = 'АБВГДЕЗИКЛМНОРСТЭЮЯ'
const nameHint = (req: GenerateRequest) => LETTERS[parseInt(hashOf(req).slice(0, 8), 16) % LETTERS.length]

export function userPrompt(req: GenerateRequest, problems: string[]): string {
  const tone = { friendly: 'дружелюбный', neutral: 'нейтральный', cold: 'холодный', aggressive: 'напористый', evasive: 'уклончивый' }[req.opponentTone]
  return `Сфера: ${req.sphere}
Тема: ${req.theme || 'на твой выбор'}
Роль игрока: ${req.playerRole || 'на твой выбор'}
Характер оппонента: ${tone}
Что игрок хочет потренировать: ${req.goals || 'не указано'}${req.goals ? ' — построй кейс так, чтобы это пришлось делать' : ''}
Имя оппонента начинается на «${nameHint(req)}».
${problems.length ? `\nПрошлый вариант не прошёл проверку:\n- ${problems.join('\n- ')}\nИсправь это.` : ''}
Верни кейс JSON-объектом.`
}

const same = (a: string, b: string) => a.trim().toLowerCase().replace(/ё/g, 'е') === b.trim().toLowerCase().replace(/ё/g, 'е')
/** Варианты от лучшего для игрока к худшему: если модель назвала лучшим последний — переворачиваем. */
function orient(i: { options: string[]; bestForPlayer?: string }): string[] {
  const best = i.bestForPlayer ?? ''
  return best && same(best, i.options[i.options.length - 1]) && !same(best, i.options[0]) ? [...i.options].reverse() : i.options
}

/** Ответ модели, где «лучший для игрока» вариант ни первый, ни последний, — повод переписать. */
export function orderProblems(raw: z.infer<typeof Raw>): string[] {
  return raw.issues
    .filter((i) => i.bestForPlayer && !i.options.some((o, n) => (n === 0 || n === i.options.length - 1) && same(o, i.bestForPlayer!)))
    .map((i) => `«${i.title}»: bestForPlayer должен дословно совпадать с первым вариантом, а варианты идти от лучшего для игрока к худшему`)
}

/** Компания повторяет должность: «руководитель строительной фирмы» + «строительная фирма» (сравниваем по основам слов). */
function echoes(role: string, company: string): boolean {
  const r = role.toLowerCase()
  const words = company.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 4)
  return words.every((w) => r.includes(w.slice(0, Math.min(5, w.length - 1))))
}

const cap = (t: string) => t.trim().replace(/^\p{Ll}/u, (c) => c.toUpperCase())
/** «30000» → «30 000»; четырёхзначные — только перед рублями, чтобы не трогать годы. */
const digits = (t: string) =>
  t.replace(/(?<![\d,.])\d{5,}(?![\d,.])|(?<![\d,.])\d{4}(?=\s?(₽|руб))/gu, (n) => Number(n).toLocaleString('ru-RU').replace(/\s/g, '\u00a0'))
/** Текст для людей: с заглавной, с точкой в конце, числа с разрядами. */
const sentence = (t: string) => {
  const x = digits(cap(t))
  return !x || /[.!?…»)]$/u.test(x) ? x : `${x}.`
}

/** Таблица стороны к сотне: сумма лучших вариантов ровно 100, как в делах из папки («25 из 100», а не «из 88»). */
export function to100(tables: number[][]): number[][] {
  const max = tables.reduce((s, p) => s + Math.max(...p), 0)
  if (!max) return tables
  const out = tables.map((p) => p.map((x) => Math.round((x * 100) / max)))
  const diff = 100 - out.reduce((s, p) => s + Math.max(...p), 0)
  // остаток от округления — в самый тяжёлый пункт, в его лучший вариант
  const k = out.reduce((b, p, n) => (Math.max(...p) > Math.max(...out[b]) ? n : b), 0)
  const at = out[k].indexOf(Math.max(...out[k]))
  out[k][at] += diff
  return out
}

/** Что игрок написал в «Что хотите потренировать»: по пунктам, с заглавной, без точки. */
function goalsFrom(text: string): string[] | undefined {
  const g = text.split(/[\n;]+/).map((x) => cap(x).replace(/[.\s]+$/u, '')).filter((x) => x.length > 1).slice(0, 4)
  return g.length ? g : undefined
}

/**
 * Первая реплика собеседника должна называть ровно его стартовое предложение — то, что лежит на столе.
 * Модель любит «начать с середины» или назвать совсем другое. Тогда оставляем из её реплики разговорную
 * часть без условий, а условия собираем по листку.
 */
export function fitOpening(sc: Scenario): string {
  const anchor = openingAnchor(sc)
  const said = parseOffer(sc, sc.opening)
  const main = sc.issues.find((i) => i.kind === 'distributive') ?? sc.issues[0]
  const ok = Object.entries(said).every(([k, v]) => anchor[k] === v) && said[main.id] === anchor[main.id]
  if (ok) return sc.opening
  const talk = (sc.opening.match(/[^.!?…]+[.!?…]*/gu) ?? [])
    .map((x) => x.trim())
    .filter((x) => x && !/\d/.test(x) && !mentionedIssues(sc, x).length && !Object.keys(parseOffer(sc, x)).length)
  // «стоимость уборки (₽) — 4500»: скобки из названия пункта вслух не произносят
  const terms = sc.issues
    .filter((i) => typeof anchor[i.id] === 'number')
    .map((i) => `${i.title.replace(/\s*\([^)]*\)/gu, '').toLowerCase()} — ${i.options[anchor[i.id]!]}`)
    .join(', ')
  return [...(talk.length ? talk : ['Добрый день.']), `Мои условия такие: ${terms}.`].join(' ')
}

/** Последние штрихи к делу, которое прошло проверки. */
export function finish(sc: Scenario): Scenario {
  return { ...sc, opening: fitOpening(sc) }
}

/** Очки по ролям: линейно по вариантам, вариант 0 — лучший для игрока. */
function pointsFor(role: Role, n: number, k: number, jitter = 0) {
  // ±10% к весам пункта по хэшу дела: иначе у всех сгенерированных дел одинаковые 30/28/18/8.
  // Больше нельзя: после приведения таблиц к сотне делимый пункт перекосится, а разменный выровняется.
  const j = 1 + ((jitter % 7) - 3) / 30
  const r = { player: ROLES[role].player * j, opponent: ROLES[role].opponent * (2 - j) }
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
  const h = hashOf(raw)
  const tables = raw.issues.map((i, n) => {
    const k = seen.get(i.role) ?? 0
    seen.set(i.role, k + 1)
    return pointsFor(i.role, i.options.length, k, parseInt(h.slice(n * 2, n * 2 + 2), 16))
  })
  const issues: Issue[] = raw.issues.map((i, n) => ({ id: ids[n], title: cap(i.title), options: orient(i).map(digits), kind: ROLES[i.role].kind }))
  const mine = to100(tables.map((t) => t.player))
  const theirs = to100(tables.map((t) => t.opponent))
  const pp = Object.fromEntries(ids.map((id, n) => [id, mine[n]]))
  const op = Object.fromEntries(ids.map((id, n) => [id, theirs[n]]))
  const pMax = maxScore({ points: pp, batna: 0, batnaText: '', interests: [] }, issues)
  const oMax = maxScore({ points: op, batna: 0, batnaText: '', interests: [] }, issues)
  const d = req.difficulty as Difficulty
  const name = raw.opponentName.split(',')[0].trim()
  const id = `gen-${hashOf({ raw, req }).slice(0, 10)}`
  const female = raw.opponentGender ? raw.opponentGender === 'f' : looksFemale(name)

  const sc: Scenario = {
    id,
    title: cap(raw.title),
    sphere: req.sphere,
    difficulty: d,
    turnLimit: 10 + d,
    issues,
    ...(goalsFrom(req.goals) ? { goals: goalsFrom(req.goals) } : {}),
    player: {
      role: raw.playerRole,
      brief: sentence(raw.playerBrief),
      profile: { points: pp, batna: Math.round(pMax * 0.28), batnaText: sentence(raw.playerBatnaText), interests: [] },
    },
    opponent: {
      character: {
        name, role: raw.opponentRole,
        // «руководитель строительной компании, строительная компания» — второй раз компанию не пишем
        company: echoes(raw.opponentRole, raw.opponentCompany) ? '' : raw.opponentCompany,
        tone: req.opponentTone as Tone,
        // лицо из пула: по полу, сфере и должности, возрасту; разные дела — разные лица
        portrait: pickFace({ id, female, age: raw.opponentAge, text: `${req.sphere} ${raw.title} ${raw.opponentRole} ${raw.opponentCompany}` }),
        speech: raw.opponentSpeech, bio: sentence(raw.opponentBio),
      },
      brief: sentence(raw.opponentBrief),
      profile: {
        points: op,
        batna: Math.round(oMax * OPP_BATNA[d]),
        batnaText: sentence(raw.opponentBatnaText),
        interests: raw.interests.map((it, n) => {
          const k = raw.issues.findIndex((i) => i.id === it.issue)
          return { id: `i${n + 1}`, text: it.text.trim().replace(/[.!\s]+$/u, ''), issue: k >= 0 ? ids[k] : undefined, trustToReveal: k >= 0 ? TRUST[raw.issues[k].role] : 70 }
        }),
      },
    },
    opening: sentence(raw.opening),
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
    .filter((it) => third.test(it.text.trim()) || /(?<!\p{L})игрок/iu.test(it.text) || (stem && it.text.toLowerCase().includes(stem)))
    .map((it) => `интерес «${it.text.slice(0, 60)}…» написан от третьего лица — перепиши от первого, как сам ${first || 'оппонент'} сказал бы собеседнику`)
    .concat(clerical(raw), longOptions(raw))
}

/** Вариант пункта — это то, что пишут в листок: «1 месяц», «за свой счёт». Больше пяти слов — уже фраза. */
function longOptions(raw: z.infer<typeof Raw>): string[] {
  const long = raw.issues.flatMap((i) => i.options).filter((o) => o.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length > 5)
  return long.length ? [`слишком длинные варианты: ${long.map((o) => `«${o}»`).join(', ')} — до 5 слов, как в листке`] : []
}

const CLERICAL = /(минимизир|оптимизац|оптимальн|осуществл|в рамках|является|данн(ый|ая|ое|ого) )/iu
/** Канцелярит в том, что читает игрок: бриф, первая реплика, интересы, варианты. */
function clerical(raw: z.infer<typeof Raw>): string[] {
  const texts = [raw.playerBrief, raw.opening, ...raw.interests.map((i) => i.text), ...raw.issues.flatMap((i) => i.options)]
  const hit = texts.map((t) => CLERICAL.exec(t)?.[0]).filter(Boolean)
  return hit.length ? [`канцелярит: ${[...new Set(hit)].map((w) => `«${w!.trim()}»`).join(', ')} — скажи проще, как в жизни`] : []
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
  let passableSoft = Infinity
  while (llm.name !== 'offline' && attempts < 3) {
    attempts++
    try {
      const raw = Raw.parse(await llm.json({ system: SYSTEM, user: userPrompt(req, problems), temperature: 0.7, maxTokens: 3000, schema: SCHEMA }))
      const order = orderProblems(raw)
      const r = order.length ? { problems: order, scenario: undefined } : scenarioProblems(toScenario(raw, req))
      const soft = r.problems.length ? [] : storyProblems(raw)
      // из рабочих вариантов запоминаем тот, где меньше всего замечаний к тексту
      if (!r.problems.length && soft.length < passableSoft) {
        passable = r.scenario
        passableSoft = soft.length
      }
      problems = [...r.problems, ...soft]
      if (!problems.length && r.scenario) return { scenario: finish(r.scenario), source: 'llm', attempts, problems: [] }
    } catch (e) {
      problems = [`Ответ не разобрался: ${(e as Error).message.slice(0, 300)}`]
    }
  }
  if (passable) return { scenario: finish(passable), source: 'llm', attempts, problems: [] }
  return { scenario: pickFromLibrary(req, library), source: 'library', attempts, problems }
}
