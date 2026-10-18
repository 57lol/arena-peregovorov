/**
 * Китайский акцент Ли Вэя — только в голосе. На экране обычный русский; в синтез (ElevenLabs v3) уходит текст,
 * переписанный под то, что трудно носителю китайского (docs/research/chinese-russian.md):
 * - ы → и: в китайском нет [ы], её чаще всего заменяют на [и] («ви», «бистро»);
 * - нет противопоставления твёрдых и мягких: мягкий знак перед согласным и в конце слова пропадает («толко», «ест»),
 *   возвратное -ся/-сь твёрдое («смеётса», «договорилис»);
 * - нет дрожащего [р]: в сочетании согласных после первого слога р → л («бистло», «воплос», «маршлут»), на сильном
 *   уровне — везде («длуг», «пледоплата»);
 * - в китайском слоге не бывает стечения согласных в начале: на сильном уровне «с/з + согласный» разбивается гласным
 *   («сыклад»).
 * Не берём: ш → с (у носителя путунхуа есть свой [ʂ], замена характерна разве что для южных диалектов), оглушение
 * б/д/г и замену букв в числах — числа и условия сделки должны звучать точно. Мягкий знак перед гласной (разделительный)
 * не трогаем: «семья» не станет «семя».
 * Уровни: 1 — лёгкий (ы, ь), 2 — средний (+ -ся, р в стечении не в первом слоге), 3 — сильный (+ все р, вставная гласная).
 * Название фирмы («Хуамин Электроникс») и числа не трогаем.
 * Преобразование детерминированное, латиницу ([пометки], MOQ, Alipay) и цифры не трогает; знак ударения U+0301 сохраняется.
 */
export type ZhLevel = 0 | 1 | 2 | 3

/** В игре: средний. Варианты для сравнения на слух — ~/Arena-materials/final/liwei-accent. */
export const ZH_LEVEL: ZhLevel = 2

const CONS = 'бвгджзйклмнпрстфхцчшщ'
const VOWELS = 'аеёиоуыэюя'
const ACUTE = '\u0301'
// числительные и юани — как есть: «тли» вместо «три» собьёт цену
const KEEP = /^(?:ноль|нул|од[иен]|перв|дв[аеуо]|втор|тр[иеё]|четыр|пят|шест|сем|восем|девят|десят|сорок|девян|сто|двест|трист|тысяч|миллион|миллиард|процент|юан|электроник)/

const isCons = (ch: string | undefined) => !!ch && CONS.includes(ch)
const sameCase = (src: string, to: string) => (src === src.toLowerCase() ? to : to.toUpperCase())

function word(w: string, level: ZhLevel): string {
  const lower = w.toLowerCase()
  if (KEEP.test(lower.replace(new RegExp(ACUTE, 'g'), ''))) return w
  const ch = [...w]
  const lo = [...lower]
  // буква без знаков ударения: соседи для правил
  const letters = lo.map((c, i) => ({ c, i })).filter((x) => x.c !== ACUTE)
  const out = ch.slice()
  letters.forEach(({ c, i }, k) => {
    const prev = letters[k - 1]?.c
    const next = letters[k + 1]?.c
    if (c === 'ы') out[i] = sameCase(ch[i], 'и')
    else if (c === 'ь' && (next === undefined || isCons(next))) out[i] = ''
    // средний уровень не трогает первый слог: «друг», «предоплата», «проверю» узнаются по началу (whisper путал «длуг» с «глук»)
    else if (c === 'р' && level >= 2 && (level >= 3 || (isCons(prev) && letters.slice(0, k).some((x) => VOWELS.includes(x.c))))) out[i] = sameCase(ch[i], 'л')
  })
  let s = out.join('')
  if (level >= 2) s = s.replace(/ся$/u, 'са').replace(/СЯ$/u, 'СА')
  if (level >= 3 && letters.length > 3 && /[сз]/.test(letters[0].c) && isCons(letters[1].c) && letters[1].c !== 'ь') {
    const [first, ...rest] = [...s]
    s = first + sameCase(rest.join(''), 'ы') + rest.join('')
  }
  return s
}

/** Текст для синтеза с акцентом нужной силы. */
export function zhAccent(text: string, level: ZhLevel = ZH_LEVEL): string {
  if (!level) return text
  return text.replace(/(?:[а-яё]|\u0301)+/giu, (w) => word(w, level))
}
