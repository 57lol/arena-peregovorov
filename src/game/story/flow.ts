// Два режима игры. «Сюжет» — неделя новенького по порядку: пролог в автобусе, глава, разбор, катсцена-переход,
// следующая глава. «Для жюри» — хаб, где открыто всё сразу и катсцен нет (экран story/Jury.tsx).
// Здесь — чистые решения «что показать дальше»; App.tsx только исполняет их.

import { chapterOf, CHAPTERS } from '../../content/story'
import { BRIDGES, PROLOGUE } from '../cutscene/scripts'
import type { Cutscene } from '../cutscene/types'
import type { Progress } from '../progress'

export type Next = { to: 'brief'; caseId: string } | { to: 'map' }

export interface Step {
  /** катсцена перед следующим экраном */
  cutscene?: Cutscene
  then: Next
}

const played = (p: Progress, id: string) => !!(p.cases[id] || p.cases[`${id}-hard`])

/** Первая несыгранная глава по порядку недели. */
export const nextChapter = (p: Progress) => CHAPTERS.find((c) => !played(p, c.id))?.id

/** «Сюжет» с титула: в первый раз — пролог и сразу бриф ближайшей главы, потом — карта недели. */
export function storyStart(p: Progress, seen: string[]): Step {
  if (seen.includes(PROLOGUE.id)) return { then: { to: 'map' } }
  const id = nextChapter(p)
  return { cutscene: PROLOGUE, then: id ? { to: 'brief', caseId: id } : { to: 'map' } }
}

/**
 * После разбора главы в «Сюжете»: переход к следующей главе, если его ещё не видели, и её бриф (если она не сыграна).
 * Переход уже видели или дело не из кампании — на карту.
 */
export function storyAfter(caseId: string, p: Progress, seen: string[]): Step {
  const ch = chapterOf(caseId)
  const cs = ch && BRIDGES[ch.id]
  if (!ch || !cs || seen.includes(cs.id)) return { then: { to: 'map' } }
  const i = CHAPTERS.findIndex((c) => c.id === ch.id)
  const nx = CHAPTERS[i + 1]
  return { cutscene: cs, then: nx && !played(p, nx.id) ? { to: 'brief', caseId: nx.id } : { to: 'map' } }
}

// ——— какие катсцены уже видели: пролог и переходы показываем по одному разу ———

const KEY = 'peregovorka.cutscenes.v1'

export function seenCutscenes(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function markCutsceneSeen(id: string) {
  try {
    const seen = seenCutscenes()
    if (!seen.includes(id)) localStorage.setItem(KEY, JSON.stringify([...seen, id]))
  } catch {
    // нет хранилища — катсцена покажется ещё раз, не страшно
  }
}

// ——— адрес: /?jury — сразу хаб жюри; /?cutscene=prologue&t=12 — катсцена (с t — стоп-кадр для снимков) ———

export const juryLink = () => /[?&]jury\b/.test(globalThis.location?.search ?? '')

export function cutsceneLink(): { id: string; at?: number } | null {
  const q = new URLSearchParams(globalThis.location?.search ?? '')
  const id = q.get('cutscene')
  if (!id) return null
  const t = q.get('t')
  return { id, at: t !== null && t !== '' && Number.isFinite(Number(t)) ? Number(t) : undefined }
}
