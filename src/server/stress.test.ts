import { describe, expect, it, vi } from 'vitest'
import { FREQUENT, HOMOGRAPHS, PHRASES, RISKY, STEMS, WORDS } from '../content/stress-dict'
import { naturalMode, polish, rememberSpoken, spokenOf } from './direct'
import { accent, forSpeechKit, markSet, render, resolveStress, settle, stress as stressAll, unstress } from './stress'
import { system } from './voice'
import { tara } from '../content/scenarios/tara'

const VOWEL = /[аеёиоуыэюя]/i
// большинство проверок — на наборе «рискованных» слов, чтобы не тонуть в ударениях обычных слов
const stress = (t: string) => stressAll(t, 'risky')
const VOWEL_G = /[аеёиоуыэюя]/gi
const plain = (s: string) => s.replace(/\+/g, '').toLowerCase().replace(/ё/g, 'е')

describe('словарь ударений: формат', () => {
  it('у каждой формы (части через дефис) одно ударение перед гласной, ударная «ё» или один слог', () => {
    const forms = [...STEMS.flatMap(([s, ends]) => ends.map((e) => s + e)), ...WORDS, ...RISKY, ...FREQUENT]
    expect(forms.length).toBeGreaterThan(5000)
    for (const f of forms)
      for (const part of f.split('-')) {
        const n = (part.match(/\+/g) ?? []).length
        expect(n === 1 || (n === 0 && (/ё/i.test(part) || (part.match(VOWEL_G) ?? []).length < 2)), f).toBe(true)
        if (n) expect(part[part.indexOf('+') + 1], f).toMatch(VOWEL)
      }
  })

  it('исправления по словарям: каталог, партия, щавель, Сафин, Алабуга', () => {
    expect(stress('каталог, партии, щавеля, Сафина, Алабуге')).toBe('катал+ог, п+артии, щавел+я, С+афина, Ал+абуге')
  })

  it('омографы: варианты — то же слово, ударение перед гласной, номера по умолчанию в границах', () => {
    for (const [key, h] of Object.entries(HOMOGRAPHS)) {
      expect(h.v.length, key).toBe(h.g.length)
      for (const v of h.v) {
        expect(plain(v), key).toBe(key)
        expect(v[v.indexOf('+') + 1], v).toMatch(VOWEL)
      }
      if (h.def !== undefined) expect(h.v[h.def], key).toBeDefined()
    }
    for (const [p, m] of PHRASES) expect(plain(m)).toBe(plain(p))
  })
})

describe('детерминированный проход', () => {
  it('имена, места, термины; регистр и «ё» — как в тексте', () => {
    expect(stress('Звонит Гимадиев: договор на квартал, оптовая партия.')).toBe('Звон+ит Гимад+иев: догов+ор на кварт+ал, опт+овая п+артия.')
    expect(stress('В «Семерочке» у Сафиной торты. Алабуга — не Елабуга!')).toBe('В «Семёрочке» у С+афиной т+орты. Ал+абуга — не Ел+абуга!')
    expect(stress('АЛАБУГА, Мамадыш, на КАМАЗе, каталог')).toBe('АЛ+АБУГА, Мамад+ыш, на КАМ+АЗе, катал+ог')
    expect(stress('до пятисот, с двумястами')).toBe('до пятис+от, с двумяст+ами')
  })

  it('все слова корпуса (по умолчанию) и только рискованные (STRESS_MARK=risky)', () => {
    expect(stressAll('Сколько это стоит?')).toBe('Ск+олько +это ст+оит?')
    expect(stress('Сколько это стоит?')).toBe('Сколько это ст+оит?')
    expect(markSet({})).toBe('all')
    expect(markSet({ STRESS_MARK: 'risky' })).toBe('risky')
    // «е» вместо «ё» восстанавливаем только в своих словах: «узнаем» и «узнаём» — разные слова
    expect(stressAll('еще узнаем')).toMatch(/^ещё /)
    expect(stressAll('еще узнаем')).not.toContain('узнаём')
  })

  it('уже размеченное не трогаем: «+» и U+0301', () => {
    expect(stress('догов+ор стоит')).toBe('догов+ор стоит')
    expect(stress('дого́вор')).toBe('дого́вор')
  })

  it('омографы по контексту', () => {
    expect(stress('Сколько это стоит? Коробка стоит на складе.')).toBe('Сколько это ст+оит? Кор+обка сто+ит на скл+аде.')
    expect(stress('Это стоит обсудить. Не стоит.')).toBe('Это ст+оит обсудить. Не ст+оит.')
    expect(stress('Стоит двести рублей, стоит у двери.')).toBe('Ст+оит дв+ести рублей, сто+ит у дв+ери.')
    expect(stress('Мы уже договорились: проход уже, чем у соседей.')).toBe('Мы уж+е договор+ились: проход +уже, чем у соседей.')
    expect(stress('Три шага, два часа, 24 часа, до часа ночи, полчаса.')).toBe('Три шаг+а, два час+а, 24 час+а, до ч+аса н+очи, полчаса.')
    expect(stress('На двери замок. Открой двери.')).toBe('На двер+и зам+ок. Открой дв+ери.')
    expect(stress('Старый замок на горе.')).toBe('Старый з+амок на горе.')
    expect(stress('Без руки, а руки помыть.')).toBe('Без рук+и, а р+уки помыть.')
    expect(stress('Ни слова больше, это слова.')).toBe('Ни сл+ова больше, это слов+а.')
    expect(stress('Цены выросли из-за цены нефти.')).toBe('Ц+ены выросли из-з+а цен+ы нефти.')
    expect(stress('Мне самому неловко, но в самом деле так.')).toBe('Мне самом+у неловко, но в с+амом деле так.')
    expect(stress('Большая часть денег, большая партия.')).toBe('Б+ольшая часть д+енег, больш+ая п+артия.')
    expect(stress('Дорогой мой, пойдём той дорогой.')).toBe('Дорог+ой мой, пойдём той дор+огой.')
    expect(stress('Мешок муки и мука для пирога.')).toBe('Мешок мук+и и мук+а для пирога.')
  })

  it('нерешённый омограф — в списке для нейросети; без неё — по умолчанию или как есть', () => {
    const a = accent('Обсудим цены и мука.', 'risky')
    expect(a.open.map((o) => o.word)).toEqual(['цены', 'мука'])
    expect(settle(a)).toBe('Обсудим цены и мука.')
    expect(settle(accent('Ключ в двери.'))).toBe('Ключ в двер+и.')
  })
})

