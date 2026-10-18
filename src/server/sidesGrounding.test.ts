import { describe, expect, it } from 'vitest'
import { ALL_SCENARIOS } from '../content/scenarios'
import { baseCaseId } from '../content/scenarios/harder'
import { BASE_CASES, CASES, best } from '../engine/__fixtures__/scenarioMatrix'
import { BEHAVIOR_DICT as dict } from '../engine/behaviors'
import { groundAnalysis } from '../engine/offerEvidence'
import { groundedOffline, withBareYes, withContext } from '../engine/offline'
import { initialState, step } from '../engine/turn'
import type { Decision, MoveAnalysis, Offer, Scenario, TurnRecord } from '../engine/types'
import { validate } from './analyze'

const raw = { behaviors: [], offer: [], accepts: false, walksAway: false, asksAbout: [], toneViolation: false, talk: [] }
const keyOf = (sc: Scenario) => sc.id.startsWith('gen-') ? 'generated' : baseCaseId(sc.id)
const record = (sc: Scenario, decision: Decision): TurnRecord => ({
  turn: 1, playerText: 'Обсудим условия.', opponentLine: sc.opening, analysis: { behaviors: [] }, deltas: [],
  decision, emotion: 'neutral', stateAfter: initialState(sc),
})

// Число и ожидаемые варианты заданы по текстам дел, независимо от парсера чисел.
const bare: Record<string, { text: string; said: string; offer: Offer; wrong?: Offer }> = {
  offer: { text: '2', said: 'Через сколько недель выйдете на работу?', offer: { start: 0 }, wrong: { study: 1 } },
  tara: { text: '3', said: 'Срок договора — сколько месяцев?', offer: { term: 0 }, wrong: { rush: 3 } },
  client: { text: '3', said: 'Какую скидку предложите?', offer: { price: 1 }, wrong: { term: 2 } },
  istanbul: { text: '10', said: 'What percentage can you pay upfront?', offer: { payment: 4 }, wrong: { delivery: 3 } },
  china: { text: '40', said: 'Цена — сорок четыре юаня.', offer: { price: 2 }, wrong: { delivery: 0 } },
  lagos: { text: '10', said: 'How much upfront payment?', offer: { payment: 0 }, wrong: { delivery: 1 } },
  dorm: { text: '450', said: 'Сколько платишь за вай-фай?', offer: { wifi: 1 } },
  stop: { text: '500', said: 'Сколько рублей дашь на химчистку?', offer: { money: 1 } },
  shop: { text: '10', said: 'Какую скидку хотите?', offer: { disc: 2 }, wrong: { swap: 1 } },
  launch: { text: '30', said: 'Сколько процентов ночной доплаты?', offer: { pay: 1 } },
  generated: { text: '2', said: 'Сколько недель до поставки станков?', offer: { delivery: 0 }, wrong: { warranty: 1 } },
}

it('матрица охватывает все дела, Лагос, Шэньчжэнь, своё дело и жёсткие версии', () => {
  expect(BASE_CASES.filter((s) => !s.id.startsWith('gen-')).map((s) => s.id)).toEqual(ALL_SCENARIOS.map((s) => s.id))
  expect(CASES.map((s) => s.id)).toEqual(expect.arrayContaining(['lagos', 'lagos-hard', 'china', 'china-hard']))
  expect(BASE_CASES.map(keyOf).sort()).toEqual(Object.keys(bare).sort())
  expect(CASES).toHaveLength(BASE_CASES.length * 2)
})

