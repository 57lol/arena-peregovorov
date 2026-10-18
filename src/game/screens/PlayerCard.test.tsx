import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { getScenario } from '../../content/scenarios'
import { BEHAVIOR_DICT } from '../../engine/behaviors'
import { offlineTurn } from '../../engine/offline'
import { attemptOf } from '../../engine/team'
import { PlayerCard } from './PlayerCard'

it.each([
  ['tara', ['По рыночной цене 200 рублей.', 'Во что вам обходится день простоя?', 'Что вам даст наше решение?', 'Давайте вместе подумаем.', 'А что если разбить оплату?']],
  ['istanbul', ['Can we use a published benchmark?', 'How much does downtime cost you per day?', 'Would earlier deliveries help your team?', "Let's find a solution that works for both sides.", 'Could we explore a smaller first shipment?']],
])('карточка %s сохраняет и показывает все новые приёмы без выдуманных норм', (id, phrases) => {
  const sc = getScenario(id)!
  const history = phrases.map((text) => offlineTurn(sc, [], text, BEHAVIOR_DICT))
  const a = attemptOf(sc, history, BEHAVIOR_DICT, 10)
  for (const id of ['criteria', 'implication', 'need_payoff', 'joint_frame', 'whatif'] as const) {
    expect(a.counts?.[id]).toBe(1)
    expect(a.bench[id]).toBeUndefined()
    expect(a.slips).not.toContain(id)
  }
  const player = { name: 'Участник', attempts: 1, first: a, best: a, last: a }
  const html = renderToStaticMarkup(<PlayerCard room="test" secret="test" player={player} pick="last" catalog={[]} onShare={() => {}} />)
  for (const title of ['Объективный критерий', 'Вопрос о последствиях', 'Вопрос о выгоде', 'Общая задача', 'Пробный вариант']) {
    expect(html).toContain(`${title}: 1 из 5 реплик`)
  }
  expect(html).not.toContain('Сильных приёмов в репликах не нашлось')
  expect(a.slips).not.toContain('ask_interest')
  // Сохранённые комнаты до появления counts продолжают открываться.
  const legacy = { ...a, counts: undefined }
  expect(() => renderToStaticMarkup(<PlayerCard room="test" secret="test" player={{ ...player, last: legacy }} pick="last" catalog={[]} onShare={() => {}} />)).not.toThrow()
})
