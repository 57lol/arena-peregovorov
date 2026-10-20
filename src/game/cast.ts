// Кто сидит напротив и где: портрет и сцена для любого сценария, в том числе сгенерированного.

import { looksFemale, pickFace } from '../content/faces'
import { chapterOf } from '../content/story'
import { baseCaseId } from '../content/scenarios/harder'
import { tierOf } from '../engine/policy'
import type { Scenario } from '../engine/types'
import { PORTRAITS, type PortraitId, type SceneId } from './ui'

export function portraitFor(sc: Scenario): PortraitId {
  const c = sc.opponent.character
  const own = sc.id.startsWith('gen-')
  // Марат и Дарина — лица дел из папки. Старые свои дела ссылались на них по полу — подбираем им лицо из пула.
  if (c.portrait in PORTRAITS && !(own && (c.portrait === 'rinat' || c.portrait === 'olga'))) return c.portrait as PortraitId
  const female = c.portrait === 'olga' || (c.portrait !== 'rinat' && looksFemale(c.name))
  return pickFace({ id: sc.id, female, text: `${sc.sphere} ${sc.title} ${c.role} ${c.company}` })
}

/** Дела, где собеседник не за столом, а на видеосвязи: большой экран в переговорной «Кама», голос — «через связь». */
const VIDEO_CALLS = new Set(['china'])
export const isVideoCall = (sc: Scenario) => VIDEO_CALLS.has(baseCaseId(sc.id))

/** Деловые места для своих дел. Переговорная «Кама» не входит: она устроена под видеозвонок. */
export const BUSINESS_SCENES = ['office', 'factory', 'inei', 'bytovka', 'istanbul', 'lagos'] as const satisfies readonly SceneId[]
export type BusinessScene = (typeof BUSINESS_SCENES)[number]

/** Что в описании дела зовёт в это место. Стамбул и Лагос — только когда дело про них. */
const PLACE_FITS: Record<BusinessScene, { fits: RegExp; base: number }> = {
  office: { fits: /аренд|недвиж|офис|найм|ваканс|оффер|кадр|персонал|продаж|клиент|(^|[^\p{L}])it|айти|юрист|юридич|банк|кредит|инвест|маркетинг|консалт|услуг|страх|лиценз/iu, base: 1 },
  factory: { fits: /закуп|постав|производ|завод|цех|тар[аы]|упаков|сырь|склад|логист|опт|гофр/i, base: 1 },
  inei: { fits: /закуп|снабжен|тендер|постав|контракт|комплектующ|оборудован|станк|линии|холодильн/i, base: 1 },
  bytovka: { fits: /подряд|монтаж|ремонт|строит|стройк|бригад|смен[аеуы]|рабоч|наладк|пусконалад|обслуживан|сварк/i, base: 0.5 },
  istanbul: { fits: /турц|стамбул|turk|istanbul/i, base: 0 },
  lagos: { fits: /африк|нигер|лагос|lagos|africa/i, base: 0 },
}

/**
 * Место для своего дела: подходящее по описанию весит в восемь раз больше, но и остальные деловые места выпадают —
 * иначе все дела про закупки шли бы в одном кабинете. Детерминированно: то же дело — то же место.
 */
export function pickPlace(sc: Scenario): BusinessScene {
  const c = sc.opponent.character
  const text = `${sc.sphere} ${sc.title} ${c.role} ${c.company} ${sc.player.role}`
  const weights = BUSINESS_SCENES.map((k) => (PLACE_FITS[k].fits.test(text) ? 8 : PLACE_FITS[k].base))
  // другие биты хэша, чем у лица (faces.ts): место и лицо выпадают независимо
  const u = parseInt(sc.id.replace(/[^0-9a-f]/gi, '').slice(-16, -8) || '0', 16) / 2 ** 32
  let n = u * weights.reduce((s, w) => s + w, 0)
  for (let i = 0; i < BUSINESS_SCENES.length; i++) {
    n -= weights[i]
    if (n < 0) return BUSINESS_SCENES[i]
  }
  return 'office'
}

export function sceneFor(sc: Scenario): SceneId {
  const id = baseCaseId(sc.id)
  if (VIDEO_CALLS.has(id)) return 'meet'
  const story = chapterOf(id)?.room
  if (story && story !== 'factory' && story !== 'office') return story
  if (id === 'tara') return 'factory'
  if (id === 'lagos') return 'lagos'
  if (id === 'istanbul') return 'istanbul'
  if (id === 'offer') return 'office'
  // своё дело: место, выбранное руководителем, иначе подбор по описанию
  if ((BUSINESS_SCENES as readonly string[]).includes(sc.scene ?? '')) return sc.scene as BusinessScene
  if (id.startsWith('gen-')) return pickPlace(sc)
  return /закуп|постав|производ|завод|цех|подряд|логист|склад|стро/i.test(`${sc.sphere} ${sc.title}`) ? 'factory' : 'office'
}

export const TONE_RU: Record<Scenario['opponent']['character']['tone'], string> = {
  friendly: 'дружелюбный',
  neutral: 'спокойный',
  cold: 'холодный',
  aggressive: 'напористый',
  evasive: 'уклончивый',
}

export const DIFFICULTY_RU = { 1: 'идёт навстречу', 2: 'торгуется', 3: 'стоит до последнего' } as const

/** Характер с учётом режима «жёстче»: у дела сложности 3 — ступень, которой нет в конструкторе. */
export function difficultyRu(sc: Scenario): string {
  const t = tierOf(sc)
  return t === 4 ? 'стоит насмерть' : DIFFICULTY_RU[t]
}

/** «Марат» из «Марат Гимадиев» — для коротких подписей. */
export const firstName = (sc: Scenario) => sc.opponent.character.short ?? sc.opponent.character.name.split(/\s+/)[0]

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = Math.abs(n) % 10
  const m100 = Math.abs(n) % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export const pts = (n: number) => `${n} ${plural(n, 'очко', 'очка', 'очков')}`

/** Род собеседника для глаголов: «встал» / «встала». */
export const isFemale = (sc: Scenario) => PORTRAITS[portraitFor(sc)].female
export const g = (sc: Scenario, m: string, f: string) => (isFemale(sc) ? f : m)

/** Часы встречи: с какой минуты суток начинается и сколько идёт. Главы кампании — в своё время (остановка — 7:35 и до автобуса). */
export function meetingClock(sc: Scenario): { start: number; minutes: number } {
  if (baseCaseId(sc.id) === 'lagos') return { start: 17 * 60, minutes: 60 }
  const ch = chapterOf(baseCaseId(sc.id))
  const m = ch?.time.match(/^(\d{1,2}):(\d{2})$/)
  return m ? { start: Number(m[1]) * 60 + Number(m[2]), minutes: ch?.minutes ?? 60 } : { start: 10 * 60, minutes: 60 }
}
