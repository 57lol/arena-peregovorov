// Управление взглядом: перетаскивание мышью или пальцем, стрелки, лёгкий сдвиг за курсором.
// Стрелки не крутят голову, пока фокус в поле ввода; кнопки и бумаги на столе не начинают перетаскивание.

import { MathUtils } from 'three'
import type { World } from './stage'

const D = MathUtils.DEG2RAD
const SPIN = 95 * D
const NO_DRAG = 'button, a, input, textarea, select, label, [role="button"], [data-nodrag], .w3-ui'

export function isTyping(t: EventTarget | null) {
  const e = t as HTMLElement | null
  return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable)
}

export interface InputHooks {
  /** стрелка вниз / вверх — взгляд на стол или на собеседника */
  onPose?: (p: 'face' | 'desk') => void
  /** пользователь сам повернул голову (для подсказок «можно осмотреться») */
  onLook?: () => void
}

export function attachInput(world: World, root: HTMLElement, hooks: InputHooks = {}) {
  const h = world.head
  let drag: { id: number; x: number; y: number; moved: number } | null = null
  const fine = window.matchMedia?.('(pointer: fine)').matches ?? true

  const down = (e: PointerEvent) => {
    if (drag || (e.target as HTMLElement).closest?.(NO_DRAG)) return
    if (e.button !== 0 && e.pointerType === 'mouse') return
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 }
    root.setPointerCapture?.(e.pointerId)
    root.classList.add('is-dragging')
    // поле ввода на телефоне закрывает клавиатуру, если начали осматриваться
    if (isTyping(document.activeElement) && e.pointerType !== 'mouse') (document.activeElement as HTMLElement).blur()
  }
  const move = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      drag.x = e.clientX
      drag.y = e.clientY
      drag.moved += Math.abs(dx) + Math.abs(dy)
      // мир «прилипает» к пальцу: сдвиг на экран = поворот на угол обзора
      const k = (world.camera.fov * D) / Math.max(1, world.ch)
      h.nudge(dx * k * 1.15, dy * k * 1.15)
      if (drag.moved > 6) hooks.onLook?.()
      return
    }
    if (fine && e.pointerType === 'mouse' && !drag) {
      // голова чуть следует за курсором — комната «дышит», но кликать по кнопкам не мешает
      const nx = e.clientX / window.innerWidth - 0.5
      const ny = e.clientY / window.innerHeight - 0.5
      h.py = -nx * 4 * D
      h.pp = -ny * 2.5 * D
    }
  }
  const up = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    drag = null
    root.classList.remove('is-dragging')
  }
  const leave = () => {
    h.py = 0
    h.pp = 0
  }
  const held = new Set<string>()
  const key = (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
    const on = e.type === 'keydown'
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      if (on) held.add(e.key)
      else held.delete(e.key)
      h.spin = (held.has('ArrowLeft') ? SPIN : 0) - (held.has('ArrowRight') ? SPIN : 0)
      if (on) hooks.onLook?.()
    } else if (on && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const p = e.key === 'ArrowDown' ? 'desk' : 'face'
      world.look(p)
      hooks.onPose?.(p)
    }
  }
  const blur = () => {
    held.clear()
    h.spin = 0
  }

  root.addEventListener('pointerdown', down)
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
  root.addEventListener('pointerleave', leave)
  window.addEventListener('keydown', key)
  window.addEventListener('keyup', key)
  window.addEventListener('blur', blur)
  return () => {
    root.removeEventListener('pointerdown', down)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    root.removeEventListener('pointerleave', leave)
    window.removeEventListener('keydown', key)
    window.removeEventListener('keyup', key)
    window.removeEventListener('blur', blur)
  }
}
