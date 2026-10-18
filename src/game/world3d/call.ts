// Видеозвонок вместо собеседника за столом: переговорная «Кама» (rooms/meet.ts), на торцевой стене большой экран,
// перед игроком на столе ноутбук — оба показывают одно окно связи (шоурум в Иу, собеседник, плашка с именем,
// окошко «Вы», таймер и полоски связи): ноутбук транслирует звонок на экран переговорной. Лицо — тот же лист
// портретов, что в 2D и у людей за столом: рот по звуку (lipState), моргание, эмоции. Иногда связь проседает:
// полоски желтеют, картинка на миг рассыпается крупными квадратами. Собеседник «уходит» — звонок завершается.
// За столом двое коллег-массовка: смотрят на экран, иногда на игрока, отзываются на настроение собеседника.
//
// Снаружи это выглядит как Company (company.ts): lead, setMood, stir, update, dispose — stage.ts и экран встречи
// работают с ним так же, только никто не встаёт и не идёт к двери.

import {
  BoxGeometry,
  CanvasTexture,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Camera,
} from 'three'
import { lipState } from '../speech'
import { echo } from './company'
import { Person } from './people'
import { BIG_SCREEN } from './rooms/meet'
import { PLACE as MEET } from './rooms/meet.gen'
import { EMOTIONS, FRAMES, PORTRAITS, PORTRAIT_SIZE as S, spriteEmotion, type PortraitEmotion, type PortraitFrame, type PortraitId } from '../ui/assets'
import { TABLE } from './layout'
import { hex } from './palette'

/** Ноутбук на столе, м. Петля — дальний край корпуса, крышка откинута назад. */
export const LAPTOP = { w: 0.36, depth: 0.25, base: 0.018, front: -0.08, lid: 0.235, tilt: (14 * Math.PI) / 180 }
/** Экран внутри рамки (16:10) и холст окна связи, точки. */
const SW = 0.336
const SH = 0.21
const CW = 192
const CH = 120
const VIDEO_Y = 10
const VIDEO_H = 96
/** низ рамки под экраном, м */
const BEZEL_LOW = 0.017

const hingeZ = LAPTOP.front - LAPTOP.depth
const hingeY = TABLE.y + LAPTOP.base


