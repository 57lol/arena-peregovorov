// Что звучит на каком экране. Экран → музыка и фон комнаты; катсцена → свой разбор по времени; встреча → штамп и бумаги.

import { useEffect, useRef } from 'react'
import type { Scenario } from '../../engine/types'
import { sceneFor } from '../cast'
import { cutsceneById } from '../cutscene/scripts'
import { locate, phoneAt, total, travelled } from '../cutscene/timeline'
import type { Cutscene } from '../cutscene/types'
import { playAmbient, playMusic, sfx, type AmbId, type MusicId } from './engine'

/** Фон комнаты по месту встречи. */
export function ambFor(kind: string): AmbId | null {
  if (kind === 'office' || kind === 'inei') return 'office'
  if (kind === 'factory' || kind === 'bytovka') return 'factory'
  if (kind === 'shop' || kind === 'street' || kind === 'dorm') return kind
  return null
}

/** Музыка и фон экрана: титул — своя тема, встреча — без музыки, только комната; остальное — тема карты. */
export function sceneSound(screen: string, kind?: string | null): { music: MusicId | null; amb: AmbId | null } {
  if (screen === 'title') return { music: 'menu', amb: null }
  if (screen === 'cutscene') return { music: 'cutscene', amb: null }
  if (screen === 'play') return { music: null, amb: kind ? ambFor(kind) : null }
  return { music: 'map', amb: null }
}

/** App: один вызов на всю игру. В катсцене дальше звуком правит её время. */
export function useSoundScene(screen: string, scenario?: Scenario | null, filmId?: string | null) {
  const kind = scenario ? sceneFor(scenario) : null
  useEffect(() => {
    const s = sceneSound(screen, kind)
    playMusic(s.music)
    playAmbient(s.amb)
  }, [screen, kind])
  const script = screen === 'cutscene' && filmId ? cutsceneById(filmId) : undefined
  useEffect(() => {
    if (!script) return
    return followCutscene(script)
  }, [script])
}

// ---------- катсцена ----------

/** Шаг — каждые полцикла ходьбы: 32 точки на восемь кадров, две ноги. */
const STRIDE = 16

export interface CutsceneCue {
  amb: AmbId | null
  steps: number
  page: boolean
}

/**
 * Что слышно между T0 и T1: фон плана (автобус едет — мотор, улица — город), шаги по пройденному пути,
 * новая карточка на телефоне — шорох страницы. Прыжок (клик «дальше», пропуск) — без шагов и страниц.
 */
export function cutsceneCue(cs: Cutscene, T0: number, T1: number): CutsceneCue {
  const { i, t } = locate(cs, T1)
  const shot = cs.shots[i]
  const bus = shot.set === 'bus' || (shot.set !== 'map' && shot.set !== 'black' && (shot.drive ?? 0) > 0) || (shot.actors ?? []).some((a) => a.who === 'bus' && travelled(a.x, t).moving)
  const amb: AmbId | null = bus ? 'bus' : shot.set === 'street' || shot.set === 'oez' ? 'street' : null
  const prev = locate(cs, T0)
  const dt = T1 - T0
  if (prev.i !== i || dt <= 0 || dt > 0.25) return { amb, steps: 0, page: false }
  let steps = 0
  for (const a of shot.actors ?? []) {
    if (a.who === 'bus') continue
    steps += Math.floor(travelled(a.x, t).dist / STRIDE) - Math.floor(travelled(a.x, prev.t).dist / STRIDE)
  }
  const page = (phoneAt(shot, t)?.index ?? -1) !== (phoneAt(shot, prev.t)?.index ?? -1)
  return { amb, steps, page }
}

/**
 * Время катсцены читаем с полоски прогресса (.cs-bar b, scaleX = T / длина) — движок катсцен не трогаем.
 * Нет полоски — звучит только музыка.
 */
function followCutscene(cs: Cutscene): () => void {
  const len = total(cs)
  let raf = 0
  let T0 = -1
  const tick = () => {
    raf = requestAnimationFrame(tick)
    const b = document.querySelector<HTMLElement>('.cs-bar b')
    const m = b && /scaleX\(([\d.e-]+)\)/.exec(b.style.transform)
    if (!m) return
    const T = Number(m[1]) * len
    if (T0 < 0) T0 = T
    const cue = cutsceneCue(cs, T0, T)
    playAmbient(cue.amb)
    for (let k = 0; k < Math.min(cue.steps, 2); k++) sfx('step', { gain: 0.55 })
    if (cue.page) sfx('page', { gain: 0.7 })
    T0 = T
  }
  raf = requestAnimationFrame(tick)
  return () => {
    cancelAnimationFrame(raf)
    playAmbient(null)
  }
}

// ---------- встреча ----------

/**
 * Штамп «По рукам» (и другие концовки) и новое предложение собеседника на столе.
 * Первый рендер молчит: перезагрузка посреди встречи не должна хлопать штампом.
 */
export function useMeetingSounds(stamp: string | null, offerKey: string) {
  const seen = useRef<{ stamp: string | null; offer: string } | null>(null)
  useEffect(() => {
    const was = seen.current
    seen.current = { stamp, offer: offerKey }
    if (!was) return
    if (stamp && stamp !== was.stamp) sfx('stamp')
    else if (offerKey && offerKey !== was.offer) sfx('paper')
  }, [stamp, offerKey])
}
