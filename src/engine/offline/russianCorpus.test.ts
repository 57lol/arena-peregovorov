import { describe, expect, it } from 'vitest'
import { getScenario, harder } from '../../content/scenarios'
import { BEHAVIOR_DICT } from '../behaviors'
import { groundAnalysis } from '../offerEvidence'
import type { MoveAnalysis, Offer } from '../types'
import { groundedOffline } from './index'

// Авторские голосовые реплики, не стенограммы пользователей. Индексы заданы вручную.
// «Ну ок» без явного принятия — подтверждение, что услышал, а не закрытие сделки.
type Expected = Partial<Omit<MoveAnalysis, 'behaviors'>> & { behaviors?: string[] }
type Sample = [text: string, expected: Expected, said?: string]
const COMMON: Sample[] = [
  ['Ну ок', {}],
  ['Давайте', {}],
  ['Не, так не пойдёт', {}],
  ['Да, договорились', { accepts: true }],
  ['По рукам', { accepts: true }],
  ['Согласен, если условия поменяем', {}],
  ['Нет, я не согласен', {}],
  ['Всё, я пошёл', { walksAway: true }],
  ['Я не ухожу', {}],
  ['Я ухожу?', {}],
  ['Я уже пошёл вам навстречу', { behaviors: ['irritator'] }],
  ['Если не договоримся, я ухожу', { behaviors: ['ultimatum'] }],
  ['Что для вас сейчас самое важное?', { behaviors: ['ask_interest'], talk: ['question'] }],
  ['Вы идиот!', { toneViolation: true }],
  ['Простите, погорячился', { behaviors: ['rapport'], talk: ['apology'] }],
  ['Давайте сойдёмся посередине', { behaviors: ['split'] }],
]

