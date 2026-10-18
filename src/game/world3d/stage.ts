// Сцена встречи: рендер в низком разрешении, голова игрока, комната, люди, бумаги на столе (DOM в 3D).
// React сюда не заходит: World живёт сам по себе, экран встречи только передаёт ему состояние и слушает кадры.

import { startFrameLoop } from '../frameLoop'
import { recordRenderFrame } from '../perf'
import { renderSize } from './renderBudget'
import { DefaultLoadingManager, MathUtils, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3 } from 'three'
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { PortraitId } from '../ui/assets'
import { Company } from './company'
import { VideoCall } from './call'
import { Head, YAW_MAX, type Pose } from './head'
import { EYE, SEATS, SPRITE_M_PER_PX } from './layout'
import { Desk, type PaperId } from './papers'
import { SEATED_FACE_Y } from './people'
import { PixelPipeline } from './post'
import type { ExitPlan } from './exit'
import type { RoomBuild } from './room'
import { buildAnyRoom, type WorldKind } from './rooms'
import { BIG_SCREEN } from './rooms/meet'

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
  kind: WorldKind
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
  readonly company: Company | VideoCall | null = null
  /** видеозвонок: собеседник на большом экране переговорной и на ноутбуке, а не за столом (комната meet) */
  readonly call: boolean
  /** угол обзора у стола и приближенный — на большой экран переговорной (только в звонке) */
  private fovDesk = 50
  private fovFace = 50
  room: RoomBuild & { exit: ExitPlan }
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
  private stopLoop?: () => void
  private reducedMotion = false
  private t = 0
  private listeners = new Set<(f: Frame) => void>()
  private ro: ResizeObserver
  private lastKey = ''
  /** текстуры комнаты и лица загрузились — можно проявлять кадр из темноты */
  private ready = false
  private texturesLeft = 1
  private loaded = () => void (this.texturesLeft = 0)
  private fpsT = 0
  private fpsN = 0
  /** средний fps за последние секунды — экран встречи решает, не пора ли в 2D */
  fps = 60
  /** доля разрешения: на слабом железе кадр мельче */
  quality = 1

  constructor(el: HTMLElement, o: WorldOptions) {
    this.el = el
    this.reducedMotion = !!o.reducedMotion
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
    const lm = DefaultLoadingManager
    lm.onStart = () => void (this.texturesLeft = 1)
    lm.onProgress = (_u, loaded, total) => void (this.texturesLeft = total - loaded)
    lm.onLoad = lm.onError = this.loaded
    this.room = buildAnyRoom(o.kind)
    this.scene.add(this.room.group)
    this.scene.add(this.desk.group)
    this.call = o.kind === 'meet'
    if (this.call) {
      // бумаги ложатся по бокам от ноутбука, листок с предложением «приходит» из-под экрана
      this.desk.spots = CALL_SPOTS
      this.desk.themFrom = { x: 0.1, z: -0.2 }
    }
    if (o.opponent)
      this.company = this.call
        ? new VideoCall(this.room.group, o.opponent)
        : new Company(this.room.group, o.caseId ?? '', o.opponent, { plan: this.room.exit, door: this.room.door })
    this.camera.rotation.order = 'YXZ'
    if (o.reducedMotion) this.head.stiffness = 30
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(el)
    this.resize()
    if (this.call) {
      this.head.pitch = this.head.tp
      this.head.yaw = this.head.ty
    }
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
    const { base, px, w, h } = renderSize(cw, ch, this.quality)
    this.px = px
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
    if (this.call) this.frameCall(w / h)
    // бумаги: страница в CSS-пикселях примерно того размера, каким лист виден, когда склонились к столу
    const deskEye = new Vector3(EYE.x, EYE.y + 0.1, EYE.z - 0.3)
    const nb = this.desk.sheets.notebook.spot
    const dist = deskEye.distanceTo(new Vector3(nb.x, 0.74, nb.z))
    const pxPerM = sh / (2 * dist * Math.tan((this.camera.fov * D) / 2))
    this.desk.layout(tall, pxPerM, cw)
    this.lastKey = ''
  }

  start() {
    this.stop()
    this.stopLoop = startFrameLoop((dt) => this.frame(dt), () => {
      const lead = this.company?.lead
      const active = !this.head.still || !!this.head.spin || lead?.talking || (lead?.leaving && !lead.exited) || this.fade > 0
      return !this.reducedMotion && active ? 60 : 30
    })
  }

  stop() {
    this.stopLoop?.()
    this.stopLoop = undefined
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
    this.followExit()
    const h = this.head
    h.update(dt)
    this.xray += (this.xrayTarget - this.xray) * (1 - Math.exp(-dt * 6))
    if (!this.ready) this.ready = this.t > 3 || (this.texturesLeft === 0 && (this.company?.lead.ready ?? true))
    if (this.fade > 0 && this.ready) this.fade = Math.max(0, this.fade - dt * 1.4)
    const lean = h.lean
    // склоняемся над бумагами: вперёд и чуть вверх; и еле заметно дышим
    // над бумагами не дышим: кнопки на листах должны стоять на месте
    const breathe = (this.reducedMotion ? 0 : Math.sin(this.t * 1.3)) * 0.003 * (1 - Math.min(1, lean * 4))
    this.stand += (this.standTarget - this.stand) * (1 - Math.exp(-dt * 1.8))
    const cam = this.camera
    cam.position.set(EYE.x - Math.sin(h.yaw) * 0.03, EYE.y + lean * 0.1 + breathe + this.stand * 0.42, EYE.z - lean * 0.3 + this.stand * 0.25)
    cam.rotation.set(h.pitch, h.yaw, 0)
    if (this.call) {
      // смотрим на экран — угол обзора подобран под него; к столу, по сторонам и вставая — обычный угол
      const off = Math.abs(h.yaw - h.poses.face.yaw)
      const k = Math.max(MathUtils.smoothstep(lean, 0, 0.6), MathUtils.smoothstep(off, 0.08, 0.45), Math.min(1, this.stand * 2))
      const fov = MathUtils.lerp(this.fovFace, this.fovDesk, k)
      if (Math.abs(fov - cam.fov) > 1e-3) {
        cam.fov = fov
        cam.updateProjectionMatrix()
      }
    }
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
    recordRenderFrame('3d', this.pipe.w, this.pipe.h)
  }

  /**
   * Видеозвонок: взгляд «на собеседника» — это взгляд на большой экран на торцевой стене слева (голова повёрнута
   * к нему). Угол обзора подбираем так, чтобы экран занимал больше половины высоты кадра на ноутбуке и почти всю
   * ширину на телефоне; у стола остаётся обычный угол. Экран стоит в верхней части кадра: внизу под ним — реплика
   * собеседника и поле ввода, лицо они не закрывают, а по краям видно комнату.
   */
  private frameCall(aspect: number) {
    const s = BIG_SCREEN
    const dx = s.x - EYE.x
    const dz = s.z - EYE.z
    const flat = Math.hypot(dx, dz)
    const yaw = Math.atan2(-dx, -dz)
    const aim = Math.atan2(s.y - EYE.y, flat)
    // углы экрана в координатах глаза, смотрящего в его центр: экран сбоку, ближний край виден крупнее дальнего
    let tx = 0
    let ty = 0
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = tmp.set(s.x - EYE.x, s.y + (v * s.h) / 2 - EYE.y, s.z + (u * s.w) / 2 - EYE.z)
      p.applyAxisAngle(Y_AXIS, -yaw).applyAxisAngle(X_AXIS, -aim)
      tx = Math.max(tx, Math.abs(p.x / p.z))
      ty = Math.max(ty, Math.abs(p.y / p.z))
    }
    // на ноутбуке экран — половина высоты кадра, на телефоне — почти вся ширина
    const tall = aspect < 1
    const half = Math.max(tall ? 0 : ty / 0.48, tx / (tall ? 0.92 : 0.74) / aspect)
    this.fovDesk = this.camera.fov
    this.fovFace = MathUtils.clamp((2 * Math.atan(half)) / D, 30, 80)
    // экран выше середины кадра: под ним — реплика собеседника и поле ввода; на ноутбуке ещё и чуть правее —
    // слева сверху встают подсказки наставника и разбор хода
    const pitch = aim - this.fovFace * D * (tall ? 0.2 : 0.15)
    const right = tall ? 0 : Math.atan(Math.tan(this.fovFace * D / 2) * aspect * 0.16)
    const facing = this.head.tp > (pitch + this.head.poses.desk.pitch) / 2
    this.head.poses = { ...this.head.poses, face: { yaw: yaw + right, pitch } }
    if (facing) this.head.look('face')
  }

  look(p: Pose) {
    this.head.look(p)
  }

  /**
   * Собеседник встал и уходит — игрок смотрит ему в лицо и провожает взглядом до двери (на телефоне кадр узкий, и без
   * этого вставший уходит головой за верх экрана), а когда дверь за ним закрылась, смотрит на стол переговоров.
   */
  private following = false
  private followExit() {
    const lead = this.company?.lead
    if (lead?.tracking) {
      const p = lead.exitAt
      const dist = Math.hypot(p.x - EYE.x, p.z - EYE.z)
      this.head.ty = MathUtils.clamp(Math.atan2(EYE.x - p.x, EYE.z - p.z), -YAW_MAX, YAW_MAX)
      this.head.tp = this.head.poses.face.pitch + Math.atan2(p.y - EYE.y, dist) - Math.atan2(SEATED_FACE_Y - EYE.y, OPP_DIST)
      this.following = true
    } else if (this.following && (lead?.exited || !lead?.leaving)) {
      this.following = false
      this.look('face')
    }
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
    this.listeners.clear()
    this.company?.dispose()
    this.desk.dispose()
    this.room.dispose?.()
    // менеджер загрузки глобальный: его обработчики держали бы весь мир; если новый мир уже повесил свои — не трогаем
    const lm = DefaultLoadingManager
    if (lm.onLoad === this.loaded) lm.onStart = lm.onProgress = lm.onLoad = lm.onError = () => {}
    this.pipe.dispose()
    this.canvas.remove()
    this.cssLayer.remove()
  }
}

/** Бумаги в звонке: блокнот слева от ноутбука, листок и карточка справа. */
const CALL_SPOTS = {
  wide: {
    notebook: { x: -0.34, z: 0.08, w: 0.26, h: 0.32, rot: 4 },
    card: { x: 0.36, z: 0.12, w: 0.17, h: 0.2, rot: -6 },
    slip: { x: 0.33, z: -0.18, w: 0.24, h: 0.26, rot: 3 },
  },
  // на телефоне виден узкий кусок стола перед ноутбуком: листы лежат стопкой, берут их тапом
  tall: {
    notebook: { x: -0.08, z: 0.14, w: 0.26, h: 0.36, rot: 4 },
    card: { x: 0.12, z: 0.21, w: 0.16, h: 0.19, rot: -8 },
    slip: { x: 0.11, z: 0.02, w: 0.2, h: 0.24, rot: 5 },
  },
}

const tmp = new Vector3()
const X_AXIS = new Vector3(1, 0, 0)
const Y_AXIS = new Vector3(0, 1, 0)
const ray = new Raycaster()
const ndc = new Vector2()
