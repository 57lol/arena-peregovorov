// Сцена встречи: рендер в низком разрешении, голова игрока, комната, люди, бумаги на столе (DOM в 3D).
// React сюда не заходит: World живёт сам по себе, экран встречи только передаёт ему состояние и слушает кадры.

import { DefaultLoadingManager, MathUtils, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3 } from 'three'
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { PortraitId } from '../ui/assets'
import { Company } from './company'
import { Head, type Pose } from './head'
import { EYE, SEATS, SPRITE_M_PER_PX } from './layout'
import { Desk, type PaperId } from './papers'
import { PixelPipeline } from './post'
import { buildRoom, type RoomBuild, type RoomKind } from './room'

const D = MathUtils.DEG2RAD

/** от глаз до собеседника, м — под это расстояние подбираем угол обзора */
const OPP_DIST = EYE.z - SEATS.opponent.z

export interface Frame {
  t: number
  dt: number
  /** вид сдвинулся с прошлого кадра */
  moved: boolean
}

export interface WorldOptions {
  kind: RoomKind
  /** дело — от него зависит массовка */
  caseId?: string
  opponent?: PortraitId
  reducedMotion?: boolean
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
  readonly desk = new Desk()
  readonly company: Company | null = null
  room: RoomBuild
  /** CSS-пикселей на одну игровую точку */
  px = 4
  cw = 0
  ch = 0
  xray = 0
  xrayTarget = 0
  fade = 1
  /** игрок встал из-за стола (ушёл без сделки): 0 — сидим, 1 — стоим */
  standTarget = 0
  private stand = 0
  /** время встречи, минуты от полуночи — стрелки часов доезжают до него плавно */
  clockTarget = 10 * 60
  private clockNow = 10 * 60
  private raf = 0
  private last = 0
  private t = 0
  private listeners = new Set<(f: Frame) => void>()
  private ro: ResizeObserver
  private lastKey = ''
  /** текстуры комнаты и лица загрузились — можно проявлять кадр из темноты */
  private ready = false
  private texturesLeft = 1
  private fpsT = 0
  private fpsN = 0
  /** средний fps за последние секунды — экран встречи решает, не пора ли в 2D */
  fps = 60
  /** доля разрешения: на слабом железе кадр мельче */
  quality = 1