describe.each(CASES)('$id: проверка слов после разметки модели', (sc) => {
  const en = sc.lang === 'en'
  const row = bare[keyOf(sc)]

  it('без слов согласия модель не может принять предложение за игрока', () => {
    for (const text of [row.text, en ? 'We are discussing the terms.' : 'Обсуждаем условия.', en ? 'I do not accept.' : 'Я не согласен.']) {
      expect(validate(sc, dict, text, { ...raw, accepts: true }).accepts, text).not.toBe(true)
      expect(groundAnalysis(sc, text, { behaviors: [], accepts: true }).accepts, text).not.toBe(true)
    }
  })

  it('безусловное согласие сохраняется, «если», «но» и условие после точки не закрывают сделку', () => {
    const yes = en ? 'Agreed. I accept your offer.' : 'Договорились. Принимаю ваше предложение.'
    expect(validate(sc, dict, yes, { ...raw, accepts: true }).accepts).toBe(true)
    expect(groundedOffline(sc, yes, dict).accepts).toBe(true)
    const conditions = en
      ? ['Agreed, if you change the price.', 'Agreed. But delivery must be earlier.', 'I accept provided you change the terms.']
      : ['Согласен, если вы измените цену.', 'Договорились. Но сроки надо изменить.', 'Принимаю при условии, что вы уступите.']
    for (const text of conditions) {
      expect(validate(sc, dict, text, { ...raw, accepts: true }).accepts, text).not.toBe(true)
      expect(groundedOffline(sc, text, dict).accepts, text).not.toBe(true)
      expect(withBareYes(text, { behaviors: [] }, [record(sc, { kind: 'counter', offer: best(sc, 'opponent') })]).accepts, text).not.toBe(true)
    }
  })

  it('withBareYes требует встречного предложения и не принимает голое число или условное «да»', () => {
    const text = 'Да, давайте.'
    const offered: Decision[] = [
      { kind: 'counter', offer: best(sc, 'opponent') },
      { kind: 'reveal', interestId: sc.opponent.profile.interests[0].id, offer: best(sc, 'opponent') },
      { kind: 'hold', reason: 'no_movement' },
    ]
    for (const d of offered) {
      const h = [record(sc, d)]
      expect(withBareYes(text, { behaviors: [] }, h).accepts).toBe(true)
      for (const no of [row.text, 'Да, давайте, если вы уступите.', 'Да, но не на этих условиях.']) {
        expect(withBareYes(no, { behaviors: [] }, h).accepts).not.toBe(true)
      }
      for (const a of [{ behaviors: [], offer: row.offer }, { behaviors: [], toneViolation: true }, { behaviors: [], walksAway: true }] as MoveAnalysis[]) {
        expect(withBareYes(text, a, h).accepts).not.toBe(true)
      }
    }
    expect(withBareYes(text, { behaviors: [] }, []).accepts).not.toBe(true)
    expect(withBareYes(text, { behaviors: [] }, [record(sc, { kind: 'respond', to: ['question'] })]).accepts).not.toBe(true)
  })

  const ambiguous = ['tara', 'client'].includes(keyOf(sc))
  // Для этих двух дел said распознаётся слишком широко либо не распознаётся вообще.
  const bareTest = ambiguous ? it.fails : it
  bareTest(`${ambiguous ? 'BUG ' : ''}голое число подтверждает только пункт из последней реплики собеседника`, () => {
    const proposed = { ...row.offer, ...row.wrong }
    const analysis = validate(sc, dict, row.text, { ...raw, accepts: true, offer: Object.entries(proposed).map(([issue, option]) => ({ issue, option })) }, row.said)
    expect(analysis.offer).toEqual(row.offer)
    expect(analysis.accepts).not.toBe(true)
    expect(groundAnalysis(sc, row.text, { behaviors: [], offer: proposed }, row.said).offer).toEqual(row.offer)
  })

  it('отказ «только не X» от утвердительных вариантов не становится предложением', () => {
    for (const i of sc.issues) for (const [option, label] of i.options.entries()) {
      // Отрицательные названия и вариант с запятой проверяются отдельно как BUG ниже.
      if (/^(?:не|нет|без)(?!\p{L})/u.test(label)) continue
      if (keyOf(sc) === 'stop' && i.id === 'bus' && option === 1) continue
      const text = `${en ? 'Not' : 'Только не'} ${label}.`
      const a = validate(sc, dict, text, { ...raw, offer: [{ issue: i.id, option }] })
      expect(a.offer?.[i.id], text).toBeUndefined()
      expect(groundedOffline(sc, text, dict).offer?.[i.id], text).toBeUndefined()
    }
  })

  it('собеседник не делает и не принимает предложение хуже BATNA в партии с проверенной разметкой', () => {
    let state = initialState(sc)
    const h: TurnRecord[] = []
    const check = (offer: Offer) => expect(sc.issues.reduce((sum, i) => sum + sc.opponent.profile.points[i.id][offer[i.id]!], 0)).toBeGreaterThanOrEqual(sc.opponent.profile.batna)
    for (const offer of [best(sc, 'player'), best(sc, 'opponent')]) {
      if (state.status !== 'open') break
      const text = 'Предлагаю так: ' + sc.issues.map((i) => `${i.title.toLowerCase()} — ${i.options[offer[i.id]]}`).join(', ') + '.'
      const a = withContext(validate(sc, dict, text, { ...raw, offer: Object.entries(offer).map(([issue, option]) => ({ issue, option })) }), state, h, dict)
      const r = step(sc, state, a, dict, h.map((x) => x.analysis))
      if (r.state.deal) check(r.state.deal)
      if (r.decision.kind === 'counter') check(r.decision.offer)
      h.push({ ...record(sc, r.decision), playerText: text, analysis: a, stateAfter: r.state, deltas: r.deltas })
      state = r.state
    }
    if (state.status === 'open') {
      const accepted = step(sc, state, { behaviors: [], accepts: true }, dict, h.map((x) => x.analysis))
      expect(accepted.state.status).toBe('deal')
      check(accepted.state.deal!)
    }
  })

  // groundAnalysis проверяет согласие, но не перепроверяет walksAway словами игрока.
  it.fails('BUG отрицание «Я не ухожу» не должно сохранять ошибочный walksAway модели', () => {
    const text = 'Я не ухожу.'
    expect(groundedOffline(sc, text, dict).walksAway).not.toBe(true)
    expect(validate(sc, dict, text, { ...raw, walksAway: true }).walksAway).not.toBe(true)
  })

  // Вопрос содержит слово согласия, но не является подтверждением сделки.
  it.fails('BUG вопрос о согласии не должен подтверждать accepts модели', () => {
    const text = en ? 'Deal?' : 'Договорились?'
    expect(groundedOffline(sc, text, dict).accepts).not.toBe(true)
    expect(validate(sc, dict, text, { ...raw, accepts: true }).accepts).not.toBe(true)
  })
})