// «Иней» — сцена кампании с тем же делом client, но отдельным набором реплик.
const CASES: [string, Sample[]][] = [
  ['dorm', [
    ['За вай-фай давай триста', { offer: { wifi: 2 } }],
    ['За вай-фай 300 рублей', { offer: { wifi: 2 } }],
    ['Шестьсот — дорого', {}],
    ['Не шестьсот, давай триста', { offer: { wifi: 2 } }],
    ['Четыреста пятьдесят за интернет, и по рукам', { offer: { wifi: 1 }, accepts: true }],
    ['Давай тихо с 23:00', { offer: { quiet: 3 } }],
    ['Тихо с полуночи', { offer: { quiet: 2 } }],
    ['С часу ночи тихо', { offer: { quiet: 1 } }],
    ['Уборка раз в неделю', { offer: { cleaning: 1 } }],
    ['Давай график на двери', { offer: { cleaning: 2 } }],
    ['Без гостей', { offer: { guests: 0 } }],
    ['Гости до 22:00', { offer: { guests: 1 } }],
    ['Суббота допоздна', { offer: { guests: 2 } }],
    ['Чай и сахар вскладчину', { offer: { kitty: 1 } }],
    ['Давай общая касса', { offer: { kitty: 2 } }],
    ['Почему тебе важна тишина?', { asksAbout: ['quiet'], behaviors: ['ask_interest'] }],
    ['Триста', { offer: { wifi: 2 } }, 'Сколько будешь платить за вай-фай?'],
    ['За вай-фай дам 450, если уборка раз в неделю', { offer: { wifi: 1, cleaning: 1 }, behaviors: ['package'] }],
  ]],
  ['stop', [
    ['Братан, сорян', { offer: { sorry: 1 }, behaviors: ['rapport'], talk: ['apology'] }],
    ['Прости, братан', { offer: { sorry: 2 }, behaviors: ['rapport'], talk: ['apology'] }],
    ['Извинюсь при пацанах', { offer: { sorry: 3 } }],
    ['Дам сто пятьдесят за энергетик', { offer: { money: 2 } }],
    ['150 рублей за энергетик', { offer: { money: 2 } }],
    ['Две тысячи — дорого', {}],
    ['Не две тысячи, давай пятьсот', { offer: { money: 1 } }],
    ['Пятихатку на химчистку', { offer: { money: 1 } }],
    ['Влажные салфетки дам', { offer: { money: 3 } }],
    ['Телефон на громкой', { offer: { phone: 1 } }],
    ['Телефон передать на словах', { offer: { phone: 2 } }],
    ['Телефон доставать не буду', { offer: { phone: 3 } }],
    ['Успеть на 7:52', { offer: { bus: 2 } }],
    ['Поедем следующим, в 8:20', { offer: { bus: 1 } }],
    ['Лады, договорились, братан', { accepts: true }],
    ['Лады', {}],
    ['Сорри, братан', { offer: { sorry: 1 }, behaviors: ['rapport'], talk: ['apology'] }],
    ['Зачем тебе телефон?', { asksAbout: ['phone'], behaviors: ['ask_interest'] }],
    ['Пятьсот', { offer: { money: 1 } }, 'Сколько дашь за кроссовки?'],
    ['Дам 150 рублей, если телефон на громкой', { offer: { money: 2, phone: 1 }, behaviors: ['package'] }],
  ]],
  ['shop', [
    ['Давайте скидку пятнадцать процентов', { offer: { disc: 3 } }],
    ['Скидка 10%', { offer: { disc: 2 } }],
    ['Пять процентов не пойдёт', {}],
    ['Не пять процентов, а десять', { offer: { disc: 2 } }],
    ['Десять процентов, и по рукам', { offer: { disc: 2 }, accepts: true }],
    ['Обмен сегодня', { offer: { swap: 3 } }],
    ['Деньги сегодня', { offer: { swap: 2 } }],
    ['Возврат через десять дней', { offer: { swap: 1 } }],
    ['Проверка до двадцати дней', { offer: { swap: 0 } }],
    ['Без карты', { offer: { card: 0 } }],
    ['Карта виртуальная', { offer: { card: 2 } }],
    ['Карта пластиковая', { offer: { card: 1 } }],
    ['Акт с фото и подписями', { offer: { paper: 2 } }],
    ['Заявление от руки', { offer: { paper: 1 } }],
    ['Без бумажек', { offer: { paper: 0 } }],
    ['Почему вам важна бонусная карта?', { asksAbout: ['card'], behaviors: ['ask_interest'] }],
    ['Десять', { offer: { disc: 2 } }, 'Какую скидку вы хотите?'],
    ['Десять', { offer: { swap: 1 } }, 'Через сколько дней сделать возврат?'],
  ]],
  ['launch', [
    ['Давайте доплату тридцать процентов', { offer: { pay: 1 } }],
    ['Доплата 30%', { offer: { pay: 1 } }],
    ['Пятьдесят процентов не потянем', {}],
    ['Не пятьдесят, давайте сорок процентов', { offer: { pay: 2 } }],
    ['Сорок процентов, и по рукам', { offer: { pay: 2 }, accepts: true }],
    ['Старт с понедельника', { offer: { start: 2 } }],
    ['Давайте со среды', { offer: { start: 1 } }],
    ['Старт на следующей неделе', { offer: { start: 0 } }],
    ['Автобус ранний рейс', { offer: { bus: 1 } }],
    ['Развоз по районам', { offer: { bus: 2 } }],
    ['Горячий ужин', { offer: { food: 2 } }],
    ['Буфет до полуночи', { offer: { food: 1 } }],
    ['Сухой паёк', { offer: { food: 0 } }],
    ['День с наладчиком', { offer: { train: 2 } }],
    ['Короткий инструктаж', { offer: { train: 1 } }],
    ['Почему вам важно обучение на роботах?', { asksAbout: ['train'], behaviors: ['ask_interest'] }],
    ['Тридцать', { offer: { pay: 1 } }, 'Какая будет ночная доплата?'],
    ['Дам доплату 40%, если старт с понедельника', { offer: { pay: 2, start: 2 }, behaviors: ['package'] }],
  ]],
  ['tara', [
    ['Давайте двести четыре', { offer: { price: 1 } }],
    ['Давайте 204', { offer: { price: 1 } }],
    ['Двести с копейками за короб', { offer: { price: 1 } }],
    ['Двести двенадцать — дорого', {}],
    ['Не двести двенадцать, а сто девяносто шесть', { offer: { price: 2 } }],
    ['Сто девяносто шесть, и по рукам', { offer: { price: 2 }, accepts: true }],
    ['Оплата по факту отгрузки', { offer: { payment: 0 } }],
    ['Отсрочка тридцать дней', { offer: { payment: 2 } }],
    ['Срочная допоставка за сорок восемь часов', { offer: { rush: 4 } }],
    ['Срочная допоставка за семь дней', { offer: { rush: 1 } }],
    ['Договор на два года', { offer: { term: 3 } }],
    ['Договор на шесть месяцев', { offer: { term: 1 } }],
    ['Отгрузки раз в неделю', { offer: { schedule: 2 } }],
    ['Отгрузки раз в две недели', { offer: { schedule: 1 } }],
    ['Цена 204, остальное как у вас', { offer: { price: 1 }, rest: true }],
    ['Почему вам важна отсрочка?', { asksAbout: ['payment'], behaviors: ['ask_interest'] }],
    ['Тридцать', { offer: { payment: 2 } }, 'Сколько дней отсрочки вам нужно?'],
    ['Дам 204 за короб, если срочная допоставка за 48 часов', { offer: { price: 1, rush: 4 }, behaviors: ['package'] }],
  ]],
  ['offer', [
    ['Предлагаю сто восемьдесят тысяч', { offer: { salary: 2 } }],
    ['Оклад 180000 рублей', { offer: { salary: 2 } }],
    ['У нас оклад 180 тысяч', { offer: { salary: 2 } }],
    ['Двести десять — это много', {}],
    ['Не двести десять, давайте сто девяносто пять', { offer: { salary: 3 } }],
    ['Сто восемьдесят, и по рукам', { offer: { salary: 2 }, accepts: true }],
    ['Выход через две недели', { offer: { start: 0 } }],
    ['Выход через шесть недель', { offer: { start: 2 } }],
    ['Выход через месяц', { offer: { start: 1 } }],
    ['Общежитие на три месяца', { offer: { housing: 1 } }],
    ['Квартира на шесть месяцев', { offer: { housing: 2 } }],
    ['Жильё без помощи', { offer: { housing: 0 } }],
    ['Учебные дни — нет', { offer: { study: 0 } }],
    ['Два учебных дня в месяц', { offer: { study: 1 } }],
    ['Поддержка действующих линий', { offer: { project: 0 } }],
    ['Ведёт запуск линии покраски', { offer: { project: 2 } }],
    ['Почему вам важны учебные дни?', { asksAbout: ['study'], behaviors: ['ask_interest'] }],
    ['Два', { offer: { start: 0 } }, 'Через сколько недель выйдете?'],
    ['Дам квартиру на год, если выход через две недели', { offer: { housing: 3, start: 0 }, behaviors: ['package'] }],
  ]],
  ['client', [
    ['Давайте скидку шесть процентов', { offer: { price: 2 } }],
    ['Скидка 6%', { offer: { price: 2 } }],
    ['Двенадцать процентов не потянем', {}],
    ['Не двенадцать, давайте девять процентов', { offer: { price: 3 } }],
    ['Девять процентов, и по рукам', { offer: { price: 3 }, accepts: true }],
    ['Договор на три года', { offer: { term: 2 } }],
    ['Договор на два года', { offer: { term: 1 } }],
    ['Отсрочка сорок пять дней', { offer: { payment: 1 } }],
    ['Отсрочка девяносто дней', { offer: { payment: 4 } }],
    ['Страховой запас на три дня', { offer: { stock: 1 } }],
    ['Страховой запас на неделю', { offer: { stock: 2 } }],
    ['Страховой запас на две недели', { offer: { stock: 3 } }],
    ['Индексация раз в квартал', { offer: { index: 2 } }],
    ['Индексация раз в год', { offer: { index: 1 } }],
    ['Без снижения цены', { offer: { price: 0 } }],
    ['Почему вам важен страховой запас?', { asksAbout: ['stock'], behaviors: ['ask_interest'] }],
    ['Три', { offer: { term: 2 } }, 'На сколько лет договор?'],
    ['Скидку дам, если предоплата', { behaviors: ['package'] }],
    ['Скидку не дам, даже если предоплата', { offer: { price: 0 } }],
  ]],
  ['inei', [
    ['Роза, предлагаю три процента скидки', { offer: { price: 1 } }],
    ['Роза, давайте 3% скидки', { offer: { price: 1 } }],
    ['Снижение на двенадцать процентов — не вариант', {}],
    ['Шесть процентов вместо двенадцати', { offer: { price: 2 } }],
    ['Сойдёмся на шести процентах', { offer: { price: 2 } }],
    ['Оставим цену твёрдой, без индексации', { offer: { index: 0 } }],
    ['Запас держим на неделю', { offer: { stock: 2 } }],
    ['Запас держим на три дня', { offer: { stock: 1 } }],
    ['Договор давайте на год', { offer: { term: 0 } }],
    ['По отсрочке давайте шестьдесят дней', { offer: { payment: 2 } }],
    ['По отсрочке давайте семьдесят пять дней', { offer: { payment: 3 } }],
    ['По отсрочке давайте тридцать дней', { offer: { payment: 0 } }],
    ['Скидку 6%, если договор на три года', { offer: { price: 2, term: 2 }, behaviors: ['package'] }],
    ['Согласен на скидку 9%, но договор на три года', { offer: { price: 3, term: 2 } }],
    ['Договор три года, остальное как у вас', { offer: { term: 2 }, rest: true }],
    ['Зачем вам отсрочка девяносто дней?', { asksAbout: ['payment'], behaviors: ['ask_interest'] }],
    ['Три', { offer: { price: 1 } }, 'Какую скидку даёте?'],
    ['Девяносто', { offer: { payment: 4 } }, 'Сколько дней отсрочки готовы дать?'],
  ]],
  ['china', [
    ['Давайте сорок юаней', { offer: { price: 2 } }],
    ['40 юаней', { offer: { price: 2 } }],
    ['Сорок четыре — дорого', {}],
    ['Не сорок четыре, а сорок юаней', { offer: { price: 2 } }],
    ['Сорок, и по рукам', { offer: { price: 2 }, accepts: true }, 'Цена датчика — 44 юаня.'],
    ['Партия пятьсот штук', { offer: { moq: 4 } }],
    ['Хочу у вас пятьсот штук', { offer: { moq: 4 } }],
    ['Партия семьсот пятьдесят штук', { offer: { moq: 3 } }],
    ['Доставка четырнадцать дней', { offer: { delivery: 3 } }],
    ['Доставка десять дней', { offer: { delivery: 4 } }],
    ['Оплата пятьдесят процентов авансом', { offer: { payment: 1 } }],
    ['Сто процентов предоплата через Alipay', { offer: { payment: 0 } }],
    ['Аккредитив после инспекции', { offer: { payment: 2 } }],
    ['Пробный образец', { offer: { quality: 1 } }],
    ['Эталон и спецификация повторных поставок', { offer: { quality: 2 } }],
    ['Пятьсот штук, если полная предоплата', { offer: { moq: 4, payment: 0 }, behaviors: ['package'] }],
    ['Почему вам важна предоплата?', { asksAbout: ['payment'], behaviors: ['ask_interest'] }],
    ['Сорок', { offer: { price: 2 } }, 'Какая цена датчика вас устроит?'],
    ['Сорок', { offer: { delivery: 0 } }, 'Сколько дней на доставку?'],
  ]],
]

