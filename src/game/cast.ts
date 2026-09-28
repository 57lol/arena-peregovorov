// Кто сидит напротив и где: портрет и сцена для любого сценария, в том числе сгенерированного.

import { looksFemale, pickFace } from '../content/faces'
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

export function sceneFor(sc: Scenario): SceneId {
  if (sc.id === 'tara') return 'factory'
  if (sc.id === 'offer') return 'office'
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

/** «Марат» из «Марат Гимадиев» — для коротких подписей. */
export const firstName = (sc: Scenario) => sc.opponent.character.name.split(/\s+/)[0]

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
