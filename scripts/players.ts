// Стили игрока для прогонов: грубиян, «посередине», исследователь, терпеливый исследователь.
// Их гоняют scripts/playtest.ts (живьём через API) и тесты проходимости (офлайн, движком).

import type { Offer, Scenario, TurnRecord } from '../src/engine/types'
import { bestOption, formatOffer, isComplete, score, type FullOffer } from '../src/engine/utility'

export type Player = (sc: Scenario, h: TurnRecord[]) => string

const say = (sc: Scenario, o: Offer) => formatOffer(sc, o)
const myBest = (sc: Scenario): FullOffer => Object.fromEntries(sc.issues.map((i) => [i.id, bestOption(sc.player.profile, i.id)]))
const theirLast = (h: TurnRecord[]) => h[h.length - 1]?.stateAfter.lastOpponentOffer

// 1. Грубиян: требует всё и хамит.
export const rude: Player = (sc, h) => {
  const lines = [
    `Значит так. ${say(sc, myBest(sc))}. Не нравится — идите лесом.`,
    'Вы что, издеваетесь? Это бред, а не предложение. Я жду нормальных цифр.',
    `Слушайте, вы идиот или притворяетесь? ${say(sc, myBest(sc))}, я сказал.`,
    'Хватит ерунду нести. Последний раз повторяю.',
    'Ну и тупой же разговор.',
  ]
  return lines[Math.min(h.length, lines.length - 1)]
}

// 2. Торгаш «давайте посередине»: не спрашивает, делит разницу пополам, соглашается, когда устал.
export const splitter: Player = (sc, h) => {
  const theirs = theirLast(h)
  if (!h.length || !isComplete(sc, theirs)) return `Начнём с нашей позиции: ${say(sc, myBest(sc))}.`
  const mine = h[h.length - 1].stateAfter.playerStance ?? myBest(sc)
  const mid: Offer = {}
  for (const i of sc.issues) {
    const a = mine[i.id] ?? bestOption(sc.player.profile, i.id)
    const b = theirs[i.id]!
    mid[i.id] = Math.round((a + b) / 2)
  }
  const mp = score(sc.player.profile, theirs)
  if (h.length >= 6 && mp >= sc.player.profile.batna) return 'Ладно, устал торговаться. Согласен на ваше предложение.'
  return `Давайте по-честному, посередине: ${say(sc, mid)}.`
}

// 3. Исследователь: сначала спрашивает об интересах и пересказывает услышанное, потом собирает размен
//    из того, что узнал, и своих приоритетов. Делимый пункт двигает по шагу за ход.
export const explorer: Player = (sc, h) => {
  const P = sc.player.profile
  const O = sc.opponent.profile
  const asks = sc.issues
    .filter((i) => i.kind !== 'distributive')
    .map((i) => `А почему для вас так важен пункт «${i.title.toLowerCase()}»? Что за этим стоит?`)
  const n = h.length
  if (n === 0) return 'Добрый день! Прежде чем торговаться, хочу понять вашу ситуацию. Что для вас в этой сделке главное и почему?'
  const last = h[n - 1]
  const heard =
    last.decision.kind === 'reveal'
      ? `Правильно понимаю: ${O.interests.find((i) => i.id === (last.decision as { interestId: string }).interestId)?.text.split(/[.,:]/)[0]}? Это важно, спасибо. `
      : 'Понимаю. '
  if (n <= asks.length) return heard + asks[n - 1]

  const revealed = new Set(last.stateAfter.revealed)
  const known = new Set(O.interests.filter((i) => revealed.has(i.id) && i.issue).map((i) => i.issue!))
  const w = (p: typeof P, id: string) => Math.max(...p.points[id]) - Math.min(...p.points[id])
  const weights = sc.issues.map((i) => w(P, i.id))
  const median = [...weights].sort((a, b) => a - b)[Math.floor(weights.length / 2)]
  const pkg: Offer = {}
  for (const i of sc.issues) {
    const mine = bestOption(P, i.id)
    const mid = Math.floor((i.options.length - 1) / 2)
    if (known.has(i.id)) {
      // человек понял из объяснения, насколько пункт важен собеседнику
      const theirs = bestOption(O, i.id)
      pkg[i.id] = theirs === mine || w(P, i.id) >= w(O, i.id) ? mine : theirs
    } else pkg[i.id] = w(P, i.id) >= median ? mine : mid
  }
  const tries = n - asks.length - 1
  const price = sc.issues.find((i) => i.kind === 'distributive')
  if (price && tries > 0) {
    const their = bestOption(O, price.id)
    const shift = Math.sign(their - pkg[price.id]!) * Math.min(tries, Math.abs(their - pkg[price.id]!))
    pkg[price.id] = pkg[price.id]! + shift
  }
  const theirs = last.stateAfter.lastOpponentOffer
  if (tries > 0 && isComplete(sc, theirs) && score(P, theirs) >= score(P, pkg as FullOffer) - 5)
    return 'Отлично, так нам обоим хорошо. Договорились.'
  return tries === 0
    ? `Смотрите, что предлагаю с учётом того, что вы рассказали: ${say(sc, pkg)}. Вы получаете то, что важно вам, мы — то, что важно нам.`
    : `Хорошо, иду навстречу по деньгам: ${say(sc, pkg)}.`
}

// 4. Терпеливый исследователь (--styles patient): спрашивает и кладёт размен, как исследователь, а потом держит его
//    до конца встречи и соглашается только на последнее предложение. Проверка для сложности 3: жёсткий собеседник
//    уступает под занавес, и кто сдался раньше, оставил очки на столе.
export const patient: Player = (sc, h) => {
  const last = h[h.length - 1]
  const theirs = last?.stateAfter.lastOpponentOffer
  if (last?.stateAfter.lastCall)
    return isComplete(sc, theirs) && score(sc.player.profile, theirs) >= sc.player.profile.batna
      ? 'Хорошо, согласен на то, что вы предложили. Договорились.'
      : 'Тогда без сделки. Спасибо за встречу, всего доброго.'
  const asks = sc.issues.filter((i) => i.kind !== 'distributive').length
  if (h.length <= asks + 1) return explorer(sc, h)
  return `Понимаю вас, но наше предложение прежнее: ${say(sc, last.stateAfter.playerStance ?? {})}. Вы получаете то, что важно вам, мы — то, что важно нам.`
}
