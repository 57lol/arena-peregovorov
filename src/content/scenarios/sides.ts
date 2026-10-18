// Аудит сторон: кому что выгодно. Для каждого дела прогоняем реплики игрока (выгодные ему и невыгодные, отказы,
// голые числа) через разметку правилами и через проверку разметки модели, а потом — решения движка на всех сделках.
// Ищем одно: где слова игрока или ход собеседника перевёрнуты — игроку записали не то, что он просил, собеседник
// уступил сверх просьбы или согласился себе в убыток. Печать — scripts/sides-audit.ts, проверка — sides.test.ts.

import { BEHAVIOR_DICT } from '../../engine/behaviors'
import { groundAnalysis } from '../../engine/offerEvidence'
import { groundedOffline, parseOffer } from '../../engine/offline'
import { spokenNumber } from '../../engine/offline/parseOffer'
import { optionQuantity } from '../../engine/offline/numbers'
import { openingAnchor, tierOf, withConcessions } from '../../engine/policy'
import { initialState, step } from '../../engine/turn'
import type { IssueId, Offer, OpponentState, Scenario } from '../../engine/types'
import { allDeals, bestOption, isComplete, score, type FullOffer } from '../../engine/utility'

export type Severity = 'high' | 'medium' | 'low'

export interface SideProblem {
  case: string
  area: 'разметка' | 'разметка модели' | 'движок' | 'данные'
  severity: Severity
  text: string
}

/**
 * Реплика игрока и что в ней должно быть. offer — что он предлагает (так же размечает исправная модель);
 * none — пункты, которые он отверг: их не должно быть ни в разметке правилами, ни после проверки ошибки модели
 * (model — что модель по ошибке вытащила); either — голое число, которое подходит к нескольким пунктам:
 * правила не угадывают, а выбор модели проверка оставляет.
 */
export interface Probe {
  text: string
  offer?: Offer
  none?: [IssueId, number][]
  either?: [IssueId, number][]
  model?: Offer
}

const lc = (s: string) => s.toLowerCase()
const opt = (sc: Scenario, id: IssueId, n: number) => sc.issues.find((i) => i.id === id)!.options[n]
const show = (sc: Scenario, o: Offer | undefined) =>
  !o || !Object.keys(o).length ? '—' : Object.entries(o).map(([id, n]) => `${id}=${opt(sc, id, n!)}`).join(', ')

/** Реплики из самих вариантов: «Давайте X», «Предлагаю так: пункт — X», отказ «Только не X», голое число. */
export function generatedProbes(sc: Scenario): Probe[] {
  const en = sc.lang === 'en'
  const out: Probe[] = []
  for (const i of sc.issues) {
    for (const [n, o] of i.options.entries()) {
      const one = { [i.id]: n }
      if (en) {
        out.push({ text: `We propose ${lc(i.title)}: ${o}.`, offer: one })
        out.push({ text: `Not ${o}, no way.`, none: [[i.id, n]], model: one })
      } else {
        const negative = /^(?:нет|без|не)(?!\p{L})/iu.test(o)
        out.push({ text: `Предлагаю так: ${lc(i.title)} — ${o}.`, offer: one })
        if (negative) continue
        out.push({ text: `Давайте ${o}.`, offer: one })
        out.push({ text: `Только не ${o}, это не пойдёт.`, none: [[i.id, n]], model: one })
        if (!o.includes(',')) out.push({ text: `${o[0].toUpperCase()}${o.slice(1)} — нет, не годится.`, none: [[i.id, n]], model: one })
      }
      // голое число: «давайте 10» — к какому пункту, решает контекст; правила угадывать не должны
      const q = optionQuantity(o)
      const num = q && q.dim !== 'plain' && q.dim !== 'time' ? spokenNumber(o) : undefined
      if (num) {
        const same = sc.issues.flatMap((j) => j.options.flatMap((x, k) => (spokenNumber(x) === num && optionQuantity(x)?.dim !== 'time' ? [[j.id, k] as [IssueId, number]] : [])))
        out.push({ text: en ? `Let's say ${num}.` : `Давайте ${num}.`, ...(same.length > 1 ? { either: same } : { offer: one }) })
      }
    }
  }
  return out
}

