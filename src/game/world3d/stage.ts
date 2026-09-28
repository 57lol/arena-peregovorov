// Сцена встречи: рендер в низком разрешении, голова игрока, комната, люди, бумаги на столе (DOM в 3D).
// React сюда не заходит: World живёт сам по себе, экран встречи только передаёт ему состояние и слушает кадры.

import { MathUtils, PerspectiveCamera, Scene, Vector3 } from 'three'
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import { Head, type Pose } from './head'
import { EYE } from './layout'
import { PixelPipeline } from './post'
import { buildRoom, type RoomBuild, type RoomKind } from './room'

const D = MathUtils.DEG2RAD

/** Плотность, при которой лицо собеседника (96 точек = 0.62 м) ложится примерно точка в точку. */
export const SPRITE_M_PER_PX = 0.62 / 96
const OPP_DIST = 1.7

export interface Frame {
  t: number
  dt: number
  /** вид сдвинулся с прошлого кадра */
  moved: boolean
}

export class World {
  readonly el: HTMLElement
  readonly canvas: HTMLCanvasElement
  readonly cssLayer: HTMLElement
  readonly pipe: PixelPipeline
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(50, 1, 0.05, 30)
  readonly head = new Head()
  readonly css: CSS3DRenderer
  room: RoomBuild
  /** CSS-пикселей на одну игровую точку */
  px = 4
  cw = 0
  ch = 0
  xray = 0
  xrayTarget = 0
  fade = 1
  private raf = 0
  private last = 0
  private t = 0
  private listeners = new Set<(f: Frame) => void>()
  private ro: ResizeObserver
  private lastKey = ''

  constructor(el: HTMLElement, kind: RoomKind) {
    this.el = el
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'w3-canvas'
    el.appendChild(this.canvas)
    this.pipe = new PixelPipeline(this.canvas)
    this.css = new CSS3DRenderer()
    this.cssLayer = this.css.domElement
    this.cssLayer.classList.add('w3-css')
    el.appendChild(this.cssLayer)
    this.room = buildRoom(kind)
    this.scene.add(this.room.group)
    this.camera.rotation.order = 'YXZ'
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(el)
    this.resize()
  }

  on(fn: (f: Frame) => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  get portrait() {
    return this.ch > this.cw
  }

  resize() {
    const cw = this.el.clientWidth
    const ch = this.el.clientHeight
    if (!cw || !ch) return
    this.cw = cw
    this.ch = ch
    // целый масштаб: на ноутбуке ~225 точек по высоте, на телефоне ~190 по ширине
    const px = cw >= ch ? Math.max(2, Math.round(ch / 230)) : Math.max(2, Math.round(cw / 190))
    this.px = px
    const w = Math.ceil(cw / px)
    const h = Math.ceil(ch / px)
    this.pipe.setSize(w, h)
    const sw = w * px
    const sh = h * px
    for (const e of [this.canvas, this.cssLayer]) {
      e.style.width = `${sw}px`
      e.style.height = `${sh}px`
      e.style.left = `${Math.floor((cw - sw) / 2)}px`
      e.style.top = `${Math.floor((ch - sh) / 2)}px`
    }
    this.css.setSize(sw, sh)
    // вертикальный угол — чтобы собеседник на своём месте выходил примерно точка в точку
    const vfov = 2 * Math.atan((h * SPRITE_M_PER_PX) / (2 * OPP_DIST))
    this.camera.fov = MathUtils.clamp(vfov / D, 38, 84)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    // стол на телефоне виден уже в обычном взгляде: голова чуть ниже, на стол — круче
    const faceP = this.portrait ? -11 : -6
    this.head.poses = { face: { yaw: 0, pitch: faceP * D }, desk: { yaw: 0, pitch: (this.portrait ? -52 : -56) * D } }
    this.lastKey = ''
  }

  start() {
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop)
      const dt = Math.min(0.1, this.last ? (now - this.last) / 1000 : 0.016)
      this.last = now
      this.frame(dt)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.last = 0
  }

  private frame(dt: number) {
    this.t += dt
    const h = this.head
    h.update(dt)
    this.xray += (this.xrayTarget - this.xray) * (1 - Math.exp(-dt * 6))
    if (this.fade > 0) this.fade = Math.max(0, this.fade - dt * 1.6)
    const lean = h.lean
    // склоняемся над бумагами: вперёд и чуть вверх; и еле заметно дышим
    const breathe = Math.sin(this.t * 1.3) * 0.004
    const cam = this.camera
    cam.position.set(EYE.x + Math.sin(h.yaw) * -0.02, EYE.y + lean * 0.1 + breathe, EYE.z - lean * 0.3)
    cam.rotation.set(h.pitch, h.yaw, 0)
    cam.updateMatrixWorld()
    this.room.update?.(this.t, dt)
    const key = `${cam.position.x.toFixed(4)}${cam.position.y.toFixed(4)}${cam.position.z.toFixed(4)}${h.yaw.toFixed(4)}${h.pitch.toFixed(4)}`
    const moved = key !== this.lastKey
    this.lastKey = key
    for (const fn of this.listeners) fn({ t: this.t, dt, moved })
    this.pipe.render(this.scene, cam, { xray: this.xray, fade: this.fade })
    this.css.render(this.scene, cam)
  }

  look(p: Pose) {
    this.head.look(p)
  }

  /** Точка мира → CSS-пиксели относительно контейнера; behind — за спиной камеры. */
  project(v: Vector3, out = { x: 0, y: 0, behind: false }) {
    const p = tmp.copy(v).project(this.camera)
    const sw = this.pipe.w * this.px
    const sh = this.pipe.h * this.px
    out.x = (p.x * 0.5 + 0.5) * sw + Math.floor((this.cw - sw) / 2)
    out.y = (-p.y * 0.5 + 0.5) * sh + Math.floor((this.ch - sh) / 2)
    out.behind = p.z > 1
    return out
  }

  dispose() {
    this.stop()
    this.ro.disconnect()
    this.room.dispose?.()
    this.pipe.dispose()
    this.canvas.remove()
    this.cssLayer.remove()
  }
}

const tmp = new Vector3()
