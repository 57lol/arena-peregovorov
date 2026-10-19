import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { getScenario, harder } from '../content/scenarios'
import { BEHAVIOR_DICT } from '../engine/behaviors'
import { offlineTurn } from '../engine/offline'
import type { Offer } from '../engine/types'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-ru-context-'))
const { analyzeMove } = await import('./analyze')

// Один ответ «сорок» означает разные пункты. Проверяем настоящий путь передачи истории,
// включая отказ модели; ни один тест не обращается к сети.
const samples: [string, string, string, Offer][] = [
  ['china', 'Какая цена датчика вас устроит?', 'Сорок', { price: 2 }],
  ['china', 'Сколько дней на доставку?', 'Сорок', { delivery: 0 }],
  ['shop', 'Какую скидку вы хотите?', 'Десять', { disc: 2 }],
  ['shop', 'Через сколько дней сделать возврат?', 'Десять', { swap: 1 }],
]
for (const [id, said, text, offer] of samples) for (const sc of [getScenario(id)!, harder(getScenario(id)!)]) {
  const history = [{ ...offlineTurn(sc, [], 'Начнём.', BEHAVIOR_DICT), opponentLine: said }]
  it(`${sc.id}: браузер передаёт вопрос «${said}»`, () => {
    const a = offlineTurn(sc, history, text, BEHAVIOR_DICT).analysis
    expect(a.offer).toEqual(offer)
    expect(a.accepts).not.toBe(true)
  })
  for (const mode of ['offline', 'failure', 'empty'] as const) {
    it(`${sc.id}/${mode}: сервер передаёт вопрос «${said}»`, async () => {
      const json = vi.fn(async () => {
        if (mode !== 'empty') throw new Error('Заглушка: модель недоступна')
        return { behaviors: [], offer: [], accepts: false, walksAway: false, asksAbout: [], toneViolation: false }
      })
      const result = await analyzeMove({ name: mode === 'offline' ? 'offline' : 'yandex',
        model: `ru-context-${mode}`, json }, sc, BEHAVIOR_DICT, history, text)
      expect(result.analysis.offer).toEqual(offer)
      expect(result.analysis.accepts).not.toBe(true)
      expect(result.source).toBe(mode === 'empty' ? 'llm' : 'offline')
      expect(json).toHaveBeenCalledTimes(mode === 'offline' ? 0 : 1)
    })
  }
}
