// Ударения для синтеза. Словарь — src/content/stress-dict.ts (один на все движки), здесь — как его применить:
// 1) детерминированный проход: формы из словаря, омографы по правилам контекста;
// 2) омографы, которые правила не решили, — быстрая нейросеть выбирает вариант по смыслу (resolveStress), не успела —
//    вариант по умолчанию или без ударения (тогда решает синтезатор);
// 3) ударение передаётся каждому движку по-своему (render): SpeechKit — «+» перед гласной (его TTS-разметка),
//    ElevenLabs — знак ударения U+0301 после гласной, OpenAI разметку не слушается — ему без неё. Проверка синтезом,
//    распознаванием и судьёй-нейросетью — ~/Arena-materials/final/stress/STRESS_REPORT.md и listen.html.
// Ударения, которые ставит в реплике сама модель (STRESS_HINT), не используем: YandexGPT ставит «+» верно в ~40% случаев.

import { FREQUENT, HOMOGRAPHS, PHRASES, RISKY, STEMS, WORDS, type Homograph } from '../content/stress-dict'

const VOWEL = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ'
const ACUTE = '\u0301'
const norm = (w: string) => w.toLowerCase().replace(/ё/g, 'е')
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Форма → с ударением. Два набора: «рискованные» (STEMS, WORDS и RISKY — разобраны поштучно) и все формы корпуса
 * (+ FREQUENT). Ключ — форма в нижнем регистре и она же с «е» вместо «ё»; «е» → «ё» восстанавливаем только для
 * своих слов (WORDS, STEMS): в частотном словаре есть пары вроде «узнаем / узнаём».
 */
type Forms = Map<string, string>
function forms(lists: { marked: string[]; yo: boolean }[]): Forms {
  const m: Forms = new Map()
  for (const { marked, yo } of lists)
    for (const f of marked) {
      const plain = f.replace(/\+/g, '').toLowerCase()
      m.set(plain, f)
      if (yo || !plain.includes('ё')) m.set(norm(plain), f)
    }
  return m
}
const OWN = [...STEMS.flatMap(([stem, ends]) => ends.map((e) => stem + e)), ...WORDS]
const CORE = forms([{ marked: RISKY, yo: false }, { marked: OWN, yo: true }])
const FULL = forms([{ marked: FREQUENT, yo: false }, { marked: RISKY, yo: false }, { marked: OWN, yo: true }])

/**
 * Какие слова размечать: all (по умолчанию) — все формы корпуса, в заранее известных текстах это 99,7% слов, в новой
 * реплике — большая часть; risky (STRESS_MARK=risky) — только разобранные поштучно: имена, термины, омографы, частые
 * ошибки. Синтезом разницы в естественности не слышно (ab/results.json); risky короче на знаки U+0301 у ElevenLabs.
 */
export type MarkSet = 'risky' | 'all'
export const markSet = (env = process.env): MarkSet => (env.STRESS_MARK === 'risky' ? 'risky' : 'all')
const lookup = (word: string, set: MarkSet) => {
  const m = set === 'all' ? FULL : CORE
  const low = word.toLowerCase()
  return m.get(low) ?? m.get(norm(low))
}

/** Фразы целиком (контекст, который правилами не описать): «плоская» → с ударениями (можно несколько «+»). */
const PHRASE = new Map(PHRASES.map(([p, m]) => [norm(p), m]))
const PHRASE_RE = PHRASES.length
  ? new RegExp(`(?<![\\p{L}+])(?<!\\u0301)(${PHRASES.map(([p]) => esc(p).replace(/[её]/g, '[её]')).sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}])`, 'giu')
  : null

/** Буквы — из текста (регистр, «е» вместо «ё» → «ё» по словарю), «+» — из словаря; «+» может быть несколько (фразы). */
function apply(word: string, marked: string): string {
  const plain = marked.replace(/\+/g, '')
  if (norm(plain) !== norm(word)) return word
  let out = ''
  let k = 0
  for (const ch of marked) {
    if (ch === '+') {
      out += '+'
      continue
    }
    const w = word[k++]
    out += ch === 'ё' && w === 'е' ? 'ё' : ch === 'ё' && w === 'Е' ? 'Ё' : w
  }
  return out
}

