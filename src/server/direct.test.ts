import { describe, expect, it } from 'vitest'
import { direct, liveRole, liveVoiceFor, naturalMode, spellOut } from './direct'
import { system } from './voice'
import { tara } from '../content/scenarios/tara'

describe('режиссёр речи', () => {
  it('значки и сокращения — словами, в числе по последнему числу', () => {
    expect(spellOut('212 ₽ за короб')).toBe('212 рублей за короб')
    expect(spellOut('204 ₽, 1 руб.')).toBe('204 рубля, 1 рубль')
    expect(spellOut('скидка 12%, потом 2,5%')).toBe('скидка 12 процентов, потом 2,5 процента')
    expect(spellOut('стоимость — 1,5 млн ₽')).toBe('стоимость — полтора миллиона рублей')
    expect(spellOut('1,4 млн')).toBe('1 миллион 400 тысяч')
    expect(spellOut('80 000 в месяц')).toBe('80000 в месяц')
    expect(spellOut('180 тыс.')).toBe('180 тысяч')
  })

  it('паузы: вступительное слово, противопоставление, точка; раздумье длиннее', () => {
    const t = direct('Ну смотрите, срок могу сократить, а вот по деньгам — нет. Думайте.', 'neutral')
    expect(t).toBe('Ну смотрите, sil<[180]> срок могу сократить, <[small]> а вот по деньгам — <[tiny]> нет. sil<[220]> Думайте.')
    const slow = direct('Так... ну, допустим.', 'thinking')
    expect(slow).toBe('Так... sil<[570]> ну, sil<[270]> допустим.')
    // раздражённый — паузы короче
    expect(direct('Нет. Давайте дальше.', 'annoyed')).toBe('Нет. sil<[150]> Давайте дальше.')
  })

  it('акцент после «а вот», чужую разметку из реплики убираем, в начале и в конце пауз нет', () => {
    expect(direct('Срок подвинем, а вот цену — нет.')).toContain('а вот **цену**')
    expect(direct('*Внимание* sil<[5000]> [[a]] +++ всё.')).toBe('Внимание всё.')
    expect(direct('Смотрите...')).toBe('Смотрите...')
  })

  it('livetts: пара голосу лица, амплуа под эмоцию, флаг сервера', () => {
    expect(liveVoiceFor('alexander')).toBe('denis')
    expect(liveVoiceFor('julia')).toBe('irina')
    expect(liveVoiceFor('irina')).toBe('irina')
    expect(liveRole('denis', 'neutral')).toBe('casual')
    expect(liveRole('denis', 'angry')).toBe('formal')
    expect(liveRole('sergey', 'thinking')).toBe('support')
    expect(liveRole('alexander', 'neutral')).toBeUndefined()
    expect(naturalMode({})).toBe('off')
    expect(naturalMode({ NATURAL_SPEECH: 'live' })).toBe('live')
  })

  it('промпт «для голоса» — только с флагом', () => {
    expect(system(tara)).not.toContain('пиши для голоса')
    expect(system(tara, true)).toContain('пиши для голоса')
  })
})
