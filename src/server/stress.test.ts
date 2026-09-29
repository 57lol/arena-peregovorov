import { describe, expect, it } from 'vitest'
import { naturalMode, polish, rememberSpoken, spokenOf } from './direct'
import { stress, unstress } from './stress'
import { system } from './voice'
import { tara } from '../content/scenarios/tara'

describe('ударения и аккуратные паузы (voices+)', () => {
  it('словарь: имена, места, частые ошибки; регистр и ё — как надо', () => {
    expect(stress('Звонит Гимадиев: договор на квартал, оптовая партия.')).toBe('Звон+ит Гимад+иев: догов+ор на кварт+ал, опт+овая парт+ия.')
    expect(stress('В «Семерочке» у Сафиной торты. Алабуга — не Елабуга!')).toBe('В «Сем+ёрочке» у Саф+иной т+орты. Алаб+уга — не Ел+абуга!')
    expect(stress('до пятисот, с двумястами')).toBe('до пятис+от, с двумяст+ами')
    // что уже размечено моделью и чего нет в словаре — не трогаем
    expect(stress('догов+ор стоит')).toBe('догов+ор стоит')
    expect(unstress('Это ст+оит 204 рубля, +5 процентов')).toBe('Это стоит 204 рубля, +5 процентов')
  })

  it('паузы только по смыслу: перед «но/а/если», между фразами, на многоточии; без sil и вступительных', () => {
    expect(polish('Ну смотрите, срок могу сократить, а вот по деньгам — нет. Думайте.')).toBe(
      'Ну смотрите, срок могу сократить, <[tiny]> а вот по деньгам — нет. <[tiny]> Думайте.',
    )
    expect(polish('Так… ну, допустим. 204 ₽, если договор.')).toBe('Так... <[tiny]> ну, допустим. <[tiny]> 204 рубля, <[tiny]> если догов+ор.')
    // раздражённый — без передышек между фразами
    expect(polish('Нет. Давайте дальше.', 'annoyed')).toBe('Нет. Давайте дальше.')
    expect(polish('Цена *хорошая* sil<[500]>, но всё.')).not.toMatch(/sil|\*/)
  })

  it('ударения модели: на экран без плюсов, синтезу — с ними', () => {
    rememberSpoken('Это стоит 200.', 'Это ст+оит 200.')
    expect(spokenOf('Это стоит 200.')).toBe('Это ст+оит 200.')
    expect(spokenOf('Другое')).toBe('Другое')
  })

  it('флаг и промпт', () => {
    expect(naturalMode({ NATURAL_SPEECH: 'voices+' })).toBe('voices+')
    expect(system(tara)).not.toContain('омограф')
    expect(system(tara, false, true)).toContain('омограф')
  })
})
