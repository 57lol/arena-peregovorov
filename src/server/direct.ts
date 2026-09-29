// «Режиссёр речи»: реплику собеседника перед синтезом размечаем TTS-разметкой SpeechKit, чтобы она звучала
// как живая: паузы после вступительных слов и перед «но/а/зато», чуть длиннее на точках, раздумье на многоточии,
// значки и сокращения — словами. Разметка: https://aistudio.yandex.ru/docs/ru/speechkit/tts/markup/tts-markup
// (sil<[мс]> — пауза, <[small]> — пауза по контексту, **слово** — акцент). 29.09 проверено: v3 general и livetts
// разметку понимают и вслух не читают. Показ реплики на экране это не трогает — размечаем только текст для голоса.
// Включается флагом: NATURAL_SPEECH=on|live на сервере или «естественная речь» в лаборатории (/?lab).

import type { Emotion } from '../engine/types'
import { YANDEX_VOICES } from '../content/voices'
import { stress } from './stress'

export const DIRECT_VERSION = 1

/** Темп пауз по эмоции: задумался — дольше, раздражён — короче и твёрже. */
const PACE: Record<Emotion, number> = { neutral: 1, pleased: 1, happy: 0.9, thinking: 1.5, annoyed: 0.7, angry: 0.5 }

const plural = (n: string, one: string, few: string, many: string) => {
  if (/[,.]/.test(n)) return few // 1,5 рубля, 2,5 процента
  const d = Number(n.replace(/\D/g, '')) % 100
  if (d >= 11 && d <= 14) return many
  return d % 10 === 1 ? one : d % 10 >= 2 && d % 10 <= 4 ? few : many
}

/** Значки и сокращения — словами, в роде и числе по последнему числу: «204 ₽» → «204 рубля». */
export function spellOut(t: string): string {
  return (
    t
      // 80 000 → 80000: пробел внутри числа синтезатор может прочитать паузой
      .replace(/(\d)[\s  ](?=\d{3}(?!\d))/g, '$1')
      .replace(/(?<![\d,])1,5\s*млн\.?/g, 'полтора миллиона')
      .replace(/(\d+),(\d{1,2})\s*млн\.?/g, (_, a: string, b: string) => `${a} ${plural(a, 'миллион', 'миллиона', 'миллионов')} ${Number(b.padEnd(3, '0'))} тысяч`)
      .replace(/(\d+)\s*млн\.?(?!\p{L})/gu, (_, a: string) => `${a} ${plural(a, 'миллион', 'миллиона', 'миллионов')}`)
      .replace(/(\d+)\s*млрд\.?(?!\p{L})/gu, (_, a: string) => `${a} ${plural(a, 'миллиард', 'миллиарда', 'миллиардов')}`)
      .replace(/(\d+)\s*тыс\.?(?!\p{L})/gu, (_, a: string) => `${a} ${plural(a, 'тысяча', 'тысячи', 'тысяч')}`)
      .replace(/(полтора миллиона|миллион\p{L}*|миллиард\p{L}*|тысяч\p{L}*)\s*(₽|руб\.?(?!\p{L}))/gu, '$1 рублей')
      .replace(/(\d+(?:,\d+)?)\s*(₽|руб\.?(?!\p{L}))/gu, (_, a: string) => `${a} ${plural(a, 'рубль', 'рубля', 'рублей')}`)
      .replace(/(\d+(?:,\d+)?)\s*%/g, (_, a: string) => `${a} ${plural(a, 'процент', 'процента', 'процентов')}`)
      .replace(/\+(?=\s*\d)/g, 'плюс ')
  )
}

/** Слова, с которых человек начинает фразу и после которых делает вдох. */
const OPENERS =
  'ну смотрите|ну смотри|ну что ж|ну ладно|ну хорошо|ну давайте|честно говоря|по-честному|в общем|знаете что|так вот|смотрите|смотри|слушайте|слушай|послушайте|знаете|знаешь|понимаете|понимаешь|короче|значит|ладно|хорошо|честно|так|ну|хм|эх|ох|да|нет|окей|вот'