// числа — тоже слова: «24 часа» решает правило по соседу-числу
const WORD = /(?:[\p{L}\p{N}+]\u0301?)+(?:-(?:[\p{L}\p{N}+]\u0301?)+)*/gu
const hasMark = (w: string) => w.includes('+') || w.includes(ACUTE)

// ---------- правила для омографов ----------

/** Контекст слова внутри предложения: соседние слова в нижнем регистре (ё → е), ближние первыми. */
export interface Ctx {
  prev: string[]
  next: string[]
  /** текст сразу после слова (знаки препинания) */
  after: string
  /** всё предложение в нижнем регистре */
  sentence: string
}

const GEN = new Set('без из от до для кроме у с со около возле вместо после ради из-за из-под против вокруг среди мимо вдоль вне внутри позади напротив посреди помимо насчет ниже выше'.split(' '))
const GEN_NOUN = new Set('рост роста размер размера уровень уровня вопрос вопроса часть части половина половину сумма суммы процент процента процентов пересмотр пересмотра формула формулу формулы фиксация фиксацию индексация индексацию скидка скидку'.split(' '))
const NUM234 = /^(?:два|две|три|четыре|оба|обе|полтора|полторы|(?:\d*[02-9])?[234])$/
const PLURAL_ADJ = /(ые|ие)$/
const INF = /(ть|ться|ти|тись|чь|чься)$/
const NOT_INF = new Set('путь суть часть сеть мать честь власть новость сумасшедшую чуть ровно'.split(' '))
const isInf = (w = '') => INF.test(w) && !NOT_INF.has(w) && !/(ость|есть|сть)$/.test(w)
const isNum = (w = '') => /^\d/.test(w) || /^(один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|\p{L}+дцать|сорок|сто|двести|триста|\p{L}+сот|тысяч\p{L}*|миллион\p{L}*|полтора|полторы|пол|ноль|копейки|копейку|рубль|рубля|рублей)$/u.test(w)

/** Правило возвращает индекс варианта или undefined (правило не знает). */
type Rule = (c: Ctx) => number | undefined

// стоит/стоят/стоим: «сколько стоит», «стоит сделать», «стоит 200» — цена (0); «стоит на складе» — находится (1)
const PRICE_NEXT = new Set('ли того дорого дешево дороже дешевле недорого копейки денег столько больше меньше немало немного мало много всего ровно примерно порядка'.split(' '))
const PLACE_NEXT = new Set('на у под над перед возле рядом там тут здесь посреди во колом столбом насмерть намертво пустой пустая пустые без в'.split(' '))
const PRICE_PREV = new Set('сколько чего ничего дорого дешево копейки почти недорого столько дороже дешевле'.split(' '))
const cost: Rule = (c) => {
  if (c.prev.slice(0, 4).some((w) => PRICE_PREV.has(w))) return 0
  const n = c.next[0]
  // «пока стоим», «так и стоит.» — находится; «не стоит.» — не нужно
  if (!n) return c.prev[0] === 'не' ? 0 : c.prev[0] === 'пока' || c.prev[0] === 'и' ? 1 : undefined
  if (isInf(n) || PRICE_NEXT.has(n) || isNum(n)) return 0
  if (n === 'в' || n === 'за') return isNum(c.next[1]) || ['районе', 'копеечку', 'цене'].includes(c.next[1]) ? 0 : n === 'в' ? 1 : undefined
  if (PLACE_NEXT.has(n)) return 1
  return undefined
}

const AFTER_NUM: Rule = (c) => (NUM234.test(c.prev[0] ?? '') || (NUM234.test(c.prev[1] ?? '') && /(ых|их)$/.test(c.prev[0] ?? '')) ? 1 : 0)
const EMPH = new Set('мне тебе ему ей нам вам им себе себя собой меня тебя его ее их нас вас сам сама сами само'.split(' '))
const self: Rule = (c) => (EMPH.has(c.prev[0] ?? '') || EMPH.has(c.next[0] ?? '') || !c.next[0] || /^\s*[,.!?;:—…]/.test(c.after) ? 0 : 1)