/** Живые реплики по делам: как игрок правда говорит — с выгодой себе и с уступкой. Метки — как у исправной модели. */
export const NATURAL: Record<string, Probe[]> = {
  shop: [
    { text: 'Давайте обмен сегодня, кипятить не в чем.', offer: { swap: 3 } },
    { text: 'Верните деньги сегодня.', offer: { swap: 2 } },
    { text: 'Ладно, можно и возврат через десять дней, не горит.', offer: { swap: 1 } },
    { text: 'Давайте десять и пластиковую.', offer: { card: 1 }, either: [['disc', 2], ['swap', 1]], model: { disc: 2, card: 1 } },
    { text: 'Скидку пятнадцать процентов за беспокойство.', offer: { disc: 3 } },
    { text: 'Карту не надо, давайте без карты.', offer: { card: 0 } },
    { text: 'Мне нужен акт с фото и подписями.', offer: { paper: 2 } },
    { text: 'Я соглашусь на акт с фото и подписями, только если скидку дадите 15%.', offer: { paper: 2, disc: 3 } },
    { text: 'Только не проверка на двадцать дней.', none: [['swap', 0]], model: { swap: 0 } },
    { text: 'Сделайте скидку побольше.', none: [['disc', 3]], model: { disc: 3 } },
    { text: 'Виртуальная карта — нет, не хочу рассылку.', none: [['card', 2]], model: { card: 2 } },
    { text: 'Ладно, оформляйте виртуальную, но тогда скидка десять процентов.', offer: { card: 2, disc: 2 } },
  ],
  tara: [
    { text: 'Давайте 196 рублей за короб.', offer: { price: 2 } },
    { text: 'Давай дешевле.', none: [['price', 4]], model: { price: 4 } },
    { text: 'Отсрочку дайте тридцать дней.', offer: { payment: 2 } },
    { text: 'Оплата позже, не по факту.', none: [['payment', 0]], model: { payment: 0 } },
    { text: 'Согласен на 2 года, если цена 188.', offer: { term: 3, price: 3 } },
    { text: 'Договор на год.', offer: { term: 2 } },
    { text: 'Отгрузки раз в неделю.', offer: { schedule: 2 } },
    { text: 'Только не раз в месяц, склад не резиновый.', none: [['schedule', 0]], model: { schedule: 0 } },
    { text: 'Срочная допоставка за 48 часов.', offer: { rush: 4 } },
    { text: 'Цена 204 — нет, это дорого.', none: [['price', 1]], model: { price: 1 } },
  ],
  client: [
    { text: 'Цену оставляем без снижения.', offer: { price: 0 } },
    { text: 'Готовы снизить на 3%.', offer: { price: 1 } },
    { text: 'Договор на три года.', offer: { term: 2 } },
    { text: 'Отсрочка 45 дней.', offer: { payment: 1 } },
    { text: 'Страховой запас на неделю держим.', offer: { stock: 2 } },
    { text: 'Индексация раз в квартал.', offer: { index: 2 } },
    { text: 'Снижение 12% — не пойдёт.', none: [['price', 4]], model: { price: 4 } },
    { text: 'Согласен на 2 года, если отсрочка 60 дней.', offer: { term: 1, payment: 2 } },
  ],
  offer: [
    { text: 'Оклад 165 тысяч.', offer: { salary: 1 } },
    { text: 'Выход через месяц.', offer: { start: 1 } },
    { text: 'Общежитие на три месяца дадим.', offer: { housing: 1 } },
    { text: 'Два учебных дня в месяц.', offer: { study: 1 } },
    { text: 'Пусть ведёт запуск линии покраски.', offer: { project: 2 } },
    { text: 'Квартира на год — нет, это много.', none: [['housing', 3]], model: { housing: 3 } },
    { text: 'Готовы на 180, если выйдете через две недели.', offer: { salary: 2, start: 0 } },
    { text: 'Без учебных дней.', offer: { study: 0 } },
  ],
  china: [
    { text: 'Давайте 40 юаней за датчик.', offer: { price: 2 } },
    { text: 'Партия тысяча штук.', offer: { moq: 2 } },
    { text: 'Доставка авто через Казахстан за 20 дней.', offer: { delivery: 2 } },
    { text: 'Эталон и спецификация повторных поставок.', offer: { quality: 2 } },
    { text: 'Аккредитив после инспекции.', offer: { payment: 2 } },
    { text: 'Только не стопроцентная предоплата.', none: [['payment', 0]], model: { payment: 0 } },
    { text: 'Давайте 40.', either: [['price', 2], ['delivery', 0]] },
  ],
  istanbul: [
    { text: 'We can pay €450,000.', offer: { price: 2 } },
    { text: 'Fifty-fifty on payment.', offer: { payment: 2 } },
    { text: 'Delivery in 10 weeks.', offer: { delivery: 3 } },
    { text: 'Two-year warranty.', offer: { warranty: 2 } },
    { text: 'Two weeks of training on site.', offer: { training: 2 } },
    { text: 'Not 100% upfront, no way.', none: [['payment', 0]], model: { payment: 0 } },
    { text: "Let's say 12 weeks and 30% upfront.", offer: { delivery: 2, payment: 3 } },
  ],
  dorm: [
    { text: 'Давай я плачу 300 за вай-фай.', offer: { wifi: 2 } },
    { text: 'Тихо с 23:00.', offer: { quiet: 3 } },
    { text: 'График уборки на двери.', offer: { cleaning: 2 } },
    { text: 'Гости до 22:00.', offer: { guests: 1 } },
    { text: 'Чай и сахар вскладчину.', offer: { kitty: 1 } },
    { text: 'Только не выходные допоздна.', none: [['guests', 3]], model: { guests: 3 } },
    { text: 'Давай 450, но тишина с полуночи.', offer: { wifi: 1, quiet: 2 } },
  ],
  stop: [
    { text: 'Телефон доставать не буду.', offer: { phone: 3 } },
    { text: 'На громкой могу.', offer: { phone: 1 } },
    { text: 'Дам 150 на энергетик.', offer: { money: 2 } },
    { text: 'Влажные салфетки дам.', offer: { money: 3 } },
    { text: 'Две тысячи на кроссы — не, это перебор.', none: [['money', 0]], model: { money: 0 } },
    { text: 'Успеть бы на 7:52.', offer: { bus: 2 } },
  ],
  launch: [
    { text: 'Доплата 30%.', offer: { pay: 1 } },
    { text: 'Старт с понедельника.', offer: { start: 2 } },
    { text: 'Ранний рейс.', offer: { bus: 1 } },
    { text: 'Буфет до полуночи.', offer: { food: 1 } },
    { text: 'День с наладчиком.', offer: { train: 2 } },
    { text: 'Плюс пятьдесят — нет, много.', none: [['pay', 3]], model: { pay: 3 } },
    { text: 'Согласен на сорок процентов, если старт со среды.', offer: { pay: 2, start: 1 } },
  ],
}

