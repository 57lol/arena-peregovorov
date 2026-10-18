import { expect, it } from 'vitest'
import { generateJuryKeys } from './jury-keys'
import { parseJuryKeys } from '../src/server/pass'

it('генератор возвращает N уникальных ключей и готовые ссылки', () => {
  const output = generateJuryKeys(3, ['Анна', 'Борис', 'Вера'])
  const raw = JSON.parse(output.split('\n')[0].slice('JURY_KEYS='.length))
  const judges = parseJuryKeys(raw)
  expect(judges.map((j) => j.name)).toEqual(['Анна', 'Борис', 'Вера'])
  expect(new Set(judges.map((j) => j.key)).size).toBe(3)
  for (const j of judges) {
    expect(j.key).toMatch(/^[\w-]{32}$/)
    expect(output).toContain(`https://arena-peregovorov.ru/?key=${j.key}`)
  }
  expect(generateJuryKeys(1)).not.toBe(generateJuryKeys(1))
})

it('ошибки количества и имён не дают вывести непригодную конфигурацию', () => {
  for (const n of [0, -1, 1.5, NaN, 1001]) expect(() => generateJuryKeys(n)).toThrow()
  expect(() => generateJuryKeys(2, ['Анна'])).toThrow()
  for (const names of [['Анна', 'Анна'], ['Анна', ''], ['Анна:a', 'Борис']])
    expect(() => generateJuryKeys(2, names)).toThrow()
})
