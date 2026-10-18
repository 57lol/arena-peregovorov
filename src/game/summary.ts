// Главное в разборе — три строки: чем кончилось, что получилось, что попробовать в следующий раз.
// Считается из того же отчёта, что и подробный разбор, без нейросети: тот же ход — те же строки.

import { MINUTES_PER_TURN, behaviorById } from '../engine/behaviors'
import type { Report } from '../engine/report'
import type { Scenario, TurnRecord } from '../engine/types'
import { upsellPenalty } from '../engine/upsells'
import { isComplete, maxScore, score } from '../engine/utility'
import { firstName, g, plural } from './cast'
import { fragment, plainWords } from './instant'
import { worseWithout } from '../content/scenarios/story'

export interface Summary {
  result: string
  good: string
  /** цитата игрока к «получилось», если есть */
  quote?: string
  next: string
}

export function summarize(sc: Scenario, r: Report, history: TurnRecord[]): Summary {
  const n = firstName(sc)
  const him = g(sc, 'ему', 'ей')
  const his = g(sc, 'него', 'неё')
  const o = r.outcome
  const batna = r.batna.player
  const max = maxScore(sc.player.profile, sc.issues)
  const state = history[history.length - 1]?.stateAfter
  const deal = o.status === 'deal'
  const slammed = o.status === 'walked_away' && state?.endedBy === 'opponent'
  const loss = deal && o.playerPoints < batna

  // 1. Чем кончилось. Есть дела, где без сделки хуже, чем было до встречи (остановка: автобус ушёл) — там так и пишем
  const worse = worseWithout(sc.id)
  let result: string
  if (!deal && worse)
    result = `${o.status === 'walked_away' && state?.endedBy === 'opponent' ? `${n} ${g(sc, 'встал', 'встала')} из-за стола` : o.status === 'walked_away' ? 'Вы ушли' : 'Время вышло'}. Сделки нет, и стало хуже, чем было: ${worse}.${r.zopa ? ' А договориться было можно.' : ''}`
  else if (deal && loss) result = `Сделка, но себе в убыток: выгода ${o.playerPoints}, а без сделки было бы ${batna}.`
  else if (deal && o.playerPoints === batna) result = `Сделка. Ваша выгода — ${o.playerPoints} из ${max}: ровно столько же, сколько и без неё.`
  else if (deal) result = `Сделка! Ваша выгода — ${o.playerPoints} из ${max}, на ${o.playerPoints - batna} больше, чем без неё.`
  else if (o.status === 'walked_away' && state?.endedBy === 'opponent')
    result = `${n} ${g(sc, 'встал', 'встала')} из-за стола. Сделки нет, у вас остаётся то, что было и без неё.`
  else if (o.status === 'walked_away') {
    // ушли, когда на столе было меньше, чем без сделки, — это финал «Ушли вовремя»; не спорим с ним в первой же строке
    // (доптовары, на которые уже согласились, вычитаем, как в финале и в подробном разборе)
    const last = state?.lastOpponentOffer
    const onTable = isComplete(sc, last) ? score(sc.player.profile, last) - upsellPenalty(sc, state) : undefined
    result = !r.zopa
      ? 'Вы ушли без сделки. И правильно: выгодной сделки тут не было.'
      : onTable !== undefined && onTable <= batna
        ? `Вы ушли без сделки, и в тот момент верно: на столе было ${onTable}, ${onTable < batna ? 'меньше' : 'не больше'}, чем без сделки (${batna}). Но договориться выгоднее было можно.`
        : 'Вы ушли без сделки. А договориться было можно — и выгоднее.'
  }
  else result = `Время вышло, сделки нет.${r.zopa ? ' А договориться было можно.' : ''}`

  // 2. Что получилось: самый частый сильный приём с цитатой, иначе — доверие или то, что узнали
  const quotes = new Map<string, string>()
  for (const h of history) for (const b of h.analysis.behaviors) if (!quotes.has(b.id) && b.quote) quotes.set(b.id, b.quote)
  const strong = r.benchmark.filter((x) => x.polarity === 'strong' && x.count > 0).sort((a, b) => b.count - a.count)[0]
  const told = state?.revealed.length ?? 0
  let good: string
  let quote: string | undefined
  if (strong) {
    good = behaviorById(strong.id)?.moment ?? strong.title
    const q = quotes.get(strong.id)
    quote = q ? fragment(q) : undefined
  } else if (told) good = `${n} ${g(sc, 'рассказал', 'рассказала')}, что ${him} важно: ${told} из ${sc.opponent.profile.interests.length}.`
  else if (o.relationship >= 60) good = `Расстались по-хорошему: доверие ${o.relationship} из 100.`
  else if (deal && o.playerPoints > batna) good = 'Довели дело до сделки, и она лучше, чем без неё.'
  else if (!history.some((h) => !h.analysis.walksAway)) good = 'Разговор не начался: вы ушли до первой реплики.'
  else if (slammed) good = `Теперь видно, где у ${his} предел: что накалило разговор, разобрано подробно ниже.`
  else if (o.status === 'walked_away') good = 'Вы сами решили, когда встать из-за стола, — уйти тоже решение.'
  else good = 'Встреча дошла до конца — для начала уже неплохо.'

  // 3. Что попробовать: сначала то, что стоило больше всего
  const weak = r.benchmark.filter((x) => x.polarity === 'weak' && x.count > 0).sort((a, b) => b.count - a.count)[0]
  const asked = history.some((h) => h.analysis.behaviors.some((b) => ['ask_interest', 'implication', 'need_payoff'].includes(b.id)))
  let next: string
  if (loss) next = `Не соглашайтесь на выгоду меньше ${batna}: столько у вас есть и без сделки.`
  // встал из-за стола после резкостей — сначала про тон, а не про встречные предложения
  else if (slammed && history.some((h) => h.analysis.toneViolation))
    next = 'Держите деловой тон: грубость здесь прощают один раз, второй — и встреча окончена. Спорьте с условиями, а не с человеком.'
  else if (weak) next = behaviorById(weak.id)?.advice ?? weak.title
  else if (!asked) next = `Спросите, что для ${his} главное и почему. Вопрос ничего не стоит, а узнать можно много.`
  else if (deal && r.leftOnTable > 0)
    next = `Можно было получить больше обоим — на столе осталось ещё ${r.leftOnTable} ${plural(r.leftOnTable, 'очко', 'очка', 'очков')} выгоды. Уступите там, где вам не так важно, а взамен попросите своё.`
  else if (!deal && r.zopa) next = `Предложите условия по всем пунктам сразу: так ${him} проще согласиться, а вам — обменять одно на другое.`
  else next = sc.lessons?.[0] ?? sc.goals?.[0] ?? 'Попробуйте сыграть это дело жёстче.'
  return { result, good: plainWords(good), quote, next: plainWords(next) }
}

/** Частота словами: доля реплик (%) или «на 12 реплик» → «примерно раз в 5 реплик». */
export function often(x: number, unit: 'share' | 'per_hour' | 'reasons'): string {
  const perTurn = unit === 'share' ? x / 100 : (x * MINUTES_PER_TURN) / 60
  if (perTurn <= 0) return 'ни разу'
  if (perTurn >= 0.75) return 'почти в каждой реплике'
  if (perTurn >= 0.4) return 'примерно в каждой второй реплике'
  const k = Math.round(1 / perTurn)
  return `примерно раз в ${k} ${plural(k, 'реплику', 'реплики', 'реплик')}`
}