/** Кому выгоден промах разметки: записали игроку хуже, чем он просил (в пользу собеседника) — это хуже всего. */
function direction(sc: Scenario, id: IssueId, want: number, got: number): Severity {
  const P = sc.player.profile.points[id]
  return P[got] < P[want] ? 'high' : 'medium'
}

function checkProbe(sc: Scenario, p: Probe): SideProblem[] {
  const out: SideProblem[] = []
  const add = (area: SideProblem['area'], severity: Severity, text: string) => out.push({ case: sc.id, area, severity, text: `«${p.text}» — ${text}` })
  const offline = groundedOffline(sc, p.text, BEHAVIOR_DICT).offer ?? {}
  const amb = new Set((p.either ?? []).map(([id]) => id))
  // разметка правилами: ни одного чужого пункта; отказ не становится предложением; голое число не угадывается
  for (const [id, n] of Object.entries(p.offer ?? {})) {
    const got = offline[id]
    if (got === undefined) add('разметка', 'low', `правила не услышали ${id}=${opt(sc, id, n!)}`)
    else if (got !== n) add('разметка', direction(sc, id, n!, got), `правила: ${id}=${opt(sc, id, got)} вместо «${opt(sc, id, n!)}»`)
  }
  for (const [id, got] of Object.entries(offline)) {
    if (p.offer?.[id] !== undefined) continue
    if (amb.has(id)) add('разметка', 'high', `голое число правила отнесли к ${id}=${opt(sc, id, got!)}, а оно может быть и о другом: ${show(sc, Object.fromEntries(p.either!))}`)
    else if (p.none?.some(([x, k]) => x === id && k === got)) add('разметка', 'high', `отказ от «${opt(sc, id, got!)}» записан как предложение`)
    else add('разметка', 'medium', `лишнее: ${id}=${opt(sc, id, got!)}`)
  }
  // разметка модели после проверки словами игрока: верную метку не теряем, ошибку модели не пропускаем
  const labels: Offer[] = p.model ? [p.model] : p.either ? p.either.map(([id, n]) => ({ ...p.offer, [id]: n })) : [p.offer ?? {}]
  for (const label of labels) {
    const kept = groundAnalysis(sc, p.text, { behaviors: [], offer: label }).offer ?? {}
    for (const [id, n] of Object.entries(label)) {
      const rejected = p.none?.some(([x, k]) => x === id && k === n)
      if (rejected && kept[id] === n) add('разметка модели', 'high', `модель ошиблась (${id}=${opt(sc, id, n!)}), а проверка пропустила отказ как предложение`)
      if (!rejected && kept[id] === undefined) add('разметка модели', 'medium', `верную метку модели ${id}=${opt(sc, id, n!)} проверка выбросила — движок не слышит игрока`)
      if (!rejected && kept[id] !== undefined && kept[id] !== n) add('разметка модели', direction(sc, id, n!, kept[id]!), `проверка заменила метку модели ${id}=${opt(sc, id, n!)} на «${opt(sc, id, kept[id]!)}»`)
    }
    for (const [id, got] of Object.entries(kept)) if (label[id] === undefined) add('разметка модели', 'high', `проверка добавила то, чего модель не говорила: ${id}=${opt(sc, id, got!)}`)
  }
  return out
}

