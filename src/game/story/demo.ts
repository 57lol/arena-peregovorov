// «Готовый разбор» для жюри: встреча, которую за секунду в браузере сыграл вдумчивый переговорщик.
// Сначала спрашивает, зачем собеседнику каждый пункт, и пересказывает услышанное, потом кладёт обмен из того,
// что узнал, и по шагу двигает цену. Ходы считает тот же движок и офлайн-разметчик, что и в игре, поэтому разбор
// настоящий и каждый раз одинаковый (стиль «исследователь» из scripts/players.ts).

import { BEHAVIOR_DICT } from '../../engine/behaviors'
import { offlineTurn } from '../../engine/offline'
import type { Offer, Scenario, TurnRecord } from '../../engine/types'
import { bestOption, formatOffer, isComplete, score, type FullOffer } from '../../engine/utility'

function explorer(sc: Scenario, h: TurnRecord[]): string {
  const P = sc.player.profile
  const O = sc.opponent.profile
  // спрашивает про пункты, о которых собеседник ещё не рассказал, начиная с того, что ему проще открыть:
  // так вопрос и ответ идут об одном пункте, а не «спросил про срок — услышал про лизинг»
  const easiest = (id: string) => Math.min(...O.interests.filter((x) => x.issue === id).map((x) => x.trustToReveal), 999)
  const topics = sc.issues.filter((i) => i.kind !== 'distributive').sort((a, b) => easiest(a.id) - easiest(b.id))
  const told = new Set(h.flatMap((r) => (r.decision.kind === 'reveal' ? [O.interests.find((x) => x.id === (r.decision as { interestId: string }).interestId)?.issue] : [])))
  const times = (i: (typeof topics)[number]) => h.filter((r) => r.playerText.includes(`«${i.title.toLowerCase()}»? Что за этим стоит`)).length
  // не рассказал с первого раза — спрашивает ещё раз, доверие к тому времени подрастёт
  const nextTopic = topics.find((i) => !told.has(i.id) && times(i) < 2)
  const again = !!nextTopic && times(nextTopic) > 0
  const asks = topics.map(() =>
    nextTopic
      ? `${again ? 'И всё же: почему' : 'А почему'} для вас так важен пункт «${nextTopic.title.toLowerCase()}»? Что за этим стоит?`
      : 'А что ещё для вас важно, о чём я не спросил?',
  )
  const n = h.length
  if (n === 0) return 'Добрый день! Прежде чем торговаться, хочу понять вашу ситуацию. Что для вас в этой сделке главное и почему?'
  const last = h[n - 1]
  // пересказ своими словами: интерес собеседника записан от его лица («у нас склад…»), дословно его не повторяем
  const now = last.decision.kind === 'reveal' ? O.interests.find((i) => i.id === (last.decision as { interestId: string }).interestId) : undefined
  const topic = now?.issue ? sc.issues.find((i) => i.id === now.issue)?.title.toLowerCase() : undefined
  const heard = now
    ? topic
      ? `Правильно понимаю, что «${topic}» для вас — вопрос не мелкий? Спасибо, это важно. `
      : 'Правильно понимаю, что без нас у вас тоже не всё гладко? Спасибо, что сказали. '
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
  if (tries > 0 && isComplete(sc, theirs) && score(P, theirs) >= score(P, pkg as FullOffer) - 5) return 'Отлично, так нам обоим хорошо. Договорились.'
  return tries === 0
    ? `Смотрите, что предлагаю с учётом того, что вы рассказали: ${formatOffer(sc, pkg)}. Вы получаете то, что важно вам, мы — то, что важно нам.`
    : `Хорошо, иду навстречу по деньгам: ${formatOffer(sc, pkg)}.`
}

/** Сыграть встречу целиком офлайн, до сделки, ухода или конца времени. */
export function demoHistory(sc: Scenario): TurnRecord[] {
  const h: TurnRecord[] = []
  while (h.length < sc.turnLimit) {
    const rec = offlineTurn(sc, h, explorer(sc, h), BEHAVIOR_DICT)
    h.push(rec)
    if (rec.stateAfter.status !== 'open') break
  }
  return h
}