describe('нейросеть для омографов', () => {
  it('выбор из вариантов по номерам; мусор и таймаут — вариант по умолчанию', async () => {
    const a = accent('Обсудим цены, а потом в двери.', 'risky')
    const ask = vi.fn(async (_s: string, user: string) => {
      expect(user).toContain('«цены»: 1 — мн. ч.')
      return { a: [1, 2] }
    })
    expect(await resolveStress(a, ask)).toBe('Обсудим ц+ены, а пот+ом в двер+и.')
    expect(await resolveStress(a, async () => ({ a: [9, 'x'] }))).toBe('Обсудим цены, а пот+ом в двер+и.')
    expect(await resolveStress(a, () => new Promise((ok) => setTimeout(() => ok({ a: [2, 1] }), 200)), 30)).toBe('Обсудим цены, а пот+ом в двер+и.')
    expect(await resolveStress(a, async () => Promise.reject(new Error('нет')))).toBe('Обсудим цены, а пот+ом в двер+и.')
    expect(await resolveStress(accent('Без омографов.'), ask)).toBe('Без омографов.')
    expect(ask).toHaveBeenCalledTimes(1)
  })
})

describe('как ударение получает движок', () => {
  const t = 'Догов+ор на кварт+ал, ещё «Сем+ёрочка».'
  it('SpeechKit — «+», ElevenLabs — U+0301 после гласной; над «ё» знака нет', () => {
    expect(render(t, 'speechkit')).toBe('Догов+ор на кварт+ал, ещё «Семёрочка».')
    expect(render(t, 'eleven')).toBe('Догово́р на кварта́л, ещё «Семёрочка».')
  })
  it('SpeechKit: «ОЭЗ» — буквами через пробел, «КАМАЗ» — словом; остальным как есть', () => {
    expect(forSpeechKit('ОЭЗ «Алабуга», на КАМ+АЗе')).toBe('О Э З «Алабуга», на Кам+азе')
    expect(render('ОЭЗ и КАМ+АЗ', 'eleven')).toBe('ОЭЗ и КАМА́З')
  })
  it('на экран — без ударений', () => {
    expect(unstress('Это ст+оит 204 рубля, +5 процентов, замо́к')).toBe('Это стоит 204 рубля, +5 процентов, замок')
  })
})

describe('аккуратные паузы (voices+)', () => {
  it('паузы только по смыслу: перед «но/а/если», между фразами, на многоточии; без sil и вступительных', () => {
    expect(polish('Ну смотрите, срок могу сократить, а вот по деньгам — нет. Думайте.')).toBe(
      'Ну смотр+ите, срок мог+у сократить, <[tiny]> а вот по деньг+ам — нет. <[tiny]> Думайте.',
    )
    expect(polish('Так… ну, допустим. 204 ₽, если договор.')).toBe('Так... <[tiny]> ну, доп+устим. <[tiny]> 204 рубл+я, <[tiny]> +если догов+ор.')
    // раздражённый — без передышек между фразами
    expect(polish('Нет. Давайте дальше.', 'annoyed')).toBe('Нет. Дав+айте д+альше.')
    expect(polish('Цена *хорошая* sil<[500]>, но всё.')).not.toMatch(/sil|\*/)
  })

  it('ударения модели в реплике помним (на экран — без плюсов), но синтезу их не отдаём', () => {
    rememberSpoken('Это стоит 200.', 'Это ст+оит 200.')
    expect(spokenOf('Это стоит 200.')).toBe('Это ст+оит 200.')
    expect(spokenOf('Другое')).toBe('Другое')
  })

  it('флаг и промпт', () => {
    expect(naturalMode({ NATURAL_SPEECH: 'voices+' })).toBe('voices+')
    expect(system(tara)).not.toContain('омограф')
    expect(system(tara, false, true)).toContain('«ё»')
  })
})

