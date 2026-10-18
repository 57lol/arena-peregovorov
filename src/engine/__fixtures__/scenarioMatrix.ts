import { ALL_SCENARIOS, harder } from '../../content/scenarios'
import type { MoveAnalysis, Scenario } from '../types'
import generatedFixture from './generatedScenario.json'

// Ответ генератора зафиксирован вручную. Никаких ключей, сети, времени или Math.random.
export const generationRequest = { sphere: 'Закупки', playerRole: 'закупщик завода', difficulty: 2 as const, opponentTone: 'neutral' as const, theme: '', goals: '' }
export const generationAnswer = {
  title: 'Станки для учебного цеха', playerRole: 'закупщик завода',
  playerBrief: 'Нужны дешёвые станки за две недели. Предоплату хотим минимальную. Длинная гарантия нужна обоим: поставщик продаёт сервис.',
  playerBatnaText: 'Купить у другого поставщика',
  opponentName: 'Игорь Соколов', opponentRole: 'менеджер поставщика', opponentCompany: 'Станки',
  opponentSpeech: 'Спокойно и коротко', opponentBio: 'Продаёт станки десять лет',
  opponentBrief: 'Хочет высокую цену, предоплату сразу и больше времени на доставку. Длинная гарантия продаёт сервис.',
  opponentBatnaText: 'Продать другой фабрике', opening: 'Добрый день. Обсудим поставку.',
  issues: [
    { id: 'price', title: 'Цена', role: 'split' as const, options: ['1200 ₽', '1500 ₽', '1800 ₽'], bestForPlayer: '1200 ₽', bestForOpponent: '1800 ₽' },
    { id: 'delivery', title: 'Поставка', role: 'mine' as const, options: ['2 недели', '4 недели', '6 недель'], bestForPlayer: '2 недели', bestForOpponent: '6 недель' },
    { id: 'advance', title: 'Предоплата', role: 'theirs' as const, options: ['0%', '50%', '100%'], bestForPlayer: '0%', bestForOpponent: '100%' },
    { id: 'warranty', title: 'Гарантия', role: 'shared' as const, options: ['3 года', '2 года', '1 год'], bestForPlayer: '3 года', bestForOpponent: '3 года' },
  ],
  interests: [
    { issue: 'advance', text: 'мне нужны деньги сразу, чтобы оплатить производство' },
    { issue: 'warranty', text: 'я хочу длинную гарантию, потому что продаю сервис' },
  ],
}
// Сохранённый выход реального generateScenario; серверный тест проверяет его
// повторное получение. Браузерные тесты не импортируют Node-модули генератора.
export const generatedScenario = generatedFixture as Scenario
export const BASE_CASES = [...ALL_SCENARIOS, generatedScenario]
export const CASES = BASE_CASES.flatMap((sc) => [sc, harder(sc)])

// Оракул пространства сделок не использует allDeals, score или paretoFrontier движка.
export function enumerate(sc: Scenario) {
  let offers: Record<string, number>[] = [{}]
  for (const issue of sc.issues) offers = offers.flatMap((o) => issue.options.map((_, n) => ({ ...o, [issue.id]: n })))
  return offers.map((offer) => ({ offer,
    player: sc.issues.reduce((sum, i) => sum + sc.player.profile.points[i.id][offer[i.id]], 0),
    opponent: sc.issues.reduce((sum, i) => sum + sc.opponent.profile.points[i.id][offer[i.id]], 0),
  }))
}

export function best(sc: Scenario, side: 'player' | 'opponent'): Record<string, number> {
  return Object.fromEntries(sc.issues.map((i) => {
    const points = sc[side].profile.points[i.id]
    return [i.id, points.indexOf(Math.max(...points))]
  }))
}

// Фиксированный PRNG: seed печатается в имени теста; каждый вариант каждого пункта
// дополнительно покрывается полным перебором, поэтому случайная удача не нужна.
export function histories(sc: Scenario, seed: number): MoveAnalysis[] {
  let n = seed >>> 0
  const next = (max: number) => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0
    return n % max
  }
  const out: MoveAnalysis[] = []
  for (let turn = 0; turn < sc.turnLimit + 2; turn++) {
    const offer = Object.fromEntries(sc.issues.filter(() => next(4) !== 0).map((i) => [i.id, next(i.options.length)]))
    const moves: MoveAnalysis[] = [
      { behaviors: [], offer }, { behaviors: [], offer: best(sc, 'player') },
      { behaviors: [{ id: 'ask_interest', quote: 'Почему это важно?' }], asksAbout: [sc.issues[next(sc.issues.length)].id] },
      { behaviors: [], talk: ['joke'] }, { behaviors: [], accepts: true },
      { behaviors: [{ id: 'attack', quote: 'Это ваша проблема' }] },
      { behaviors: [], offer, rest: true }, { behaviors: [], toneViolation: true },
      { behaviors: [], walksAway: true }, { behaviors: [], offer: best(sc, 'opponent') },
    ]
    // Первые три хода исследуют состояние; терминальные ходы тоже гарантированы.
    out.push(turn < 3 ? moves[next(4)] : moves[next(moves.length)])
  }
  return out
}
