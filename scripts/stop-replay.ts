// Повтор партии капитана в «Остановке» (18.10, судья w2vOBoBf) по кэшу разметки прода: решение движка и рамка реплики.
import { BEHAVIOR_DICT } from '../src/engine/behaviors'
import { initialState, step } from '../src/engine/turn'
import { withContext } from '../src/engine/offline'
import type { MoveAnalysis, TurnRecord } from '../src/engine/types'
import { voicePrompt } from '../src/server/voice'
import { stopCase } from '../src/content/scenarios/story/stop'

const sc = stopCase.scenario
const said = [
  'Ё-моё, братан, ты чё… ты как со мной разговариваешь? Я Серый, не Вася. Ещё раз так скажешь — и разговора не будет, встану и уйду.',
  'Чё за закинуть? Кроссы как кроссы, белые, были. Ты лучше скажи, чё по делу: закинешь или как? Время идёт.',
  'Капец, братан, ты… торгуешься как на рынке. Ладно, пятихатка на химчистку — тут сошлись. [вырезано: Но руку жмёшь и извиняешься при пацанах, это не обсуждается.]',
  'Погоди-ка, братан… на громкой, так и быть, тут сошлись. Извиниться при пацанах — так я и сам говорил, не подарок. Но это ещё не всё, братан.',
  'Типа чё, братан? Молча уйдёшь и всё? Не, так не катит. Пацаны смотрят, я чё, зря стою? Ты мне шаг навстречу сделай, а не назад.',
  'Ё-моё, и чё… это всё? «Сорри» — это когда на ногу в автобусе наступили. А ты мне кроссы залил, на секундочку. Скажи нормально, по-человечески, я же слышу, когда через губу.',
  'Слушай сюда, братан… ты чё шипишь, как чайник? Словами скажи. Нормально извинись, при пацанах, и расходимся. Я жду.',
  'Ё-моё, и это всё?… Ну вот, уже на человека похоже. Сорян» с запинкой, зато от души, засчитано. Только это ты мне, а пацанам когда скажешь? Давай, что ли, к делу.',
  'Капец, ты чё… сам не понимаешь, да? Всё, братан, не вышло у нас. Пойду у бабушки спрошу, она хоть по-человечески ответит.',
]
const moves: { text: string; a: MoveAnalysis }[] = [
  { text: '…2 тыщи на кроссы закидывать у меня денег таких нету… (грубо)', a: { behaviors: [{ id: 'priority', quote: '2 тыщи на кроссы закидывать у меня денег таких нету' }], toneViolation: true, talk: ['question'], offer: { money: 1 } } },
  { text: 'Ладно, ладно, не кипишуй, сори. Ты расскажи, чё за кросс этооо?', a: { behaviors: [{ id: 'rapport', quote: 'Ладно, ладно, не кипишуй, сори' }, { id: 'ask_interest', quote: 'Ты расскажи, чё за кросс этооо?' }], asksAbout: ['money'], talk: ['apology', 'question'] } },
  { text: '(ход 3 — разметка пустая)', a: { behaviors: [] } },
  { text: '(на громкой + извинюсь при пацанах)', a: { behaviors: [], offer: { phone: 1, sorry: 3 } } },
  { text: '(молча)', a: { behaviors: [], offer: { sorry: 0 } } },
  { text: 'Давай я тебе скажу «sorry»', a: { behaviors: [{ id: 'signpost', quote: 'Давай я тебе скажу «sorry»' }], talk: ['apology'] } },
  { text: '(ш-ш-ш)', a: { behaviors: [] } },
  { text: 'сорян, я чё-то это, за сумкой не уследил, реально', a: { behaviors: [{ id: 'rapport', quote: 'сорян, я чё-то з-- это, за сумкой не уследил, реально' }], talk: ['apology'] } },
  { text: 'А сам за что извиняться-то мне', a: { behaviors: [{ id: 'attack', quote: 'А сам за что извиняться-то мне' }], asksAbout: ['sorry'], toneViolation: true, talk: ['question'] } },
]
let state = initialState(sc)
const history: TurnRecord[] = []
const only = process.argv[2] ? Number(process.argv[2]) : 0
moves.forEach((m, n) => {
  const a = withContext(m.a, state, history, BEHAVIOR_DICT)
  const r = step(sc, state, a, BEHAVIOR_DICT, history.map((h) => h.analysis))
  const vp = voicePrompt(sc, history, m.text, r.decision, r.state)
  if (!only || only === n + 1) {
    console.log(`\n=== ход ${n + 1}: «${m.text}»`)
    console.log('разметка:', JSON.stringify(a.offer ?? {}), 'stance:', JSON.stringify(r.state.playerStance), 'доверие', r.state.trust, 'напряжение', r.state.tension)
    console.log('решение:', JSON.stringify(r.decision))
    console.log('рамка:', vp.frame.text)
    console.log('Серый (прод):', said[n])
    if (only) console.log('\n----- USER PROMPT -----\n' + vp.user)
  }
  history.push({ turn: r.state.turn, playerText: m.text, analysis: a, deltas: r.deltas, decision: r.decision, opponentLine: said[n], emotion: 'neutral', stateAfter: r.state })
  state = r.state
})