const CASTLE = /(гор[аеуы](?!\p{L})|корол|крепост|рыцар|средневеков|экскурс|двор(ец|ц)|башн|старинн|замков\p{L}* (стен|ворот))/u
const FLOUR = /(мешок|мешк|кило|кг|пекар|хлеб|тест[оа]|блин|пирог|сахар|масл|яйц|круп|пшеничн|ржан|молок|выпечк|испеч|мучн|сдоб)/u
const TORMENT = /(адск|сплошн|не жизнь|мучени|терпе|страда|одна мука|какая мука|вечная|муки совести|мука мне)/u

const RULES: Record<string, Rule> = {
  стоит: cost, стоят: cost, стоим: cost, стоите: cost, стоишь: cost,
  // «уже, чем» — сравнительная от «узкий»
  уже: (c) => (c.next[0] === 'чем' || /^\s*,?\s*чем(?!\p{L})/u.test(c.after) ? 1 : 0),
  // «два шага», «три часа» — ударение на окончании; «до часа ночи» — на основе
  шага: AFTER_NUM, часа: AFTER_NUM, ряда: AFTER_NUM, шара: AFTER_NUM,
  двери: (c) => (['на', 'о', 'об', 'при'].includes(c.prev[0]) ? 1 : c.prev[0] === 'в' ? undefined : 0),
  руки: (c) => (GEN.has(c.prev[0]) ? 1 : 0),
  глаза: (c) => (GEN.has(c.prev[0]) ? 1 : 0),
  слова: (c) => (GEN.has(c.prev[0]) || c.prev[0] === 'ни' ? 1 : 0),
  дела: (c) => (GEN.has(c.prev[0]) || ['нет', 'сути', 'ни'].includes(c.prev[0]) ? 1 : 0),
  цены: (c) => {
    // «из-за цены», «снижение цены», «ценнее цены» — род. п. ед. ч.
    if (GEN.has(c.prev[0]) || /(ени[ея]|ани[ея]|ии|ость|ости|ее|ше|же)$/.test(c.prev[0] ?? '') || GEN_NOUN.has(c.prev[0])) return 1
    if (['все', 'наши', 'ваши', 'их', 'эти', 'те', 'его', 'ее', 'мои', 'твои', 'свои', 'обе'].includes(c.prev[0]) || PLURAL_ADJ.test(c.prev[0] ?? '')) return 0
    if (['на', 'выросли', 'растут', 'упали', 'поднялись', 'снизились', 'кусаются', 'такие', 'у', 'сейчас', 'там', 'везде'].includes(c.next[0])) return 0
    return undefined
  },
  цеха: (c) => (PLURAL_ADJ.test(c.prev[0] ?? '') || ['все', 'наши', 'ваши', 'эти', 'те', 'оба'].includes(c.prev[0]) ? 1 : 0),
  дома: (c) => (PLURAL_ADJ.test(c.prev[0] ?? '') || ['все', 'эти', 'те', 'наши', 'ваши'].includes(c.prev[0]) ? 1 : 0),
  места: (c) => {
    if (GEN.has(c.prev[0]) || NUM234.test(c.prev[0] ?? '') || /(ого|его)$/.test(c.prev[0] ?? '') || ['нет', 'мало', 'много', 'больше', 'меньше', 'столько', 'сколько', 'достаточно', 'немного', 'полно', 'ни'].includes(c.prev[0])) return 0
    if (PLURAL_ADJ.test(c.prev[0] ?? '') || ['есть', 'заняты', 'свободны', 'остались', 'все'].includes(c.next[0])) return 1
    return undefined
  },
  стороны: (c) => {
    if (GEN.has(c.prev[0]) || /(ой|ей)$/.test(c.prev[0] ?? '') || ['его', 'ее', 'их'].includes(c.prev[0])) return 1
    if (['обе', 'две', 'все', 'три', 'четыре'].includes(c.prev[0]) || /(лись|ли|ются|ятся|утся|ны)$/.test(c.next[0] ?? '')) return 0
    return undefined
  },
  дорогой: (c) =>
    ['той', 'этой', 'своей', 'другой', 'прямой', 'обратной', 'окольной', 'короткой', 'длинной', 'одной', 'иной', 'пошли', 'пойдем', 'идти', 'иди', 'идем', 'ехать', 'едем', 'ехали', 'поехали', 'шли', 'пешей', 'лесной', 'проселочной'].includes(c.prev[0])
      ? 1
      : 0,
  потом: (c) =>
    ['обливаться', 'облился', 'обливался', 'пахнет', 'пахло', 'воняет', 'несет', 'покрылся', 'покрылась', 'залился', 'своим', 'холодным', 'кровавым', 'собственным'].includes(c.prev[0]) ||
    (c.next[0] === 'и' && c.next[1] === 'кровью')
      ? 1
      : 0,
  сети: (c) => (c.prev[0] === 'в' || c.prev[0] === 'во' ? 1 : 0),
  году: (c) => (c.prev.slice(0, 3).some((w) => w === 'в' || w === 'во') ? 1 : 0),
  часу: (c) => (c.prev.slice(0, 3).includes('в') ? 1 : 0),
  мою: (c) => (c.prev[0] === 'я' ? 1 : 0),
  вести: (c) => (PLURAL_ADJ.test(c.prev[0] ?? '') || ['эти', 'такие', 'какие', 'никакие'].includes(c.prev[0]) ? 1 : 0),
  начало: (c) => (isInf(c.next[0]) ? 1 : 0),
  самому: self, самой: self, самом: self, самого: self, самим: self, самих: self,
  // «с начала», «до начала года» — сущ.; «она начала», «начала думать» — глагол; иначе нейросеть
  начала: (c: Ctx) =>
    GEN.has(c.prev[0]) || ['самого', 'с', 'со', 'к', 'по'].includes(c.prev[0]) ? 0
    : ['она', 'я', 'ты', 'сама', 'та', 'мама', 'жена', 'уже', 'только', 'не', 'и'].includes(c.prev[0]) || isInf(c.next[0]) ? 1
    : undefined,
  складу: (c: Ctx) => (c.prev[0] === 'на' ? 1 : 0),
  кругу: (c: Ctx) => (c.prev.slice(0, 3).includes('в') ? 1 : 0),
  грани: (c: Ctx) => (c.prev[0] === 'на' ? 1 : 0),
  связи: (c: Ctx) => (c.prev[0] === 'в' && ['с', 'со'].includes(c.next[0]) ? 1 : 0),
  шагу: (c: Ctx) => (c.prev.slice(0, 3).includes('на') ? 1 : 0),
  цеху: (c: Ctx) => (['в', 'на'].includes(c.prev[0]) ? 1 : 0),
  виду: (c: Ctx) => (['в', 'на'].includes(c.prev[0]) ? 1 : 0),
  лица: (c: Ctx) => (GEN.has(c.prev[0]) ? 1 : 0),
  письма: (c: Ctx) => (PLURAL_ADJ.test(c.prev[0] ?? '') || ['все', 'эти', 'те', 'наши', 'ваши', 'два', 'три', 'четыре'].includes(c.prev[0]) ? 1 : 0),
  нужды: (c: Ctx) => (GEN.has(c.prev[0]) || ['нет', 'никакой', 'особой', 'острой'].includes(c.prev[0]) ? 1 : 0),
  среду: (c: Ctx) => (/ую$/.test(c.prev[0] ?? '') ? 1 : 0),
  прибыли: (c: Ctx) => (['мы', 'вы', 'они', 'все', 'гости', 'ребята', 'уже', 'только', 'наконец'].includes(c.prev[0]) ? 1 : 0),
  права: (c: Ctx) => (GEN.has(c.prev[0]) || ['нет', 'никакого', 'ни'].includes(c.prev[0]) ? 1 : 0),
}
// «вы приходите» — изъявительное; без «вы» — повелительное («Приходите!», «Заплатите сегодня»)
const YOU: Rule = (c) => (c.prev.slice(0, 3).includes('вы') ? 1 : 0)
for (const f of ['приходите', 'заходите', 'уходите', 'выходите', 'ходите', 'держите', 'выносите', 'изложите', 'предложите', 'заплатите', 'заслужите', 'поторопитесь', 'смотрите']) RULES[f] = YOU
for (const f of ['большая', 'большую', 'большие', 'большими', 'большим', 'больших']) RULES[f] = (c) => (/^(част|половин)/.test(c.next[0] ?? '') ? 1 : 0)
for (const f of ['замок', 'замка', 'замке', 'замки', 'замком', 'замков', 'замкам', 'замках']) RULES[f] = (c) => (CASTLE.test(c.sentence) ? 1 : 0)
for (const f of ['мука', 'муки', 'муку', 'мукой', 'муке']) RULES[f] = (c) => (FLOUR.test(c.sentence) ? 0 : TORMENT.test(c.sentence) ? 1 : undefined)