describe('отказ от отрицательного варианта и отказ перед запятой', () => {
  for (const sc of CASES) {
    const examples: Record<string, [string, string, number][]> = {
      client: [['Только не без снижения.', 'price', 0], ['Только не нет, цена твёрдая.', 'index', 0]],
      dorm: [['Только не без правил.', 'quiet', 0], ['Только не без гостей.', 'guests', 0]],
      stop: [['Только не не доставать.', 'phone', 3]],
      shop: [['Только не без карты.', 'card', 0], ['Только не без бумажек.', 'paper', 0]],
    }
    for (const [text, issue, option] of examples[keyOf(sc)] ?? []) {
      // negativeEvidence принимает отвергаемое отрицательное название за выбор этого же варианта.
      it.fails(`BUG ${sc.id}: «${text}» не предлагает отвергнутый вариант`, () => {
        const a = validate(sc, dict, text, { ...raw, offer: [{ issue, option }] })
        expect(a.offer?.[issue]).toBeUndefined()
      })
    }
    if (keyOf(sc) === 'stop') {
      // После запятой теряется отказ перед конкретным временем автобуса.
      it.fails(`BUG ${sc.id}: отказ от следующего автобуса не предлагает 8:20`, () => {
        const text = 'Только не следующим, в 8:20.'
        expect(validate(sc, dict, text, { ...raw, offer: [{ issue: 'bus', option: 1 }] }).offer?.bus).toBeUndefined()
      })
    }
  }
})
