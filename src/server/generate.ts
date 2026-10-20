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
import { explicitOffer } from '../engine/offerEvidence'
import { openingAnchor } from '../engine/policy'
import { maxScore } from '../engine/utility'
import { focusOf, meetingTuning, settingsEffect, SKILLS, skillsOf, type Skill } from '../engine/settings'
import { hashOf } from './cache'
import type { LLM } from './llm'

export const GenerateRequest = z.object({
  sphere: z.string().max(80).default('закупки'),
  theme: z.string().max(300).default(''),
  playerRole: z.string().max(120).default(''),
  opponentTone: z.enum(['friendly', 'neutral', 'cold', 'aggressive', 'evasive']).default('neutral'),
  // роль и цели собеседника (ТЗ: «его роль и цели»); без default — старые запросы дают тот же промпт и тот же кэш
  opponentRole: z.string().max(120).optional(),
  opponentGoals: z.string().max(300).optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  goals: z.string().max(400).default(''),
  context: z.string().max(1500).transform((value) => value.trim() || undefined).optional(),
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
    bestForOpponent: z.string().optional(),
  })).min(3).max(5),
  // общий интерес — отдельным полем: внутри списка пунктов модель почти всегда делала его спорным (замер 18.10: 6 форм из 6)
  shared: z.object({
    id: z.string(),
    title: z.string(),
    options: z.array(z.string()).min(3).max(5),
    best: z.string(),
    interest: z.string(),
  }).optional(),
  interests: z.array(z.object({ issue: z.string(), text: z.string() })).min(1).max(5),
})
type RawCase = z.infer<typeof Raw>

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
        minItems: 3,
        maxItems: 4,
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'title', 'role', 'options', 'bestForPlayer', 'bestForOpponent'],
          properties: {
            id: str, title: str, role: { type: 'string', enum: ['split', 'mine', 'theirs'] },
            options: { type: 'array', minItems: 3, maxItems: 5, items: str },
            bestForPlayer: str,
            bestForOpponent: str,
          },
        },
      },
      shared: {
        type: 'object', additionalProperties: false, required: ['id', 'title', 'options', 'best', 'interest'],
        properties: { id: str, title: str, options: { type: 'array', minItems: 3, maxItems: 4, items: str }, best: str, interest: str },
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
- issues — 3 или 4 пункта, по которым стороны хотят ПРОТИВОПОЛОЖНОГО. У каждого — role:
  split — стороны тянут в разные стороны и одинаково сильно (цена, оклад, ставка). Ровно 1.
  mine — очень важно игроку, оппоненту почти всё равно. Ровно 1.
  theirs — очень важно оппоненту, игроку почти всё равно. 1 или 2.
- shared — ОТДЕЛЬНЫЙ пункт (не в issues), где обе стороны на самом деле хотят одного и того же, но каждая думает, что другая против.
  Пример: поставщику длинная гарантия выгодна (он продаёт сервисный контракт), а закупщик уверен, что тот будет её урезать.
  Варианты shared тоже короткие, до 5 слов. best — дословно вариант из его options, нужный обоим; interest — от первого лица оппонента, почему ему выгоден именно этот вариант.
- options — 3–5 конкретных вариантов («30 дней», «1,2 млн ₽», «раз в неделю»), СТРОГО по порядку: первый — лучший для игрока, последний — худший для игрока. В shared первый — тот, что нужен обоим.
- Варианты короткие, до 5 слов, без повтора названия пункта: пункт «Предоплата» → «нет», «1 месяц», «3 месяца», а не «предоплата за 3 месяца».
- Слово «игрок» — служебное, в тексты для людей (brief, opening, interests) его не пиши.
- bestForPlayer — дословно тот вариант из options, который выгоднее всего игроку. Подумай отдельно: например, заказчику выгоднее меньшая цена и оплата после работ, исполнителю — наоборот.
- bestForOpponent — дословно лучший вариант оппонента, по его целям, брифу и скрытым интересам. В issues он на другом конце списка, чем bestForPlayer.
- Явная цель из запроса важнее общих предположений: если нужен склад на год, год должен быть лучшим для арендатора. Если собственник не хочет оплачивать ремонт, лучший для него вариант — ремонт оплачивает арендатор; для арендатора наоборот. Не объявляй ремонт за свой счёт выгодным без явной причины в интересах.
- Направление выгоды — по стороне сделки. Покупателю, заказчику, арендатору выгоднее ниже цена, больше скидка, дольше отсрочка и гарантия, больше бесплатного; продавцу, исполнителю, арендодателю — наоборот. Исключение — только shared, и его interest это объясняет. Не бывает покупателя, который сам просит «без гарантии» или «без образцов», и продавца, которому выгодно раздать больше бесплатного.
- id пунктов — латиницей, коротко (price, payment, term...).
- opponentName — только имя и фамилия, живые и не шаблонные (не Иван Иванов, не Игорь Петров). Должность — в opponentRole, компания — в opponentCompany.
- opponentGender — m или f, по имени.
- opponentAge — возраст оппонента числом, 25–65, под его должность и биографию.
- playerBrief — к игроку на «вы»; что знает игрок: ситуация и что важно ему (про mine — прямо, про shared — пусть думает, что оппонент против).
- opponentBrief — как оппонент выглядит снаружи.
- playerBatnaText, opponentBatnaText — запасной вариант каждой стороны словами, конкретно.
- interests — 2–3 скрытых интереса оппонента по пунктам из issues: что ему на самом деле важно и почему; issue — id пункта (обязательно про theirs).
  text — от первого лица, так, как он сам признался бы собеседнику: «склад у меня старый, каждый ремонт съедает прибыль», «мне важнее деньги сразу — плачу за кредит».
  Без его имени, без «он/она/ему», без канцелярита («минимизировать риски», «обеспечить стабильный доход»).
- opening — первая фраза оппонента: коротко, по-живому, с его стартовыми требованиями по всем пунктам, кроме shared, — по каждому ПОСЛЕДНИЙ вариант из options, дословно (это максимум в его пользу). Про shared в opening молчит. У игрока нет имени — не называй его по имени.
- opponentSpeech — манера речи в двух-трёх фразах; opponentBio — пара живых деталей о человеке.`

// Модель раз за разом зовёт всех «Игорь Петров» / «Сергей Кузнецов». Подсказываем первую букву имени —
// выбор по хэшу запроса: одинаковый запрос даёт ту же подсказку, разные — разные.
const LETTERS = 'АБВГДЕЗИКЛМНОРСТЭЮЯ'
const nameHint = (req: GenerateRequest) => LETTERS[parseInt(hashOf(req).slice(0, 8), 16) % LETTERS.length]

/**
 * Кто из сторон платит. Модель путает стороны, когда игрок продаёт: закупщик у неё требует «без гарантии»
 * и «100% предоплату», а продавцу выгодна скидка 30%. Если сторону видно из роли (или, без роли, из сферы),
 * называем её в промпте прямо и потом проверяем денежные пункты (sideProblems).
 */
export type Side = 'payer' | 'payee'
// «собственник кафе» сам покупает, «видеограф, снимаю свадьбы» и «кадровое агентство» получают деньги: собственник,
// «снимаю» и «кадры» говорят о стороне только рядом с помещением или отделом кадров
const PAYEE = /продаж|продав|поставщик|исполнител|подрядчик|арендодател|сда[её]т|собственник\p{L}*\s+(?:помещ|здани|склад|квартир|офис|недвиж|объект|земл|площад)|кандидат|соискател|интегратор|производител|студи[яи] разработки/iu
const PAYER = /закуп|снабж|покупател|заказчик|арендатор|снима\p{L}*\s+(?:помещ|квартир|офис|склад|жиль|дом|комнат|здани|площад)|нанима|работодател|контрактн|(^|[^\p{L}])hr([^\p{L}]|$)|кадров\p{L}*\s+(?:служб|отдел|менеджер|директор)|отдел\p{L}*\s+кадр|рекрутер|менеджер по персоналу/iu
const ESTATE_OWNER = /владел\p{L}*\s+(склад|помещ|здани|офис|бизнес-центр|торгов|недвиж)/iu
function sideOfRole(role: string): Side | undefined {
  const payee = PAYEE.test(role) || ESTATE_OWNER.test(role)
  const payer = PAYER.test(role)
  return payee === payer ? undefined : payee ? 'payee' : 'payer'
}
export function sideOf(req: Pick<GenerateRequest, 'sphere' | 'playerRole' | 'opponentRole'>): Side | undefined {
  const role = req.playerRole.trim()
  const mine = role ? sideOfRole(role) : undefined
  if (mine) return mine
  // «владелец небольшого магазина» против «владельца склада»: сторону видно по тому, кто напротив
  const theirs = req.opponentRole?.trim() ? sideOfRole(req.opponentRole) : undefined
  if (theirs) return theirs === 'payee' ? 'payer' : 'payee'
  if (role) return undefined
  // роль не указана — по сфере, как в подсказках формы: «Продажи» — продаёте, остальное — платите
  const sphere = req.sphere.toLowerCase()
  if (/продаж/.test(sphere)) return 'payee'
  if (/закуп|найм|аренд|подряд/.test(sphere)) return 'payer'
  return undefined
}
const SIDE_LINE: Record<Side, string> = {
  payee:
    'Сторона игрока: он ПРОДАЁТ (товар, работу, помещение или себя как специалиста) и ПОЛУЧАЕТ деньги. Оппонент — тот, кто ПЛАТИТ. ' +
    'Значит, в options первым идёт выгодное продавцу: скидка — самая маленькая, предоплата — самая большая, отсрочка — самая короткая, цена — самая высокая, гарантия — самая короткая (если это не shared). ' +
    'Оппонент-покупатель в opening требует обратного: большую скидку, без предоплаты, длинную отсрочку и гарантию.',
  payer:
    'Сторона игрока: он ПЛАТИТ (покупатель, заказчик, арендатор или работодатель). Оппонент — тот, кто ПОЛУЧАЕТ деньги. ' +
    'Значит, в options первым идёт выгодное покупателю: цена — самая низкая, скидка — самая большая, отсрочка — самая длинная, предоплата — самая маленькая, гарантия — самая длинная.',
}

// Тон — не только слово в промпте: как он звучит в opening, opponentSpeech и opponentBio
const TONE_HOW: Record<Tone, string> = {
  friendly: 'тёплый, шутит, легко идёт на разговор о себе, но своё отстаивает',
  neutral: 'деловой, ровный, без лишних эмоций',
  cold: 'сухой, короткие фразы, держит дистанцию, о себе не говорит',
  aggressive: 'давит: перебивает, торопит, ссылается на конкурентов, но без хамства',
  evasive: 'уходит от прямых ответов, «надо посоветоваться», цифры называет неохотно',
}
const DIFFICULTY_HOW: Record<Difficulty, string> = {
  1: 'простое: зона торга широкая, у оппонента слабый запасной вариант (называй его без цифр, расплывчато)',
  2: 'среднее: у оппонента есть рабочий запасной вариант, конкретный',
  3: 'трудное: у оппонента сильный запасной вариант с цифрой, он может уйти без сделки, и скрытые интересы спрятаны глубже',
}

export function userPrompt(req: GenerateRequest, problems: string[]): string {
  const tone = { friendly: 'дружелюбный', neutral: 'нейтральный', cold: 'холодный', aggressive: 'напористый', evasive: 'уклончивый' }[req.opponentTone]
  const side = sideOf(req)
  const skills = skillsOf(req.goals)
  return `Сфера: ${req.sphere}
Тема: ${req.theme || 'на твой выбор'}
Роль игрока: ${req.playerRole || 'на твой выбор'}${side ? `\n${SIDE_LINE[side]}` : ''}
Характер оппонента: ${tone} — ${TONE_HOW[req.opponentTone]}; пусть это слышно в opening и opponentSpeech
Сложность: ${DIFFICULTY_HOW[req.difficulty as Difficulty]}${req.opponentRole?.trim() ? `\nКто оппонент: ${req.opponentRole.trim()} — сделай его именно таким (должность, положение, сторона сделки)` : ''}${req.opponentGoals?.trim() ? `\nЧего добивается оппонент: ${req.opponentGoals.trim()} — пусть его стартовые требования и скрытые интересы исходят из этого` : ''}
Что игрок хочет потренировать: ${req.goals || 'не указано'}${req.goals ? ' — построй кейс так, чтобы это пришлось делать' : ''}${skills.map((k) => `\n- ${SKILLS[k].prompt}`).join('')}
Имя оппонента начинается на «${nameHint(req)}».${req.context?.trim() ? `\nПожелание к сюжету от руководителя (своя история / контекст):\n${req.context.trim()}\nИспользуй это как контекст истории; сохрани схему кейса, роли сторон и проверяемый баланс условий.` : ''}
${problems.length ? `\nПрошлый вариант не прошёл проверку:\n- ${problems.join('\n- ')}\nИсправь это.` : ''}
Верни кейс JSON-объектом.`
}

const same = (a: string, b: string) => a.trim().toLowerCase().replace(/ё/g, 'е') === b.trim().toLowerCase().replace(/ё/g, 'е')
/** Варианты от лучшего для игрока к худшему: если модель назвала лучшим последний — переворачиваем. */
function orient(i: { options: string[]; bestForPlayer?: string }): string[] {
  const best = i.bestForPlayer ?? ''
  return best && same(best, i.options[i.options.length - 1]) && !same(best, i.options[0]) ? [...i.options].reverse() : i.options
}

// Единицы срока и денег: «1 год» больше «3 месяцев», «1,2 млн» больше «900 тыс.». Без этого гарантия
// «1 год → 3 месяца» у закупщика считалась перевёрнутой, и сборка падала («перепутаны стороны», прод 18.10).
const UNITS: [RegExp, number][] = [
  [/(^|[^\p{L}])(млн|миллион)/iu, 1e6],
  [/(^|[^\p{L}])(тыс|тысяч)/iu, 1e3],
  [/(^|[^\p{L}])(год|года|лет)([^\p{L}]|$)/iu, 365],
  [/(^|[^\p{L}])(мес|месяц\p{L}*)([^\p{L}]|$)/iu, 30],
  [/(^|[^\p{L}])недел\p{L}*/iu, 7],
  [/(^|[^\p{L}])(день|дня|дней|дн)([^\p{L}]|$)/iu, 1],
]
/** Число в варианте для сравнения «больше/меньше»; «без предоплаты», «по факту», «нет» — ноль. */
export function amount(o: string): number {
  if (/(^|[^\p{L}])полгода|полугод/iu.test(o)) return 182
  const m = o.replace(/\s(?=\d{3}(\D|$))/gu, '').match(/\d+(?:[.,]\d+)?/)
  const unit = UNITS.find(([re]) => re.test(o))?.[1]
  if (m) return parseFloat(m[0].replace(',', '.')) * (unit ?? 1)
  if (/(^|[^\p{L}])(без|нет|по факту|после|сразу|не требуется)([^\p{L}]|$)/iu.test(o)) return 0
  return unit && unit < 1000 ? unit : NaN // «через год», «месяц»
}

/**
 * Чему в пункте выгодно «больше»: тому, кто получает деньги (цена, предоплата), или тому, кто платит
 * (скидка, отсрочка, гарантия). Непонятные пункты не проверяем.
 */
function moreHelps(title: string, options: string[]): Side | undefined {
  const t = `${title} ${options.join(' ')}`.toLowerCase()
  // «предоплата 100% / 50 на 50 / отсрочка 30 дней» в одном пункте — числа про разное, не судим
  if (/отсрочк/.test(t) && /предоплат|аванс/.test(t)) return undefined
  if (/скидк/.test(t)) return 'payer'
  if (/отсрочк/.test(t)) return 'payer'
  // депозит и залог (в том числе «гарантийный») — деньги вперёд тому, кто сдаёт или продаёт
  if (/депозит|залог|обеспечительн|гарантийн\p{L}*\s+(?:платеж|платёж|взнос|сумм)/iu.test(title)) return 'payee'
  if (/гаранти/.test(title.toLowerCase()) && !/гарантирован/iu.test(title)) return 'payer'
  if (/предоплат|аванс/.test(t)) return 'payee'
  if (/(^|[^\p{L}])(цена|стоимость|ставка|тариф|оклад|зарплата|вознаграждение|гонорар)/iu.test(title)) return 'payee'
  return undefined
}

/** Денежный пункт повёрнут не в ту сторону: продавцу «выгоднее» скидка 30%, покупателю — «без гарантии». */
function sideWrong(i: { title: string; options: string[]; bestForPlayer?: string }, side: Side): boolean {
  const opts = orient(i)
  const helps = moreHelps(i.title, opts)
  const first = amount(opts[0])
  const last = amount(opts[opts.length - 1])
  if (!helps || Number.isNaN(first) || Number.isNaN(last) || first === last) return false
  // первый вариант — лучший для игрока: ему должно быть выгодно то, в какую сторону он идёт
  return (helps === side) !== first > last
}

/** Денежные пункты, повёрнутые не в ту сторону (для журнала и тестов; settle их сам переворачивает). */
export function sideProblems(raw: Pick<RawCase, 'issues'>, side: Side | undefined): string[] {
  if (!side) return []
  const who = side === 'payee' ? 'продаёт и получает деньги' : 'платит'
  return raw.issues
    .filter((i) => i.role !== 'shared' && sideWrong(i, side))
    .map((i) => `«${i.title}»: игрок ${who}, ему выгоднее ${(moreHelps(i.title, orient(i)) === side) ? 'больше' : 'меньше'}, а варианты повёрнуты наоборот — перепутаны стороны сделки`)
}

const norm = (t: string) => t.trim().toLowerCase().replace(/ё/g, 'е').replace(/[«»"'.,!]/g, '').replace(/\s+/g, ' ')
/** Номер варианта по тексту модели: дословно, а если она чуть переписала — единственный похожий. */
function optionIndex(options: string[], text: string | undefined): number {
  const t = norm(text ?? '')
  if (!t) return -1
  const exact = options.findIndex((o) => norm(o) === t)
  if (exact >= 0) return exact
  const near = options.flatMap((o, k) => (norm(o).includes(t) || t.includes(norm(o)) ? [k] : []))
  return near.length === 1 ? near[0] : -1
}

const PRICE = /(^|[^\p{L}])(цена|стоимость|ставка|тариф|оклад|зарплат|вознагражд|гонорар|бюджет|сумма)/iu

export interface Settled {
  raw: RawCase
  /** что пришлось поправить за моделью — для журнала */
  fixes: string[]
  /** что поправить нельзя — повод переписать */
  problems: string[]
}

/**
 * Приводим ответ модели к согласованному делу, вместо того чтобы браковать его целиком.
 * Модель хорошо пишет историю и, как правило, верно называет, что лучше каждой стороне, но плохо держит
 * служебные роли: «общий» пункт у неё спорный, «важное мне» не размечено, лишний «делимый». Поэтому:
 * - что кому выгодно берём из bestForPlayer / bestForOpponent (а если одно не понять — из другого);
 * - денежные пункты сверяем со стороной сделки и переворачиваем, если модель их перепутала;
 * - роли split / mine / theirs раздаёт движок: нужен делимый, «важное мне» и «важное ему»;
 * - общий пункт — тот, где обе стороны назвали одно и то же.
 * Брак только если пунктов с конфликтом меньше трёх или общего пункта нет совсем.
 */
export function settle(raw: RawCase, side: Side | undefined): Settled {
  const fixes: string[] = []
  const sh = raw.shared
  const list = [
    ...raw.issues,
    ...(sh ? [{ id: sh.id, title: sh.title, role: 'shared' as const, options: sh.options, bestForPlayer: sh.best, bestForOpponent: sh.best }] : []),
  ]
  const interests = sh?.interest.trim() ? [...raw.interests, { issue: sh.id, text: sh.interest }] : raw.interests
  type Item = Omit<RawCase['issues'][number], 'role'> & { role: Role | undefined }
  const issues: Item[] = []
  for (const i of list) {
    const last = i.options.length - 1
    const edge = (k: number) => k === 0 || k === last
    let p = optionIndex(i.options, i.bestForPlayer)
    let o = optionIndex(i.options, i.bestForOpponent)
    const shared = i.role === 'shared'
    if (!edge(p)) {
      if (!edge(o)) {
        fixes.push(`«${i.title}»: не ясно, что кому выгодно, — пункт убран`)
        continue
      }
      p = shared ? o : last - o
    }
    // у «общего» пункта собеседнику назван другой вариант, пусть и средний, — значит, пункт спорный
    if (!edge(o)) o = shared && o < 0 ? p : last - p
    let role: Role | undefined = i.role
    if (o === p && !shared) {
      // Один и тот же лучший вариант у спорного пункта — чаще ошибка модели («арендатору выгодно без ремонта»).
      // Общим его делаем, только если общего пункта нет вовсе и это не деньги; иначе верим той стороне,
      // за которую модель написала скрытый интерес (собеседнику), а без интереса — игроку.
      if (!list.some((x) => x.role === 'shared') && !moreHelps(i.title, i.options)) role = 'shared'
      else if (interests.some((x) => x.issue === i.id)) p = last - o
      else o = last - p
      fixes.push(`«${i.title}»: обеим сторонам назван один вариант — ${role === 'shared' ? 'общий интерес' : 'развёл стороны'}`)
    } else if (o !== p && shared) {
      role = undefined
      fixes.push(`«${i.title}»: помечен общим, но стороны хотят разного — спорный пункт`)
    }
    let fixed = { ...i, role, bestForPlayer: i.options[p], bestForOpponent: i.options[o] }
    if (role !== 'shared' && side && sideWrong(fixed, side)) {
      fixed = { ...fixed, bestForPlayer: i.options[last - p], bestForOpponent: i.options[last - o] }
      fixes.push(`«${i.title}»: перепутаны стороны сделки — перевернул`)
    }
    issues.push(fixed)
  }

  const conflict = issues.filter((i) => i.role !== 'shared')
  const problems: string[] = []
  if (conflict.length < 3) problems.push('Нужно хотя бы 3 пункта в issues, где стороны хотят противоположного: цена, сроки, оплата и т. п.')
  if (conflict.length === issues.length)
    problems.push('Нет общего пункта: заполни shared — вариант, который на самом деле нужен обоим, и interest оппонента от первого лица, почему он ему выгоден')
  if (problems.length) return { raw, fixes, problems }

  // роли спорных пунктов: один делимый (лучше всего — цена), хотя бы одно «важное мне» и одно «важное ему»
  const asked = conflict.map((i) => i.role)
  const hasInterest = (i: { id: string }) => interests.some((x) => x.issue === i.id)
  const pick = (from: number[], prefer: (k: number) => boolean) => from.find(prefer) ?? from[0]
  const idx = conflict.map((_, k) => k)
  const split = pick(idx.filter((k) => asked[k] === 'split'), (k) => PRICE.test(conflict[k].title)) ??
    pick(idx.filter((k) => asked[k] === undefined), (k) => PRICE.test(conflict[k].title)) ??
    idx.find((k) => PRICE.test(conflict[k].title)) ?? 0
  const role: (Role | undefined)[] = asked.map((r, k) => (k === split ? 'split' : r))
  const free = (want: Role) => {
    const rest = idx.filter((k) => k !== split)
    const loose = rest.filter((k) => role[k] === undefined || role[k] === 'split')
    if (loose.length) return pick(loose, (k) => hasInterest(conflict[k]) === (want === 'theirs'))
    const other = want === 'mine' ? 'theirs' : 'mine'
    const spare = rest.filter((k) => role[k] === other)
    return spare.length > 1 ? pick(spare, (k) => hasInterest(conflict[k]) === (want === 'theirs')) : undefined
  }
  for (const want of ['mine', 'theirs'] as const)
    if (!role.includes(want)) {
      const k = free(want)
      if (k !== undefined) role[k] = want
    }
  conflict.forEach((i, k) => {
    const r = role[k] ?? (hasInterest(i) ? 'theirs' : 'mine')
    if (r !== i.role) fixes.push(`«${i.title}»: роль ${i.role ?? '—'} → ${r}`)
    i.role = r
  })
  return { raw: { ...raw, shared: undefined, issues: issues as RawCase['issues'], interests }, fixes, problems }
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

/** «Юрий: здравствуйте!» → «здравствуйте!»: модель иногда пишет реплику как в пьесе, с именем говорящего. */
export function unspeaker(line: string, name: string): string {
  const first = name.trim().split(/\s+/)[0]?.toLowerCase()
  const colon = line.indexOf(':')
  const head = line.slice(0, colon).trim().toLowerCase()
  return first && colon > 0 && head.startsWith(first) && name.toLowerCase().startsWith(head) ? line.slice(colon + 1).trim() : line
}

/** Последние штрихи к делу, которое прошло проверки. */
export function finish(sc: Scenario): Scenario {
  return { ...sc, opening: fitOpening(sc) }
}

/** Очки по ролям: линейно по вариантам, вариант 0 — лучший для игрока. */
// Навыки руководителя меняют веса, чтобы приём окупался: размен — разница в важности резче, общий пункт — весомее.
const SKILL_WEIGHTS: Partial<Record<Skill, Partial<Record<Role, { player: number; opponent: number }>>>> = {
  package: { mine: { player: 34, opponent: 6 }, theirs: { player: 6, opponent: 32 } },
  shared: { shared: { player: 22, opponent: 20 } },
}
function weightsOf(role: Role, skills: Skill[]): { player: number; opponent: number } {
  for (const s of skills) {
    const w = SKILL_WEIGHTS[s]?.[role]
    if (w) return w
  }
  return ROLES[role]
}

function pointsFor(role: Role, n: number, k: number, jitter = 0, skills: Skill[] = []) {
  // ±10% к весам пункта по хэшу дела: иначе у всех сгенерированных дел одинаковые 30/28/18/8.
  // Больше нельзя: после приведения таблиц к сотне делимый пункт перекосится, а разменный выровняется.
  const j = 1 + ((jitter % 7) - 3) / 30
  const w = weightsOf(role, skills)
  const r = { player: w.player * j, opponent: w.opponent * (2 - j) }
  const down = (w: number) => Array.from({ length: n }, (_, i) => Math.round((w * (n - 1 - i)) / (n - 1)))
  const up = (w: number) => Array.from({ length: n }, (_, i) => Math.round((w * i) / (n - 1)))
  const scale = k > 0 ? 0.6 : 1 // второй пункт той же роли весит меньше
  return {
    player: down(Math.round(r.player * scale)),
    opponent: role === 'shared' ? down(Math.round(r.opponent * scale)) : up(Math.round(r.opponent * scale)),
  }
}

// Зона торга, скорость уступок, характер и длина встречи — из настроек руководителя (engine/settings.ts).
const TRUST: Record<Role, number> = { shared: 30, mine: 40, theirs: 50, split: 65 }

export function toScenario(raw: z.infer<typeof Raw>, req: GenerateRequest): Scenario {
  const seen = new Map<Role, number>()
  const used = new Set<string>()
  const ids = raw.issues.map((i, n) => {
    const clean = i.id.replace(/[^a-z0-9_]/gi, '').toLowerCase().slice(0, 32)
    const base = !clean || Object.hasOwn(Object.prototype, clean) || clean === 'prototype' ? `issue${n}` : clean
    let id = base, suffix = 1
    while (used.has(id)) id = `${base}_${suffix++}`
    used.add(id)
    return id
  })
  const h = hashOf(raw)
  const skills = skillsOf(req.goals)
  const d = req.difficulty as Difficulty
  const tuning = meetingTuning(d, req.opponentTone as Tone, skills)
  const tables = raw.issues.map((i, n) => {
    const k = seen.get(i.role) ?? 0
    seen.set(i.role, k + 1)
    return pointsFor(i.role, i.options.length, k, parseInt(h.slice(n * 2, n * 2 + 2), 16), skills)
  })
  const issues: Issue[] = raw.issues.map((i, n) => {
    const options = orient(i)
    return {
      id: ids[n], title: cap(i.title), options: options.map(digits), kind: ROLES[i.role].kind,
      ...(i.bestForPlayer && i.bestForOpponent ? { preferences: {
        player: options.findIndex((o) => same(o, i.bestForPlayer!)),
        opponent: options.findIndex((o) => same(o, i.bestForOpponent!)),
      } } : {}),
    }
  })
  const mine = to100(tables.map((t) => t.player))
  const theirs = to100(tables.map((t) => t.opponent))
  const pp = Object.fromEntries(ids.map((id, n) => [id, mine[n]]))
  const op = Object.fromEntries(ids.map((id, n) => [id, theirs[n]]))
  const pMax = maxScore({ points: pp, batna: 0, batnaText: '', interests: [] }, issues)
  const oMax = maxScore({ points: op, batna: 0, batnaText: '', interests: [] }, issues)
  const name = raw.opponentName.split(',')[0].trim()
  const id = `gen-${hashOf({ raw, req }).slice(0, 10)}`
  const female = raw.opponentGender ? raw.opponentGender === 'f' : looksFemale(name)

  const sc: Scenario = {
    id,
    title: cap(raw.title),
    sphere: req.sphere,
    difficulty: d,
    turnLimit: tuning.turnLimit,
    issues,
    ...(goalsFrom(req.goals) ? { goals: goalsFrom(req.goals) } : {}),
    ...(skills.length ? { lessons: [...(goalsFrom(req.goals) ?? []), ...skills.map((s) => SKILLS[s].lesson)].slice(0, 6), focus: focusOf(skills) } : {}),
    tuning,
    player: {
      role: raw.playerRole,
      brief: sentence(raw.playerBrief),
      profile: { points: pp, batna: Math.round(pMax * tuning.playerBatna), batnaText: sentence(raw.playerBatnaText), interests: [] },
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
        batna: Math.round(oMax * tuning.oppBatna),
        batnaText: sentence(raw.opponentBatnaText),
        interests: raw.interests.map((it, n) => {
          const k = raw.issues.findIndex((i) => i.id === it.issue)
          return { id: `i${n + 1}`, text: it.text.trim().replace(/[.!\s]+$/u, ''), issue: k >= 0 ? ids[k] : undefined, trustToReveal: k >= 0 ? TRUST[raw.issues[k].role] : 70 }
        }),
      },
    },
    // «Юрий: здравствуйте!» — модель иногда пишет реплику как в пьесе, с именем говорящего
    opening: sentence(unspeaker(raw.opening, name)),
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

/**
 * Скрытый интерес собеседника по пункту называет выгодный ему вариант. Если модель перепутала стороны и в текстах, а
 * settle перевернул только очки, при раскрытии собеседник скажет одно, а торговаться будет за другое.
 */
export function sideTextProblems(sc: Scenario): string[] {
  const O = sc.opponent.profile
  return O.interests.flatMap((it) => {
    const issue = sc.issues.find((i) => i.id === it.issue)
    if (!issue || issue.kind === 'compatible') return []
    const said = explicitOffer(sc, it.text, parseOffer(sc, it.text))[issue.id]
    if (said === undefined) return []
    const pts = O.points[issue.id]
    return pts[said] * 2 < Math.max(...pts) + Math.min(...pts)
      ? [`интерес «${it.text.slice(0, 60)}» называет «${issue.options[said]}», а собеседнику по условиям это невыгодно — перепутаны стороны, перепиши интерес под его выгоду`]
      : []
  })
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

/**
 * Запас из папки — с той же стороной сделки: подрядчику или продавцу не отдаём дело, где он закупщик,
 * а арендатору или заказчику — дело, где он продаёт. В папке продаёт игрок только в «Удержать клиента».
 */
export function libraryRequest(req: GenerateRequest): GenerateRequest {
  const side = sideOf(req)
  if (side === 'payee') return { ...req, sphere: 'Продажи' }
  if (side === 'payer' && !/найм|закуп/i.test(req.sphere)) return { ...req, sphere: 'Закупки' }
  return req
}

export interface GenerateResult {
  scenario: Scenario
  source: 'llm' | 'library'
  attempts: number
  problems: string[]
  /** как настройки руководителя отразились в деле — несколько коротких строк (settingsEffect) */
  effect?: string[]
  /** какая модель написала историю — для журнала и проверки */
  model?: string
}

/**
 * Кто пишет историю: сначала лучшая модель (llm.writer — Claude Sonnet через AITunnel или Anthropic), потом основная
 * (YandexGPT Pro). Модель, которая не ответила или сломалась, из очереди выпадает; кончились все — дело из папки.
 */
export function writersOf(llm: LLM): LLM[] {
  return [llm.writer, llm].filter((m, k, all): m is LLM => !!m && m.name !== 'offline' && all.indexOf(m) === k)
}

/** Claude через AITunnel со строгой схемой не дружит (кэш, ограничения схемы) — схему кладём в промпт. */
const looseFor = (m: LLM) => m.name === 'aitunnel' && /^claude/.test(m.model)

/** Сводка для руководителя: параметры дела и — если дело новое — куда легли цели собеседника. */
export function effectOf(sc: Scenario, req: GenerateRequest, source: GenerateResult['source']): string[] {
  const lines = settingsEffect(sc)
  const goals = req.opponentGoals?.trim()
  if (source === 'llm' && goals) {
    const first = sc.opening.match(/[^.!?…]+[.!?…]*/gu)?.slice(-1)[0]?.trim()
    lines.splice(2, 0, `Цели собеседника («${goals.slice(0, 80)}») — в его стартовых требованиях${first ? `: «${first.slice(0, 140).replace(/[.\s]+$/u, '')}»` : ''}.`)
  }
  if (source === 'library') lines.unshift('Новое дело не собралось — подобрано похожее из папки; ниже его параметры.')
  return lines
}

export async function generateScenario(llm: LLM, req: GenerateRequest, library: Scenario[]): Promise<GenerateResult> {
  let problems: string[] = []
  let attempts = 0
  let passable: Scenario | undefined // прошло проверки движка, но с замечаниями к тексту
  let passableSoft = Infinity
  const writers = writersOf(llm)
  let w = 0
  let model: string | undefined
  const done = (r: Omit<GenerateResult, 'effect'>): GenerateResult => ({ ...r, effect: effectOf(r.scenario, req, r.source), ...(r.source === 'llm' && model ? { model } : {}) })
  while (w < writers.length && attempts < 3) {
    attempts++
    const writer = writers[w]
    try {
      const loose = looseFor(writer)
      // pro: своё дело — редкий и главный для настройки запрос, на Lite он почти всегда проваливается в папку
      let reply: unknown
      try {
        reply = await writer.json({ system: loose ? `${SYSTEM}\n\nJSON-схема ответа: ${JSON.stringify(SCHEMA.schema)}` : SYSTEM, user: userPrompt(req, problems), temperature: 0.6, maxTokens: 3000, schema: SCHEMA, pro: true, loose })
      } catch (e) {
        // модель не ответила — следующая попытка у следующей по очереди
        if (w < writers.length - 1) {
          console.log(`[своё дело] ${writer.name}:${writer.model} не ответила (${(e as Error).message}), пишет ${writers[w + 1].name}`)
          w++
        }
        throw e
      }
      const answer = Raw.parse(reply)
      const { raw, fixes, problems: broken } = settle(answer, sideOf(req))
      if (fixes.length) console.log(`[своё дело] попытка ${attempts}, поправлено: ${fixes.join('; ')}`)
      if (broken.length) {
        console.log(`[своё дело] попытка ${attempts}, переписать: ${broken.join('; ')}`)
        problems = broken
        continue
      }
      const r = scenarioProblems(toScenario(raw, req))
      if (!r.problems.length) r.problems.push(...sideTextProblems(r.scenario))
      const soft = r.problems.length ? [] : storyProblems(raw)
      // из рабочих вариантов запоминаем тот, где меньше всего замечаний к тексту
      if (!r.problems.length && soft.length < passableSoft) {
        model = `${writer.name}:${writer.model.split('/').pop()}`
        passable = r.scenario
        passableSoft = soft.length
      }
      problems = [...r.problems, ...soft]
      if (r.problems.length) console.log(`[своё дело] попытка ${attempts}, движок: ${r.problems.join('; ')}`)
      if (!problems.length && r.scenario) return done({ scenario: finish(r.scenario), source: 'llm', attempts, problems: [] })
      // дело рабочее, замечания только к тексту — ещё одну попытку тратим, только если время есть
      if (!r.problems.length && attempts >= 2) break
    } catch {
      problems = ['Ответ модели не удалось разобрать. Нужен кейс по указанной схеме.']
    }
  }
  if (passable) return done({ scenario: finish(passable), source: 'llm', attempts, problems: [] })
  return done({ scenario: pickFromLibrary(libraryRequest(req), library), source: 'library', attempts, problems })
}