// ---------- проход по тексту ----------

export interface Open {
  /** позиция слова в размеченном тексте */
  at: number
  word: string
  key: string
}
export interface Accented {
  text: string
  /** омографы, которые правила не решили, — их решит resolveStress (или останется вариант по умолчанию) */
  open: Open[]
}

const sentences = (t: string) => [...t.matchAll(/[^.!?…]+[.!?…]*/g)].map((m) => ({ from: m.index!, to: m.index! + m[0].length }))

/** Детерминированная разметка: фразы, словарь, правила для омографов. Слова, где ударение уже стоит («+», U+0301), не трогаем. */
export function accent(text: string, set: MarkSet = markSet()): Accented {
  const src = PHRASE_RE ? text.replace(PHRASE_RE, (p: string) => apply(p, PHRASE.get(norm(p)) ?? p)) : text
  const words = [...src.matchAll(WORD)].map((m) => ({ w: m[0], at: m.index! }))
  const sent = sentences(src)
  const sentOf = (at: number) => sent.find((s) => at >= s.from && at < s.to) ?? { from: 0, to: src.length }
  let out = ''
  let last = 0
  const open: Open[] = []
  words.forEach(({ w, at }, i) => {
    out += src.slice(last, at)
    last = at + w.length
    if (hasMark(w)) return void (out += w)
    const s = sentOf(at)
    const inS = (j: number) => words[j] && words[j].at >= s.from && words[j].at < s.to
    const ctx = (): Ctx => ({
      prev: [1, 2, 3, 4].map((k) => i - k).filter(inS).map((j) => norm(words[j].w)),
      next: [1, 2, 3].map((k) => i + k).filter(inS).map((j) => norm(words[j].w)),
      after: src.slice(at + w.length, at + w.length + 12),
      sentence: norm(src.slice(s.from, s.to)),
    })
    // «слова-то», «по-людски»: целиком нет в словаре — размечаем части
    const parts = lookup(w, set) || HOMOGRAPHS[norm(w)] || !w.includes('-') ? [w] : w.split('-')
    parts.forEach((p, k) => {
      if (k) out += '-'
      const key = norm(p)
      const h = HOMOGRAPHS[key]
      const f = h ? undefined : lookup(p, set)
      if (!h) return void (out += f ? apply(p, f) : p)
      const pick = RULES[key]?.(ctx())
      if (pick !== undefined && h.v[pick]) return void (out += apply(p, h.v[pick]))
      if (h.ask) open.push({ at: out.length, word: p, key })
      else if (h.def !== undefined) return void (out += apply(p, h.v[h.def]))
      out += p
    })
  })
  return { text: out + src.slice(last), open }
}

