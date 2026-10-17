// Два режима игры. «Сюжет» — неделя новенького строго по порядку: пролог в автобусе, глава, разбор, «Дальше» —
// катсцена-переход и следующая глава. Карты в «Сюжете» нет: перескочить через главу нельзя.
// «Для жюри» — хаб, где открыто всё сразу, катсцен нет, там же карта недели (экран story/Jury.tsx).
// Здесь — чистые решения «что показать дальше»; App.tsx только исполняет их.

import { chapterOf, CHAPTERS } from '../../content/story'
import { BRIDGES, PROLOGUE } from '../cutscene/scripts'
import type { Cutscene } from '../cutscene/types'
import type { Progress } from '../progress'

export type Next = { to: 'brief'; caseId: string } | { to: 'title' } | { to: 'map' }

export interface Step {
  /** катсцена перед следующим экраном */
  cutscene?: Cutscene
  then: Next
}

const played = (p: Progress, id: string) => !!(p.cases[id] || p.cases[`${id}-hard`])

/** Позиция текущей недели; у старого прогресса — первая несыгранная глава. */
export const nextChapter = (p: Progress) => p.story?.chapter !== undefined
  ? CHAPTERS[p.story.chapter]?.id
  : CHAPTERS.find((c) => !played(p, c.id))?.id

const brief = (caseId: string): Next => ({ to: 'brief', caseId })

/**
 * «Сюжет» с титула или из хаба — строго по порядку недели, через катсцены:
 * новый игрок (пролог не видел или ни одной главы не сыграл) — пролог и сразу бриф первой главы.
 * Пролог кончается титром «Глава 1 · Общага», поэтому после него всегда общага, даже если её уже играли из хаба.
 * Дальше — переход к первой несыгранной главе и её бриф. Неделя пройдена — неделя заново, с пролога.
 */
export function storyStart(p: Progress, seen: string[]): Step {
  const nx = nextChapter(p)
  const i = nx ? CHAPTERS.findIndex((c) => c.id === nx) : -1
  if (!seen.includes(PROLOGUE.id) || i <= 0) return { cutscene: PROLOGUE, then: brief(CHAPTERS[0].id) }
  const cs = BRIDGES[CHAPTERS[i - 1].id]
  return cs ? { cutscene: cs, then: brief(nx!) } : { then: brief(nx!) }
}

/**
 * «Дальше» после разбора главы в «Сюжете»: переход к следующей главе (всегда — это явный шаг игрока) и её бриф.
 * Между любыми главами — катсцена, в том числе от бытовых дел к рабочим. Последняя глава — финал недели и титул.
 * Дело не из кампании — на титул.
 */
export function storyAfter(caseId: string): Step {
  const ch = chapterOf(caseId)
  if (!ch) return { then: { to: 'title' } }
  const i = CHAPTERS.findIndex((c) => c.id === ch.id)
  const nx = CHAPTERS[i + 1]
  const then: Next = nx ? brief(nx.id) : { to: 'title' }
  const cs = BRIDGES[ch.id]
  return cs ? { cutscene: cs, then } : { then }
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

/**
 * Прогоны из scripts/ (Playwright, navigator.webdriver) идут без катсцен, как и без обучения: «Сюжет» ведёт на карту
 * недели, как у жюри. Проверить сами катсцены в прогоне — ?cutscenes=1 в адресе.
 */
export const cutscenesAllowed = () => typeof navigator === 'undefined' || !navigator.webdriver || forced
const forced = /[?&]cutscenes=1\b/.test(globalThis.location?.search ?? '')

// ——— адрес: /?jury — сразу хаб жюри; /?cutscene=prologue&t=12 — катсцена (с t — стоп-кадр для снимков) ———

export const juryLink = () => /[?&]jury\b/.test(globalThis.location?.search ?? '')

export function cutsceneLink(): { id: string; at?: number } | null {
  const q = new URLSearchParams(globalThis.location?.search ?? '')
  const id = q.get('cutscene')
  if (!id) return null
  const t = q.get('t')
  return { id, at: t !== null && t !== '' && Number.isFinite(Number(t)) ? Number(t) : undefined }
}