const OPENER = new RegExp(`(^|[.!?…]\\s+)(${OPENERS})(,|:|\\s—)\\s+`, 'giu')

/** Размеченный для синтеза текст. Разметку из самой реплики (звёздочки, плюсы) сначала убираем — она не наша. */
export function direct(text: string, emotion: Emotion = 'neutral'): string {
  const k = PACE[emotion] ?? 1
  const ms = (base: number) => `sil<[${Math.round((base * k) / 10) * 10}]>`
  let t = spellOut(
    text
      .replace(/…/g, '...')
      .replace(/sil<\[\d*\]>|<\[\w*\]>|\[\[[^\]]*\]\]|\[\[|\]\]/g, ' ')
      .replace(/[*]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  ).replace(/\+/g, '')

  // вступительное слово: «Ну, …», «Смотрите: …», «Хорошо — …» — короткий вдох
  t = t.replace(OPENER, (_, pre: string, w: string, p: string) => `${pre}${w}${p.trim() === '—' ? ' —' : p} ${ms(p === ':' ? 260 : 180)} `)
  // раздумье: «Так... ну, допустим» — пауза подольше
  t = t.replace(/\.\.\.(?:\s+|$)/g, (m) => (m.trim() === m ? m : `... ${ms(380)} `))
  // перед противопоставлением — пауза по контексту, как делает человек
  t = t.replace(/,\s+(но|а вот|а|зато|однако|хотя|только вот)\s/giu, ', <[small]> $1 ')
  // «а вот цена — нет»: слово после «а вот» — с акцентом
  t = t.replace(/(а вот) (\p{L}{4,})(?=[\s,.!?—])/giu, '$1 **$2**')
  // двоеточие внутри фразы — «сейчас скажу главное»
  t = t.replace(/:\s+(?!sil)/g, ': <[small]> ')
  // тире между пунктом и значением — чуть заметнее
  t = t.replace(/\s—\s+(?!sil)/g, ' — <[tiny]> ')
  // конец предложения: немного дольше, чем делает синтезатор сам
  // (модель бывает пишет «Нет. снижение…» со строчной — это тоже новая фраза; «т. е.» и «г.» — нет)
  t = t.replace(/(?<!(?:^|\s)\p{Ll}{1,2})([.!?])\s+(?=[\p{L}\d])/gu, (_, p: string) => `${p} ${ms(220)} `)

  // две паузы подряд — оставляем одну, самую длинную; в начале и в конце паузы не нужны
  t = t.replace(/(?:(?:sil<\[\d+\]>|<\[\w+\]>)\s*){2,}/g, (m) => {
    const sils = [...m.matchAll(/sil<\[(\d+)\]>/g)].map((x) => Number(x[1]))
    return sils.length ? `sil<[${Math.max(...sils)}]> ` : `${m.trim().split(/\s+/)[0]} `
  })
  return t
    .replace(/^(\s*(sil<\[\d+\]>|<\[\w+\]>)\s*)+/, '')
    .replace(/(\s*(sil<\[\d+\]>|<\[\w+\]>)\s*)+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Голос livetts вместо обычного — для NATURAL_SPEECH=live и лаборатории. У livetts только шесть голосов,
 * поэтому пары подобраны по полу и возрасту на слух по тону (VOICES.md); повторы неизбежны.
 */
export const LIVE_OF: Record<string, string> = {
  alexander: 'denis',
  filipp: 'denis',
  zahar: 'sergey',
  kirill: 'sergey',
  anton: 'vasily',
  ermil: 'vasily',
  madirus: 'vasily',
  dasha: 'sofia',
  lera: 'sofia',
  alena: 'vera',
  masha: 'vera',
  marina: 'vera',
  julia: 'irina',
  jane: 'irina',
  omazh: 'irina',
}

export const isLive = (voice: string) => YANDEX_VOICES.find((v) => v.id === voice)?.model === 'livetts'

export function liveVoiceFor(voice: string): string {
  if (isLive(voice)) return voice
  return LIVE_OF[voice] ?? (YANDEX_VOICES.find((v) => v.id === voice)?.female ? 'sofia' : 'denis')
}

/** Амплуа livetts под эмоцию: по делу — «casual» (разговорно), раздражён — «formal» (суше), где голос это умеет. */
export function liveRole(voice: string, emotion: Emotion | undefined): string | undefined {
  const roles = YANDEX_VOICES.find((v) => v.id === voice)?.roles ?? []
  const hard = emotion === 'annoyed' || emotion === 'angry'
  const want = hard ? ['formal', 'neutral', 'support'] : ['casual', 'support', 'neutral']
  return want.find((r) => roles.includes(r))
}

/**
 * «Живые голоса + аккуратная разметка» (NATURAL_SPEECH=voices+): ударения по словарю (stress.ts) и от модели,
 * паузы только там, где livetts их сам не делает. Замеры 29.09 (denis, sofia): на точке livetts молчит ~250 мс,
 * на многоточии ~340, на запятой — почти ноль; <[tiny]> добавляет ~250 мс, <[small]> ~400, а sil<[N]> у livetts
 * рвёт фразу и даёт 0,7–1 с при любом N — его здесь нет совсем.
 */
export const POLISH_VERSION = 1

export function polish(text: string, emotion: Emotion = 'neutral'): string {
  const hurry = emotion === 'annoyed' || emotion === 'angry'
  let t = stress(
    spellOut(
      text
        .replace(/…/g, '...')
        .replace(/sil<\[\d*\]>|<\[\w*\]>|\[\[[^\]]*\]\]|\[\[|\]\]|\*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    ),
  )
  // противопоставление и условие после запятой — короткий вдох (livetts запятую почти не слышит)
  t = t.replace(/,\s+(но|а|зато|однако|хотя|если|потому что)(?=\s)/giu, ', <[tiny]> $1')
  // раздумье: многоточие посреди реплики
  t = t.replace(/\.\.\.\s+(?=[\p{L}\d])/gu, '... <[tiny]> ')
  // между предложениями — чуть дольше, чем livetts делает сам; раздражённый говорит без передышек
  if (!hurry) t = t.replace(/(?<!(?:^|\s)\p{Ll}{1,2}|\.\.)\.\s+(?=[\p{Lu}\d])/gu, '. <[tiny]> ')
  return t.replace(/\s+/g, ' ').trim()
}

/**
 * Ударения от модели (омографы по смыслу): на экран реплика идёт без «+», а синтезу нужна с «+».
 * /api/turn запоминает пару «чистая → с ударениями», /api/tts её находит — клиент ничего не знает о разметке.
 */
const spoken = new Map<string, string>()
export function rememberSpoken(clean: string, marked: string) {
  if (clean === marked) return
  spoken.delete(clean)
  spoken.set(clean, marked)
  if (spoken.size > 2000) spoken.delete(spoken.keys().next().value!)
}
export const spokenOf = (clean: string) => spoken.get(clean) ?? clean

export type NaturalMode = 'off' | 'on' | 'live' | 'voices' | 'voices+'
/**
 * Общий флаг сервера: off — как было; on — разметка и промпт «для голоса»; live — ещё и голоса livetts;
 * voices — только голоса livetts, без режиссёра речи и промпта «для голоса» (так понравилось капитану);
 * voices+ — голоса livetts и аккуратная разметка polish(): ударения и редкие паузы по смыслу.
 */
export const naturalMode = (env = process.env): NaturalMode => {
  const m = env.NATURAL_SPEECH
  return m === 'live' || m === 'voices' || m === 'voices+' || m === 'on' ? m : 'off'
}
/** Голоса livetts вместо голосов лиц. */
export const liveMode = (m: NaturalMode) => m === 'live' || m === 'voices' || m === 'voices+'
