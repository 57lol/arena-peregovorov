// Два режима игры. «Сюжет» — неделя новенького по порядку: пролог в автобусе, глава, разбор, катсцена-переход,
// следующая глава. «Для жюри» — хаб, где открыто всё сразу и катсцен нет (экран story/Jury.tsx).
// Здесь — чистые решения «что показать дальше»; App.tsx только исполняет их.

import { chapterOf, CHAPTERS } from '../../content/story'
import { BRIDGES, CUTSCENES, PROLOGUE } from '../cutscene/scripts'
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

const brief = (caseId: string): Next => ({ to: 'brief', caseId })

/**
 * «Сюжет» с титула или из хаба — строго по порядку недели, через катсцены, без карты в начале:
 * новый игрок (пролог не видел или ни одной главы не сыграл) — пролог и сразу бриф первой главы.
 * Пролог кончается титром «Глава 1 · Общага», поэтому после него всегда общага, даже если её уже играли из хаба.
 * Дальше — переход к первой несыгранной главе и её бриф. Неделя пройдена — карта.
 * Раньше «видели пролог» вело на карту: в инкогнито после первого же захода «Сюжет» больше не показывал катсцен.
 */
export function storyStart(p: Progress, seen: string[]): Step {
  const nx = nextChapter(p)
  const i = nx ? CHAPTERS.findIndex((c) => c.id === nx) : -1
  if (!seen.includes(PROLOGUE.id) || i === 0) return { cutscene: PROLOGUE, then: brief(CHAPTERS[0].id) }
  if (i < 0) return { then: { to: 'map' } }
  const cs = BRIDGES[CHAPTERS[i - 1].id]
  return cs ? { cutscene: cs, then: brief(nx!) } : { then: brief(nx!) }
}

/**
 * «Дальше» после разбора главы в «Сюжете»: переход к следующей главе (всегда — это явный шаг игрока) и её бриф.
 * Последняя глава — финал недели и карта. Дело не из кампании — на карту.
 */
export function storyAfter(caseId: string): Step {
  const ch = chapterOf(caseId)
  if (!ch) return { then: { to: 'map' } }
  const i = CHAPTERS.findIndex((c) => c.id === ch.id)
  const nx = CHAPTERS[i + 1]
  const then: Next = nx ? brief(nx.id) : { to: 'map' }
  const cs = BRIDGES[ch.id]
  return cs ? { cutscene: cs, then } : { then }
}

/**
 * Вход в главу с карты «Сюжета»: если переход к ней (для первой главы — пролог) ещё не видели, сначала он, потом бриф.
 * Не глава кампании или переход уже смотрели — null, бриф открывается сразу.
 */
export function storyEnter(caseId: string, seen: string[]): Cutscene | null {
  const ch = chapterOf(caseId)
  const i = ch ? CHAPTERS.findIndex((c) => c.id === ch.id) : -1
  if (i < 0) return null
  const cs = i === 0 ? PROLOGUE : BRIDGES[CHAPTERS[i - 1].id]
  return cs && !seen.includes(cs.id) ? cs : null
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
 * Прогоны из scripts/ (Playwright, navigator.webdriver) идут без катсцен, как и без обучения: «Сюжет» сразу ведёт
 * на карту, «Дальше» — тоже. Проверить сами катсцены в прогоне — ?cutscenes=1 в адресе.
 */
export const cutscenesAllowed = () => typeof navigator === 'undefined' || !navigator.webdriver || forced
const forced = /[?&]cutscenes=1\b/.test(globalThis.location?.search ?? '')

/** Что считать уже виденным для решений «Сюжета». */
export const seenForStory = () => (cutscenesAllowed() ? seenCutscenes() : CUTSCENES.map((c) => c.id))

// ——— адрес: /?jury — сразу хаб жюри; /?cutscene=prologue&t=12 — катсцена (с t — стоп-кадр для снимков) ———

export const juryLink = () => /[?&]jury\b/.test(globalThis.location?.search ?? '')

export function cutsceneLink(): { id: string; at?: number } | null {
  const q = new URLSearchParams(globalThis.location?.search ?? '')
  const id = q.get('cutscene')
  if (!id) return null
  const t = q.get('t')
  return { id, at: t !== null && t !== '' && Number.isFinite(Number(t)) ? Number(t) : undefined }
}