/** Состояния, в которых проверяем ответы движка: начало, середина и конец встречи, разное доверие и напряжение. */
function states(sc: Scenario): { label: string; state: OpponentState }[] {
  const s0 = initialState(sc)
  const own: FullOffer = {}
  for (const i of sc.issues) own[i.id] = bestOption(sc.player.profile, i.id)
  const out: { label: string; state: OpponentState }[] = []
  for (const turn of [0, Math.floor(sc.turnLimit / 2), sc.turnLimit - 2]) for (const [trust, tension] of [[25, 45], [80, 20]]) {
    const r = step(sc, { ...s0, turn, trust, tension }, { behaviors: [], offer: own }, BEHAVIOR_DICT)
    if (r.state.status === 'open') out.push({ label: `ход ${turn + 2}, доверие ${trust}, напряжение ${tension}`, state: r.state })
  }
  return out
}

/**
 * Решения движка на всех сделках: не соглашается себе в убыток, не отказывается от того, что ему выгоднее своего
 * встречного, не забирает у игрока уступки и не тянет пункт туда, где хуже обоим.
 */
function checkEngine(sc: Scenario, every: number): SideProblem[] {
  const out: SideProblem[] = []
  const P = sc.player.profile, O = sc.opponent.profile
  const seen = new Set<string>()
  const add = (key: string, text: string) => {
    if (seen.has(key)) return
    seen.add(key)
    out.push({ case: sc.id, area: 'движок', severity: 'high', text })
  }
  const own: FullOffer = {}
  for (const i of sc.issues) own[i.id] = bestOption(P, i.id)
  for (const { label, state } of states(sc)) {
    const prev = state.lastOpponentOffer as FullOffer
    // в тесте — каждая n-я сделка (n взаимно просто с числом вариантов, так встречаются все варианты всех пунктов)
    for (const d of allDeals(sc).filter((_, n) => n % every === 0)) {
      const r = step(sc, state, { behaviors: [], offer: d.offer }, BEHAVIOR_DICT, [{ behaviors: [], offer: own }])
      if (r.decision.kind === 'accept') {
        if (d.opponent < O.batna) add('accept-batna', `${label}: согласилась на ${show(sc, d.offer)} — ей ${d.opponent}, без сделки ${O.batna}`)
        continue
      }
      const c = r.decision.kind === 'counter' || r.decision.kind === 'reveal' ? r.decision.offer : undefined
      if (!isComplete(sc, c)) continue
      // вариант хуже для обоих, чем просил игрок: собеседник не понимает, что выгодно ему самому
      const worse = sc.issues.find((i) => P.points[i.id][c[i.id]] < P.points[i.id][d.offer[i.id]] && O.points[i.id][c[i.id]] < O.points[i.id][d.offer[i.id]])
      if (worse) add(`worse-${worse.id}`, `${label}: игрок просит «${worse.options[d.offer[worse.id]]}», а встречное — «${worse.options[c[worse.id]]}», хуже для обоих`)
      if (score(O, c) < O.batna) add('counter-batna', `${label}: встречное ${show(sc, c)} ей хуже запасного варианта`)
      if (d.opponent >= score(O, c)) add('refused-better', `${label}: отказалась от ${show(sc, d.offer)} (ей ${d.opponent}), а сама предложила себе меньше (${score(O, c)})`)
      // уступки игроку не забирает: не хуже её прошлого встречного, где учтено то, что игрок отдал сам
      const ref = score(P, withConcessions(sc, prev, d.offer, own))
      if (score(P, c) < ref) add('takeback', `${label}: на ${show(sc, d.offer)} встречное ${show(sc, c)} даёт игроку ${score(P, c)} — меньше прошлого (${ref})`)
    }
  }
  return out
}