// Независимая фиксация очков: [игрок, собеседник]. Направления не выводим из индекса.
const POINTS: Record<string, Record<string, [number[], number[]]>> = {
  dorm: { wifi: [[0,5,10,15],[15,10,5,0]], quiet: [[0,5,11,18],[6,4,2,0]], cleaning: [[0,4,12],[4,2,0]], guests: [[6,5,3,0],[0,4,16,18]], kitty: [[0,3,8],[0,4,10]] },
  stop: { phone: [[0,14,18,22],[10,8,5,0]], money: [[0,8,16,20],[20,14,5,0]], sorry: [[4,3,2,0],[0,5,12,18]], bus: [[0,6,16],[0,5,14]] },
  shop: { swap: [[0,8,18,24],[10,4,0,9]], disc: [[0,4,8,12],[12,8,4,0]], card: [[4,2,0],[0,9,14]], paper: [[0,5,10],[0,5,12]] },
  launch: { pay: [[16,11,5,0],[0,5,11,16]], start: [[0,12,26],[4,2,0]], bus: [[4,2,0],[0,9,14]], food: [[5,3,0],[0,6,12]], train: [[0,4,9],[0,6,12]] },
  tara: { price: [[0,8,16,24,32],[32,24,16,8,0]], payment: [[0,2,4,6,8],[24,18,12,6,0]], rush: [[0,6,13,21,28],[8,6,4,2,0]], term: [[8,6,4,0],[0,7,14,20]], schedule: [[0,12,24],[0,8,16]] },
  offer: { salary: [[30,23,15,8,0],[0,7,15,23,30]], start: [[30,22,12,0],[0,4,8,10]], housing: [[8,6,3,0],[0,2,17,28]], study: [[7,5,0],[0,10,15]], project: [[0,12,25],[0,8,17]] },
  client: { price: [[34,26,17,9,0],[0,8,15,23,30]], term: [[0,15,30],[8,4,0]], payment: [[10,8,5,3,0],[0,6,12,18,23]], stock: [[12,10,6,0],[0,12,22,25]], index: [[0,7,14],[0,7,14]] },
  china: { price: [[0,6,12,18,24],[24,18,12,6,0]], moq: [[0,6,12,18,24],[8,6,4,2,0]], delivery: [[0,6,12,18,24],[8,6,4,2,0]], quality: [[0,10,20],[0,14,28]], payment: [[0,4,8],[32,16,0]] },
}