const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
// альфа 0.5 — как у людей и бумаг: палитровый проход экран не дизерит, нарисованные точки остаются чистыми
const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(map, vUv).rgb, 0.5);
}
`

/** Цифры 3×5 для таймера звонка. */
const DIGITS: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#.', '##.', '.#.', '.#.', '###'], '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'], '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'], '7': ['###', '..#', '.#.', '.#.', '.#.'], '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'], ':': ['.', '#', '.', '#', '.'],
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = rej
    im.src = src
  })
}

/** Коллеги за столом переговорной: места дальнего ряда (PLACE.crew) и лица из набора — не герои других дел. */
const CREW: PortraitId[] = ['hr', 'dev']

/** Собеседник на экране: то, что у людей за столом, — без ухода к двери. */
export class CallLead {
  emotion: PortraitEmotion = 'neutral'
  talking = false
  leaving = false
  /** звонок завершён (собеседник отключился) */
  exited = false
  readonly tracking = false
  readonly walking = false
  readonly exitAt = new Vector3()
  doorOpen = 0
  ready = false
  private readonly screen: Mesh
  private readonly h: number
  /** screen — экран, на котором его видно крупно (большой в переговорной), h — высота картинки, м */
  constructor(screen: Mesh, h: number) {
    this.screen = screen
    this.h = h
  }

  /** Точки на экране: «голова» — макушка в кадре, «подбородок» и «грудь» — ниже, у края экрана. */
  anchor(which: 'head' | 'chin' | 'chest', out = new Vector3()) {
    const v = { head: 20, chin: 72, chest: CH + 6 }[which]
    this.screen.updateMatrixWorld()
    return this.screen.localToWorld(out.set(0, (0.5 - v / CH) * this.h, 0.002))
  }
}

export class VideoCall {
  readonly lead: CallLead
  readonly extras: Person[]
  /** до какой секунды коллеги смотрят на говорящего */
  private stirUntil = 0
  private stirGaze: 'you' | 'table' = 'you'
  private t = 0
  private readonly group = new Group()
  private readonly canvas = document.createElement('canvas')
  private readonly g: CanvasRenderingContext2D
  private readonly tex: CanvasTexture
  private readonly mats: (MeshBasicMaterial | ShaderMaterial)[] = []
  private readonly geos: (BoxGeometry | PlaneGeometry)[] = []
  private img: { bg: HTMLImageElement; ui: HTMLImageElement; end: HTMLImageElement; sheet: HTMLImageElement } | null = null
  private disposed = false
  private frame: PortraitFrame = 'idle'
  private blinkAt = 1.5 + Math.random() * 2
  private blinkEnd = 0
  private talkFlip = 0
  private jolt = 0
  private prevEmotion: PortraitEmotion = 'neutral'
  private gone = 0
  /** связь проседает: с какой по какую секунду */
  private glitch = { from: 14 + Math.random() * 10, to: 0 }
  private lastKey = ''
  private texExtra: CanvasTexture | null = null
  private readonly small = document.createElement('canvas')

  constructor(root: Group, opponent: PortraitId) {
    this.canvas.width = CW
    this.canvas.height = CH
    this.g = this.canvas.getContext('2d')!
    this.g.imageSmoothingEnabled = false
    this.g.fillStyle = hex(38)
    this.g.fillRect(0, 0, CW, CH)
    this.small.width = CW / 4
    this.small.height = VIDEO_H / 4
    const tex = (this.tex = new CanvasTexture(this.canvas))
    tex.magFilter = NearestFilter
    tex.minFilter = LinearMipmapLinearFilter

    const flat = (c: number) => {
      const m = new MeshBasicMaterial({ color: parseInt(hex(c).slice(1), 16) })
      this.mats.push(m)
      return m
    }
    const box = (w: number, h: number, d: number, faces: MeshBasicMaterial[]) => {
      const geo = new BoxGeometry(w, h, d)
      this.geos.push(geo)
      return new Mesh(geo, faces)
    }
    // грани BoxGeometry: +x, −x, +y, −y, +z (к нам), −z
    const alu = flat(43)
    const aluSide = flat(41)
    const aluDark = flat(40)
    const base = box(LAPTOP.w, LAPTOP.base, LAPTOP.depth, [aluSide, aluSide, alu, aluDark, flat(42), aluSide])
    base.position.set(0, TABLE.y + LAPTOP.base / 2, LAPTOP.front - LAPTOP.depth / 2)
    this.group.add(base)
    // клавиатура и тачпад
    const keys = new Mesh(this.plane(0.3, 0.12), this.keysMaterial())
    keys.rotation.x = -Math.PI / 2
    keys.position.set(0, hingeY + 0.0006, hingeZ + 0.085)
    const pad = new Mesh(this.plane(0.11, 0.065), flat(42))
    pad.rotation.x = -Math.PI / 2
    pad.position.set(0, hingeY + 0.0006, LAPTOP.front - 0.045)
    this.group.add(keys, pad)

    // крышка: рамка тёмная, сзади алюминий; петля у дальнего края корпуса
    const lid = new Group()
    lid.position.set(0, hingeY, hingeZ)
    lid.rotation.x = -LAPTOP.tilt
    const bezel = flat(37)
    const shell = box(LAPTOP.w, LAPTOP.lid, 0.007, [aluSide, aluSide, alu, aluDark, bezel, alu])
    shell.position.set(0, LAPTOP.lid / 2, -0.0035)
    lid.add(shell)
    const sm = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { map: { value: tex } } })
    this.mats.push(sm)
    const screen = new Mesh(this.plane(SW, SH), sm)
    screen.position.set(0, BEZEL_LOW + SH / 2, 0.0006)
    lid.add(screen)
    // глазок камеры над экраном
    const cam = new Mesh(this.plane(0.006, 0.006), flat(39))
    cam.position.set(0, BEZEL_LOW + SH + (LAPTOP.lid - BEZEL_LOW - SH) / 2, 0.0007)
    lid.add(cam)
    this.group.add(lid)

    // большой экран переговорной: та же картинка, что на ноутбуке, — крупно, на торцевой стене
    const big = new Mesh(this.plane(BIG_SCREEN.w, BIG_SCREEN.h), sm)
    big.position.set(BIG_SCREEN.x, BIG_SCREEN.y, BIG_SCREEN.z)
    big.rotation.y = BIG_SCREEN.ry
    this.group.add(big)
    root.add(this.group)

    this.lead = new CallLead(big, BIG_SCREEN.h)
    // коллеги сидят в дальнем ряду лицом к столу и поглядывают на экран
    this.extras = MEET.crew.map((i, k) => {
      const p = new Person({ id: CREW[k % CREW.length], x: MEET.farX[i], z: MEET.farZ + 0.14, facing: 0, focus: { x: BIG_SCREEN.x, z: BIG_SCREEN.z } })
      p.flip = k % 2 === 1
      root.add(p.group)
      return p
    })
    Promise.all([
      loadImage('/assets/world/call_bg.png'),
      loadImage('/assets/world/call_ui.png'),
      loadImage('/assets/world/call_end.png'),
      loadImage(PORTRAITS[opponent].sheet),
    ])
      .then(([bg, ui, end, sheet]) => {
        if (this.disposed) return
        this.img = { bg, ui, end, sheet }
        this.lead.ready = true
      })
      .catch(() => void (this.lead.ready = true))
  }

  private plane(w: number, h: number) {
    const geo = new PlaneGeometry(w, h)
    this.geos.push(geo)
    return geo
  }

  /** Клавиши: тёмные квадратики на панели — мелкая текстура, чтобы издалека читалась клавиатура. */
  private keysMaterial() {
    const c = document.createElement('canvas')
    c.width = 60
    c.height = 24
    const g = c.getContext('2d')!
    g.fillStyle = hex(42)
    g.fillRect(0, 0, 60, 24)
    g.fillStyle = hex(39)
    for (let r = 0; r < 5; r++)
      for (let k = 0; k < 12; k++) {
        if (r === 4 && k > 2 && k < 9) continue
        g.fillRect(1 + k * 5, 1 + r * 5, 4, 4)
      }
    g.fillRect(16, 21, 28, 3)
    const t = new CanvasTexture(c)
    t.magFilter = NearestFilter
    t.minFilter = LinearMipmapLinearFilter
    const m = new MeshBasicMaterial({ map: t })
    this.mats.push(m)
    this.texExtra = t
    return m
  }

  /** Собеседник заговорил или игрок сказал реплику — коллеги ненадолго поворачиваются к говорящему. */
  stir(to: 'you' | 'table' = 'you', sec = 2.5) {
    this.stirGaze = to
    this.stirUntil = this.t + sec
    for (const p of this.extras) p.gaze = to
  }

  setMood(e: PortraitEmotion, talking: boolean) {
    this.lead.emotion = e
    this.lead.talking = talking
    this.extras.forEach((p, k) => (p.emotion = echo(e, k)))
  }

  update(t: number, dt: number, cam: Camera) {
    this.t = t
    const stir = t < this.stirUntil
    for (const p of this.extras) {
      if (stir) p.gaze = this.stirGaze
      p.update(t, dt, cam, stir)
    }
    const lead = this.lead
    // рот по звуку, без звука — по печати текста; иначе моргаем
    const lip = lipState()
    if (lip !== 'off') this.frame = lip === 'open' ? 'talk' : 'idle'
    else if (lead.talking) {
      this.talkFlip -= dt
      if (this.talkFlip <= 0) {
        this.talkFlip = 0.11
        this.frame = this.frame === 'talk' ? 'idle' : 'talk'
      }
    } else if (t >= this.blinkAt) {
      this.frame = 'blink'
      this.blinkEnd = t + 0.12
      this.blinkAt = t + 2.2 + Math.random() * 3.4
    } else if (this.frame !== 'idle' && t >= this.blinkEnd) this.frame = 'idle'
    if (this.prevEmotion !== lead.emotion) {
      this.prevEmotion = lead.emotion
      this.jolt = 0.14
    }
    this.jolt = Math.max(0, this.jolt - dt)

    // собеседник отключился: договорил — и экран гаснет
    if (lead.leaving) {
      this.gone += dt
      if (this.gone > 1.2 && lip === 'off') lead.exited = true
    } else {
      this.gone = 0
      lead.exited = false
    }

    // связь: раз в 15–30 с на полсекунды проседает
    if (t > this.glitch.from && !this.glitch.to) this.glitch.to = t + 0.35 + Math.random() * 0.3
    if (this.glitch.to && t > this.glitch.to) this.glitch = { from: t + 15 + Math.random() * 15, to: 0 }
    const bad = !!this.glitch.to

    const sec = Math.floor(t)
    const key = `${spriteEmotion(lead.emotion)}${this.frame}${this.jolt > 0 ? 1 : 0}${lead.exited ? 1 : 0}${bad ? Math.floor(t * 12) : 0}${sec}${this.img ? 1 : 0}`
    if (key === this.lastKey) return
    this.lastKey = key
    this.draw(sec, bad)
  }

  private draw(sec: number, bad: boolean) {
    const g = this.g
    const im = this.img
    if (!im) return
    g.drawImage(im.bg, 0, 0)
    if (this.lead.exited) {
      g.drawImage(im.end, 0, 0)
    } else {
      const row = EMOTIONS.indexOf(spriteEmotion(this.lead.emotion))
      const col = FRAMES[this.frame]
      g.save()
      g.beginPath()
      g.rect(0, VIDEO_Y, CW, VIDEO_H)
      g.clip()
      g.drawImage(im.sheet, col * S, row * S, S, S, (CW - S) / 2, VIDEO_Y - (this.jolt > 0 ? 1 : 0), S, S)
      g.restore()
      if (bad) this.pixelate()
      g.drawImage(im.ui, 0, 0)
    }
    // таймер звонка: зелёная точка и мм:сс
    const mm = String(Math.floor(sec / 60) % 100).padStart(2, '0')
    const ss = String(sec % 60).padStart(2, '0')
    g.fillStyle = hex(38)
    g.fillRect(2, 1, 30, 8)
    g.fillStyle = hex(this.lead.exited ? 27 : 10)
    g.fillRect(4, 4, 2, 2)
    this.text(`${mm}:${ss}`, 9, 3, hex(44))
    // полоски связи
    const lit = bad ? 2 : 4
    for (let k = 0; k < 4; k++) {
      g.fillStyle = k < lit ? hex(bad ? 22 : 44) : hex(40)
      const h = 2 + k
      g.fillRect(CW - 16 + k * 3, 7 - h, 2, h)
    }
    this.tex.needsUpdate = true
  }

  /** Плохая связь: видео на миг крупными квадратами. */
  private pixelate() {
    const s = this.small.getContext('2d')!
    s.imageSmoothingEnabled = true
    s.drawImage(this.canvas, 0, VIDEO_Y, CW, VIDEO_H, 0, 0, this.small.width, this.small.height)
    this.g.drawImage(this.small, 0, 0, this.small.width, this.small.height, 0, VIDEO_Y, CW, VIDEO_H)
  }

  private text(s: string, x: number, y: number, color: string) {
    const g = this.g
    g.fillStyle = color
    for (const ch of s) {
      const rows = DIGITS[ch]
      if (!rows) continue
      rows.forEach((r, dy) => [...r].forEach((v, dx) => v === '#' && g.fillRect(x + dx, y + dy, 1, 1)))
      x += rows[0].length + 1
    }
  }

  dispose() {
    this.disposed = true
    this.group.removeFromParent()
    this.tex.dispose()
    this.texExtra?.dispose()
    for (const p of this.extras) p.dispose()
    for (const m of this.mats) m.dispose()
    for (const g of this.geos) g.dispose()
  }
}
