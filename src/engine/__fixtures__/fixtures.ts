// Временные словарь и сценарий для тестов движка. Боевые — в behaviors.ts и src/content.
import { toDict, type BehaviorRule } from '../dictionary'
import type { Scenario } from '../types'

export const testRules: BehaviorRule[] = [
  { id: 'ask_interest', label: 'Спросил о причинах', trust: 4, tension: -2, kind: 'good', asksInterest: true,
    markers: [/почему|зачем|что для вас (важн|главн)|что вам важн|расскажите|в ч[её]м сложность/i] },
  { id: 'paraphrase', label: 'Пересказал, чтобы проверить', trust: 5, tension: -2, kind: 'good',
    markers: [/правильно (ли )?(я )?понимаю|то есть вы|если я верно понял/i] },
  { id: 'package', label: 'Пакетное предложение', trust: 3, tension: -1, kind: 'good',
    markers: [/в обмен на|взамен|если вы .{0,40}(то )?мы|давайте так/i] },
  { id: 'split', label: 'Делит пополам', trust: 0, tension: 1, kind: 'neutral',
    markers: [/посередине|пополам|середин/i] },
  { id: 'pressure', label: 'Давит ультиматумом', trust: -6, tension: 12, kind: 'bad',
    markers: [/последнее предложение|берите или|у вас нет выбора|иначе/i] },
  { id: 'dismiss', label: 'Обесценивает', trust: -8, tension: 12, kind: 'bad',
    markers: [/несерь[её]зно|смешно|бред|ерунда|чушь/i] },
]
export const testDict = toDict(testRules)

// Поставка оборудования: игрок — покупатель.
// price — делимый; delivery — важен игроку, дёшев поставщику; payment — важен поставщику, дёшев игроку;
// warranty — совместимый (обоим нужна длинная гарантия: поставщику — для продажи сервиса).
export const testScenario: Scenario = {
  id: 'test-supply',
  title: 'Поставка станков',
  sphere: 'закупки',
  difficulty: 2,
  turnLimit: 8,
  issues: [
    { id: 'price', title: 'Цена', options: ['1,0 млн', '1,1 млн', '1,2 млн', '1,3 млн', '1,4 млн'], kind: 'distributive' },
    { id: 'delivery', title: 'Срок поставки', options: ['2 недели', '4 недели', '6 недель', '8 недель'], kind: 'integrative' },
    { id: 'payment', title: 'Отсрочка платежа', options: ['0 дней', '30 дней', '60 дней', '90 дней'], kind: 'integrative' },
    { id: 'warranty', title: 'Гарантия', options: ['1 год', '2 года', '3 года'], kind: 'compatible' },
  ],
  player: {
    role: 'Закупщик завода',
    brief: 'Нужны станки быстро, бюджет ограничен.',
    profile: {
      points: { price: [40, 30, 20, 10, 0], delivery: [40, 27, 13, 0], payment: [0, 3, 6, 10], warranty: [0, 5, 10] },
      batna: 30,
      batnaText: 'Другой поставщик: 1,3 млн, 8 недель',
      interests: [],
    },
  },
  opponent: {
    character: { name: 'Олег', role: 'коммерческий директор', company: 'СтанкоМаш', tone: 'neutral', portrait: 'oleg', speech: 'коротко', bio: '' },
    brief: 'Продать дороже, получить деньги быстрее.',
    profile: {
      points: { price: [0, 10, 20, 30, 40], delivery: [0, 3, 6, 10], payment: [40, 27, 13, 0], warranty: [0, 5, 10] },
      batna: 30,
      batnaText: 'Другой покупатель готов взять за 1,2 млн с предоплатой',
      interests: [
        { id: 'cash', text: 'У нас кассовый разрыв в квартале, деньги нужны сразу', issue: 'payment', trustToReveal: 45 },
        { id: 'stock', text: 'Станки уже на складе, отгрузить можем хоть завтра', issue: 'delivery', trustToReveal: 40 },
        { id: 'service', text: 'Длинная гарантия нам выгодна — продаём сервис', issue: 'warranty', trustToReveal: 50 },
      ],
    },
  },
  opening: 'Добрый день. Цена — 1,4 млн, предоплата полностью. Сроки обсудим.',
}