function fields(a: Partial<MoveAnalysis>) {
  return { offer: a.offer ?? {}, accepts: !!a.accepts, walksAway: !!a.walksAway,
    asksAbout: [...(a.asksAbout ?? [])].sort(), toneViolation: !!a.toneViolation, rest: !!a.rest }
}

describe('русский голосовой корпус: правила и пустая/ошибочная модель', () => {
  for (const [name, samples] of CASES) {
    const id = name === 'inei' ? 'client' : name
    const base = getScenario(id)!
    for (const sc of [base, harder(base)]) {
      for (const [text, expected, said] of [...COMMON, ...samples]) {
        for (const mode of ['offline', 'empty', 'wrong'] as const) {
          it(`${name}/${sc.id}/${mode}: ${text}`, () => {
            // Извинение в stop — ещё и условие сделки, в остальных делах только разговор.
            const want = id === 'stop' && text === 'Простите, погорячился'
              ? { ...expected, offer: { sorry: 2 } } : expected
            const wrong: Offer = Object.fromEntries(sc.issues.map((issue) =>
              [issue.id, ((want.offer?.[issue.id] ?? 0) + 1) % issue.options.length]))
            const a = mode === 'offline' ? groundedOffline(sc, text, BEHAVIOR_DICT, said)
              : groundAnalysis(sc, text, mode === 'empty' ? { behaviors: [] } : {
                behaviors: [], offer: wrong, accepts: true, walksAway: true,
                asksAbout: sc.issues.map((i) => i.id), rest: true,
              }, said)
            expect(fields(a)).toEqual(fields({ ...want, behaviors: [] }))
            const hits = a.behaviors.map((b) => b.id)
            expect(hits.sort()).toEqual([...(want.behaviors ?? [])].sort())
            for (const act of want.talk ?? []) expect(a.talk).toContain(act)
            for (const hit of a.behaviors) expect(text).toContain(hit.quote.replace(/…$/, ''))
            for (const [issue, option] of Object.entries(want.offer ?? {})) {
              expect(sc.player.profile.points[issue][a.offer![issue]!]).toBe(POINTS[id][issue][0][option!])
              expect(sc.opponent.profile.points[issue][a.offer![issue]!]).toBe(POINTS[id][issue][1][option!])
            }
          })
        }
      }
    }
  }
})