/** Данные: открывающая реплика называет её лучшие варианты и молчит о совместимом пункте; совместимый — лучший у обоих. */
function checkData(sc: Scenario): SideProblem[] {
  const out: SideProblem[] = []
  const add = (severity: Severity, text: string) => out.push({ case: sc.id, area: 'данные', severity, text })
  const anchor = openingAnchor(sc)
  // как правила прочли бы это от игрока: «отдать в руки, а не вот это „на громкой“» — «на громкой» отвергнута
  const said = groundAnalysis(sc, sc.opening, { behaviors: [], offer: parseOffer(sc, sc.opening) }).offer ?? {}
  for (const i of sc.issues) {
    const P = sc.player.profile.points[i.id], O = sc.opponent.profile.points[i.id]
    if (i.kind === 'compatible') {
      if (bestOption(sc.player.profile, i.id) !== bestOption(sc.opponent.profile, i.id)) add('high', `${i.id}: совместимый, но лучшие варианты у сторон разные`)
      if (said[i.id] !== undefined) add('medium', `первая реплика называет совместимый пункт «${i.title}» — о нём собеседник в начале молчит`)
      continue
    }
    const n = said[i.id]
    if (n !== undefined && n !== anchor[i.id] && P[n] > P[anchor[i.id]!]) add('high', `первая реплика обещает игроку «${i.options[n]}», а движок кладёт на стол «${i.options[anchor[i.id]!]}»`)
    if (O.indexOf(Math.max(...O)) === P.indexOf(Math.max(...P))) add('high', `${i.id}: помечен «${i.kind}», а лучший вариант у сторон один`)
  }
  if (sc.harder && tierOf(sc) <= Math.min(3, sc.difficulty)) add('medium', 'жёсткая версия не добавила упрямства')
  return out
}

/** every — проверять каждую n-ю сделку (1 — все; в тесте реже, чтобы не грузить машину). */
export function auditSides(sc: Scenario, opts: { natural?: Probe[]; every?: number } = {}): SideProblem[] {
  const natural = opts.natural ?? NATURAL[sc.id.replace(/-hard$/, '')] ?? []
  return [
    ...checkData(sc),
    ...[...generatedProbes(sc), ...natural].flatMap((p) => checkProbe(sc, p)),
    ...checkEngine(sc, opts.every ?? 1),
  ]
}