/** Вариант по умолчанию для нерешённых омографов (или без ударения). */
export function settle(a: Accented, choice: (o: Open, h: Homograph) => number | undefined = () => undefined): string {
  let t = a.text
  for (const o of [...a.open].sort((x, y) => y.at - x.at)) {
    const h = HOMOGRAPHS[o.key]
    const pick = choice(o, h) ?? h.def
    if (pick === undefined || !h.v[pick]) continue
    t = t.slice(0, o.at) + apply(o.word, h.v[pick]) + t.slice(o.at + o.word.length)
  }
  return t
}

/** Ставит ударения по словарю и правилам (без нейросети). Где ударение уже стоит, не трогает. Регистр — как в тексте. */
export const stress = (text: string, set: MarkSet = markSet()): string => settle(accent(text, set))

/** Убирает ударения («+» перед гласной и U+0301) — для показа реплики на экране. */
export const unstress = (t: string) => t.replace(new RegExp(`\\+(?=[${VOWEL}])`, 'gu'), '').replace(/\u0301/g, '')

/**
 * SpeechKit: «ОЭЗ» livetts читает как «АС», а «О-Э-З» сливает в «Оеза» — пишем буквы через пробел; «КАМАЗ» капсом он
 * читает «КАИ» — пишем словом. OpenAI и ElevenLabs читают «ОЭЗ» сами верно.
 */
