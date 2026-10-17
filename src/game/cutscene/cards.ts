// Подписи и кадры-превью карточек галереи катсцен.

import { BRIDGES } from './scripts'
import type { Cutscene, Shot } from './types'
import { CHAPTERS } from '../../content/story'

/** Кадр для превью: первый «живой» план (не титр, не карта и не телефон крупно), чуть дальше середины — там уже кто-то в кадре. */
export function posterOf(cs: Cutscene): { shot: Shot; t: number } {
  const shot = cs.shots.find((s) => s.set !== 'black' && s.set !== 'map' && s.set !== 'phone') ?? cs.shots[0]
  return { shot, t: Math.min(shot.dur * 0.6, shot.dur - 0.05) }
}

/** Где катсцена в неделе: «Пролог», «После главы 2», «Финал». */
function placeOf(cs: Cutscene): string {
  if (cs.id === 'prologue') return 'Пролог'
  const after = Object.keys(BRIDGES).find((k) => BRIDGES[k].id === cs.id)
  const i = CHAPTERS.findIndex((c) => c.id === after)
  if (i < 0) return ''
  return CHAPTERS[i].kind === 'finale' ? 'Финал недели' : `После главы ${i + 1}`
}

/** Подпись карточки: «После главы 1 · Понедельник» и «На остановку» из «Понедельник: на остановку». */
export function nameOf(cs: Cutscene): { place: string; title: string } {
  const [head, ...rest] = cs.title.split(':')
  const tail = rest.join(':').trim()
  const place = placeOf(cs)
  if (!tail) return { place, title: cs.title }
  return {
    place: place.toLowerCase().includes(head.trim().toLowerCase()) ? place : `${place} · ${head.trim()}`,
    title: tail.charAt(0).toUpperCase() + tail.slice(1),
  }
}
