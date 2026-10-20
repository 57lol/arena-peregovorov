import { describe, expect, it } from 'vitest'
import { SCENARIOS } from '../content/scenarios'
import type { Scenario } from '../engine/types'
import { BUSINESS_SCENES, pickPlace, portraitFor, sceneFor } from './cast'
import { PORTRAITS, SCENES } from './ui'

const base = SCENARIOS.find((s) => s.id === 'client') ?? SCENARIOS[0]
const own = (n: number, text: { sphere?: string; title?: string; role?: string }, extra: Partial<Scenario> = {}): Scenario => ({
  ...base,
  id: `gen-${(n * 2654435761 >>> 0).toString(16).padStart(10, '0')}${(n * 40503 >>> 0).toString(16).padStart(8, '0')}`,
  sphere: text.sphere ?? 'Переговоры',
  title: text.title ?? 'Встреча',
  player: { ...base.player, role: 'сотрудник' },
  opponent: { ...base.opponent, character: { ...base.opponent.character, name: 'Иван Петров', role: text.role ?? 'партнёр', company: 'ООО «Ромашка»', portrait: '' } },
  ...extra,
})
const many = (text: Parameters<typeof own>[1]) => Array.from({ length: 60 }, (_, n) => sceneFor(own(n, text)))

describe('место встречи своего дела', () => {
  it('подходящее место выпадает чаще, но не всегда', () => {
    const buy = many({ sphere: 'Закупки', title: 'Поставка комплектующих для линии' })
    expect(buy.filter((s) => s === 'factory' || s === 'inei').length).toBeGreaterThan(buy.length * 0.7)
    expect(new Set(buy).size).toBeGreaterThan(1)
    const rent = many({ sphere: 'Аренда', title: 'Аренда офиса в бизнес-центре' })
    expect(rent.filter((s) => s === 'office').length).toBeGreaterThan(rent.length / 2)
  })

  it('Стамбул и Лагос — только когда дело про них', () => {
    expect(many({ sphere: 'Аренда', title: 'Аренда склада' }).some((s) => s === 'istanbul' || s === 'lagos')).toBe(false)
    expect(many({ sphere: 'Продажи', title: 'Экспорт оборудования в Турцию, встреча в Стамбуле' }).filter((s) => s === 'istanbul').length).toBeGreaterThan(30)
  })

  it('выбор руководителя важнее подбора; чужие места не принимаются', () => {
    expect(sceneFor(own(1, { sphere: 'Закупки' }, { scene: 'bytovka' }))).toBe('bytovka')
    expect(sceneFor(own(1, { sphere: 'Закупки' }, { scene: 'street' }))).toBe(pickPlace(own(1, { sphere: 'Закупки' })))
  })

  it('дела из папки остаются на своих местах', () => {
    const tara = SCENARIOS.find((s) => s.id === 'tara')!
    expect(sceneFor(tara)).toBe('factory')
    const offer = SCENARIOS.find((s) => s.id === 'offer')!
    expect(sceneFor(offer)).toBe('office')
  })

  it('все деловые места и лица пула есть в реестре графики', () => {
    for (const s of BUSINESS_SCENES) expect(SCENES[s]).toBeTruthy()
    for (let n = 0; n < 40; n++) expect(PORTRAITS[portraitFor(own(n, { role: 'юрист компании' }))]).toBeTruthy()
  })

  it('лицо, выбранное руководителем, сохраняется', () => {
    const sc = own(3, { role: 'юрист' })
    expect(portraitFor({ ...sc, opponent: { ...sc.opponent, character: { ...sc.opponent.character, portrait: 'banker' } } })).toBe('banker')
  })
})
