import { describe, expect, it } from 'vitest'
import { FACES, looksFemale, pickFace } from './faces'

const ids = Array.from({ length: 40 }, (_, n) => `gen-${(n * 2654435761 >>> 0).toString(16).padStart(10, '0').slice(0, 10)}`)

describe('лица для своих дел', () => {
  it('то же дело — то же лицо, пол соблюдается', () => {
    for (const id of ids) {
      const a = pickFace({ id, female: true, text: 'Аренда склада' })
      expect(pickFace({ id, female: true, text: 'Аренда склада' })).toBe(a)
      expect(FACES.find((f) => f.id === a)?.female).toBe(true)
      expect(FACES.find((f) => f.id === pickFace({ id, female: false, text: 'Аренда склада' }))?.female).toBe(false)
    }
  })

  it('разные дела одной сферы дают разные лица, подходящий типаж — чаще', () => {
    const got = ids.map((id) => pickFace({ id, female: false, text: 'Подряд ремонт офиса руководитель строительной фирмы' }))
    expect(new Set(got).size).toBeGreaterThan(1)
    expect(got.filter((x) => x === 'foreman').length).toBeGreaterThan(got.length / 2)
  })

  it('возраст сдвигает выбор', () => {
    const young = ids.map((id) => pickFace({ id, female: false, text: 'Найм', age: 26 }))
    const old = ids.map((id) => pickFace({ id, female: false, text: 'Найм', age: 62 }))
    expect(young.filter((x) => x === 'dev').length).toBeGreaterThan(old.filter((x) => x === 'dev').length)
  })

  it('пол по имени для старых дел', () => {
    expect(looksFemale('Татьяна Тихонова')).toBe(true)
    expect(looksFemale('Никита Смолин')).toBe(false)
    expect(looksFemale('Эрик Смолин')).toBe(false)
  })
})