export const forSpeechKit = (t: string) =>
  t.replace(/(?<!\p{L})ОЭЗ(?!\p{L})/gu, 'О Э З').replace(/(?<!\p{L})КАМ(\+?)АЗ/gu, (_, p: string) => `Кам${p}аз`)

// ---------- нейросеть для омографов ----------

export const STRESS_SYSTEM =
  'Ты помогаешь синтезатору речи. Для каждого омографа во фразе выбери вариант ударения по смыслу. ' +
  'Ответ — только JSON {"a": [номер варианта, ...]} в порядке слов, без пояснений.'

export function stressPrompt(a: Accented): string {
  const lines = [`Фраза: «${unstress(a.text)}»`]
  a.open.forEach((o, i) => {
    const h = HOMOGRAPHS[o.key]
    lines.push(`${i + 1}) «${o.word}»: ${h.g.map((g, j) => `${j + 1} — ${g}`).join('; ')}`)
  })
  return lines.join('\n')
}

export type AskJson = (system: string, user: string, ms: number) => Promise<unknown>

/**
 * Омографы, которые правила не решили, — вопрос быстрой модели (YandexGPT Lite отвечает за ~0,25 с).
 * Не ответила за ms или ответила не по формату — вариант по умолчанию.
 */
export async function resolveStress(a: Accented, ask?: AskJson, ms = 450): Promise<string> {
  if (!a.open.length || !ask) return settle(a)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const late = new Promise((_, no) => (timer = setTimeout(() => no(new Error('timeout')), ms)))
    const r = (await Promise.race([ask(STRESS_SYSTEM, stressPrompt(a), ms), late])) as { a?: unknown }
    const nums = Array.isArray(r?.a) ? r.a.map(Number) : []
    return settle(a, (o) => {
      const n = nums[a.open.indexOf(o)]
      return Number.isInteger(n) && n >= 1 && n <= HOMOGRAPHS[o.key].v.length ? n - 1 : undefined
    })
  } catch {
    return settle(a)
  } finally {
    clearTimeout(timer)
  }
}

// ---------- как ударение понимает каждый движок ----------

export type StressEngine = 'speechkit' | 'openai' | 'eleven' | 'gemini'

/**
 * Текст с «+» → текст для движка (проверено синтезом, судья gemini-3.8-flash, ~/Arena-materials/final/stress/listen.html):
 * - SpeechKit (livetts и v3) — «+» перед ударной гласной, его TTS-разметка: слушается, вслух не читает;
 * - ElevenLabs v4 Turbo — U+0301 после гласной: 97% верных ударений против 77% без разметки; «+» читает вслух («мук плюс а»);
 *   словарь произношения (alias) срабатывает частично, IPA коверкает слова, а воркер словари и не передаёт;
 * - OpenAI gpt-4o-mini-tts — не слушается ни U+0301, ни заглавной буквы, ни подсказки в instructions (80% с ними и без) —
 *   разметку не шлём; Gemini — тоже без разметки.
 */
export function render(text: string, engine: StressEngine): string {
  if (engine === 'speechkit') return forSpeechKit(text)
  // «ё» ударна сама: знак над ней не нужен
  text = text.replace(/\+(?=[ёЁ])/g, '')
  if (engine === 'eleven') return text.replace(new RegExp(`\\+([${VOWEL}])`, 'gu'), `$1${ACUTE}`)
  return unstress(text)
}