  constructor(el: HTMLElement, o: WorldOptions) {
    this.el = el
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'w3-canvas'
    el.appendChild(this.canvas)
    this.pipe = new PixelPipeline(this.canvas)
    this.css = new CSS3DRenderer()
    this.cssLayer = this.css.domElement
    this.cssLayer.classList.add('w3-css')
    // overflow: clip, а не hidden: иначе фокус на кнопке листа прокручивает слой и страницы съезжают с бумаги
    this.cssLayer.style.overflow = 'clip'
    this.cssLayer.addEventListener('scroll', () => this.cssLayer.scrollTo(0, 0))
    el.appendChild(this.cssLayer)
    // пока грузятся текстуры и листы лиц, держим экран тёмным (но не дольше 3 секунд)
    DefaultLoadingManager.onStart = () => void (this.texturesLeft = 1)
    DefaultLoadingManager.onProgress = (_u, loaded, total) => void (this.texturesLeft = total - loaded)
    DefaultLoadingManager.onLoad = () => void (this.texturesLeft = 0)
    DefaultLoadingManager.onError = () => void (this.texturesLeft = 0)
    this.room = buildRoom(o.kind)
    this.scene.add(this.room.group)
    this.scene.add(this.desk.group)
    if (o.opponent) this.company = new Company(this.room.group, o.caseId ?? '', o.opponent)
    this.camera.rotation.order = 'YXZ'
    if (o.reducedMotion) this.head.stiffness = 30
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
    // целый масштаб: на ноутбуке ~225 точек по высоте, на телефоне ~130 по ширине (собеседник крупнее); на слабом железе — крупнее
    const base = cw >= ch ? Math.max(2, Math.round(ch / 230)) : Math.max(2, Math.round(cw / 130))
    const px = Math.max(2, Math.round(base / this.quality))
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
    const vfov = 2 * Math.atan((h * px * SPRITE_M_PER_PX) / (base * 2 * OPP_DIST))
    this.camera.fov = MathUtils.clamp(vfov / D, 38, 84)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    // стол на телефоне виден уже в обычном взгляде: голова чуть ниже, на стол — круче
    const tall = this.portrait
    this.head.poses = { face: { yaw: 0, pitch: (tall ? -15 : -6) * D }, desk: { yaw: 0, pitch: (tall ? -52 : -55) * D } }
    // бумаги: страница в CSS-пикселях примерно того размера, каким лист виден, когда склонились к столу
    const deskEye = new Vector3(EYE.x, EYE.y + 0.1, EYE.z - 0.3)
    const nb = this.desk.sheets.notebook.spot
    const dist = deskEye.distanceTo(new Vector3(nb.x, 0.74, nb.z))
    const pxPerM = sh / (2 * dist * Math.tan((this.camera.fov * D) / 2))
    this.desk.layout(tall, pxPerM, cw)
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
    this.fpsT += dt
    this.fpsN++
    if (this.fpsT >= 2) {
      this.fps = this.fpsN / this.fpsT
      this.fpsT = 0
      this.fpsN = 0
    }
    const h = this.head
    h.update(dt)
    this.xray += (this.xrayTarget - this.xray) * (1 - Math.exp(-dt * 6))
    if (!this.ready) this.ready = this.t > 3 || (this.texturesLeft === 0 && (this.company?.lead.ready ?? true))
    if (this.fade > 0 && this.ready) this.fade = Math.max(0, this.fade - dt * 1.4)
    const lean = h.lean
    // склоняемся над бумагами: вперёд и чуть вверх; и еле заметно дышим
    // над бумагами не дышим: кнопки на листах должны стоять на месте
    const breathe = Math.sin(this.t * 1.3) * 0.003 * (1 - Math.min(1, lean * 4))
    this.stand += (this.standTarget - this.stand) * (1 - Math.exp(-dt * 1.8))
    const cam = this.camera
    cam.position.set(EYE.x - Math.sin(h.yaw) * 0.03, EYE.y + lean * 0.1 + breathe + this.stand * 0.42, EYE.z - lean * 0.3 + this.stand * 0.25)
    cam.rotation.set(h.pitch, h.yaw, 0)
    cam.updateMatrixWorld()

    // часы: стрелки догоняют время встречи
    this.clockNow += (this.clockTarget - this.clockNow) * (1 - Math.exp(-dt * 3))
    const m = this.clockNow
    this.room.clock.minute.rotation.z = -((m % 60) / 60) * Math.PI * 2
    this.room.clock.hour.rotation.z = -(((m / 60) % 12) / 12) * Math.PI * 2

    this.room.update?.(this.t, dt)
    this.company?.update(this.t, dt, cam)
    this.desk.update(dt, lean, cam)
    const key = `${cam.position.x.toFixed(4)}${cam.position.y.toFixed(4)}${cam.position.z.toFixed(4)}${h.yaw.toFixed(4)}${h.pitch.toFixed(4)}`
    const moved = key !== this.lastKey
    this.lastKey = key
    for (const fn of this.listeners) fn({ t: this.t, dt, moved })
    this.pipe.render(this.scene, cam, { xray: this.xray, fade: this.fade, dim: this.desk.heldAmount * 0.45 })
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

  /** Что под пальцем или курсором: лист на столе или ничего. x, y — CSS-пиксели относительно контейнера. */
  pick(x: number, y: number): PaperId | null {
    const sw = this.pipe.w * this.px
    const sh = this.pipe.h * this.px
    const ox = Math.floor((this.cw - sw) / 2)
    const oy = Math.floor((this.ch - sh) / 2)
    ray.setFromCamera(ndc.set(((x - ox) / sw) * 2 - 1, -((y - oy) / sh) * 2 + 1), this.camera)
    const meshes = Object.values(this.desk.sheets).filter((s) => s.root.visible).map((s) => s.mesh)
    const hit = ray.intersectObjects(meshes, false)[0]
    if (!hit) return null
    return (Object.values(this.desk.sheets).find((s) => s.mesh === hit.object)?.id ?? null) as PaperId | null
  }

  dispose() {
    this.stop()
    this.ro.disconnect()
    this.company?.dispose()
    this.desk.dispose()
    this.room.dispose?.()
    this.pipe.dispose()
    this.canvas.remove()
    this.cssLayer.remove()
  }
}

const tmp = new Vector3()
const ray = new Raycaster()
const ndc = new Vector2()
