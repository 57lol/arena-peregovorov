// Люди за столом: плоские спрайты бюстов из тех же листов, что в 2D (96×96, 6 эмоций × 3 кадра).
// Лист при загрузке «достраивается» вниз — пиджак продолжается под край стола, чтобы тело не обрывалось в воздухе.
// Руки нарисованы слоем поверх спрайта (плечо → предплечье → сложенные кисти), цвета рукавов и кожи — с самого портрета.
// Собеседник всегда смотрит на нас. Массовка молчит: моргает, смотрит в бумаги, поворачивается к говорящему
// и иногда поглядывает на нас. Плоский спрайт при повороте сужается — это и читается как поворот головы.
// Уходит собеседник во весь рост: голова из того же листа, ниже — торс, руки и ноги, дорисованные по цветам портрета
// (ходьба — два кадра шага). Путь и дверь — exit.ts; к нам он всё время лицом, как и за столом.

import {
  CanvasTexture,
  DoubleSide,
  Group,
  LinearMipmapLinearFilter,
  MathUtils,
  Mesh,
  NearestFilter,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Camera,
  type Texture,
} from 'three'
import { emotionTilt, spriteEmotion, EMOTIONS, FRAMES, PORTRAITS, PORTRAIT_SIZE, type PortraitEmotion, type PortraitFrame, type PortraitId } from '../ui/assets'
import { SPRITE_M_PER_PX as M, TABLE, SEATED_FORWARD, seatedTurn, seatYaw } from './layout'
import { exitDone, exitFrame, STAND_S, type ExitPlan } from './exit'
import { lipState } from '../speech'

const S = PORTRAIT_SIZE
/** на сколько точек пиджак продолжается вниз под стол */
const EXT = 64
/** прозрачные поля вокруг кадра — чтобы уменьшенные копии (мипмапы) не цепляли соседние кадры */
const PAD = 4
const CW = S + PAD * 2
const CH = S + EXT + PAD * 2
/** низ нарисованного портрета — над столешницей: глаза собеседника на уровне наших, ниже пиджак продолжается под стол */
const BUST_BOTTOM = TABLE.y + 0.1

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec4 frame;
uniform vec3 tint;
uniform float flip;
varying vec2 vUv;
void main() {
  vec2 uv = vec2(flip > 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y);
  vec4 c = texture2D(map, frame.xy + uv * frame.zw);
  if (c.a < 0.5) discard;
  // альфа 0.5 — флаг для палитрового прохода: людей не дизерим
  gl_FragColor = vec4(c.rgb * tint, 0.5);
}
`

interface Sheet {
  /** лист кешируем холстом: текстура привязана к рендереру, поэтому у каждой встречи своя */
  canvas: HTMLCanvasElement
  w: number
  h: number
  jacket: string
  jacketDark: string
  skin: string
  skinDark: string
  cuff: string
  /** силуэт туловища по строкам портрета: крайняя левая и правая непрозрачная точка */
  left: number[]
  right: number[]
  torso: { l: number; r: number }
  /** нижняя строка портрета (RGBA) — по ней дорисовывается торс того, кто встал и уходит */
  bottom: Uint8ClampedArray
}

const sheets = new Map<PortraitId, Promise<Sheet>>()

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = rej
    im.src = src
  })
}

const hexOf = (d: Uint8ClampedArray, i: number) => `#${[d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** Самые частые цвета в прямоугольнике кадра (без прозрачных). */
function common(d: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number) {
  const n = new Map<string, number>()
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4
      if (d[i + 3] < 128) continue
      const h = hexOf(d, i)
      n.set(h, (n.get(h) ?? 0) + 1)
    }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h)
}

const lum = (h: string) => parseInt(h.slice(1, 3), 16) * 0.3 + parseInt(h.slice(3, 5), 16) * 0.55 + parseInt(h.slice(5, 7), 16) * 0.15

function loadSheet(id: PortraitId): Promise<Sheet> {
  let p = sheets.get(id)
  if (p) return p
  p = loadImage(PORTRAITS[id].sheet).then((im) => {
    const src = document.createElement('canvas')
    src.width = im.width
    src.height = im.height
    const sg = src.getContext('2d', { willReadFrequently: true })!
    sg.drawImage(im, 0, 0)
    const sd = sg.getImageData(0, 0, im.width, im.height).data

    const out = document.createElement('canvas')
    out.width = CW * 3
    out.height = CH * EMOTIONS.length
    const og = out.getContext('2d')!
    const od = og.createImageData(out.width, out.height)
    for (let row = 0; row < EMOTIONS.length; row++)
      for (let col = 0; col < 3; col++) {
        const ox = col * CW + PAD
        const oy = row * CH + PAD
        for (let y = 0; y < S; y++)
          for (let x = 0; x < S; x++) {
            const si = ((row * S + y) * im.width + col * S + x) * 4
            const oi = ((oy + y) * out.width + ox + x) * 4
            od.data.set(sd.subarray(si, si + 4), oi)
          }
        // пиджак вниз: каждый столбец тянем цветом нижней строки, по краям чуть темнее — складки
        for (let x = 0; x < S; x++) {
          const si = ((row * S + S - 1) * im.width + col * S + x) * 4
          if (sd[si + 3] < 128) continue
          for (let y = 0; y < EXT; y++) {
            const oi = ((oy + S + y) * out.width + ox + x) * 4
            od.data.set(sd.subarray(si, si + 4), oi)
          }
        }
      }
    og.putImageData(od, 0, 0)

    // цвета для рук: пиджак — у нижнего края портрета, кожа — середина лица
    const jackets = common(sd, im.width, 4, S - 6, 30, S).concat(common(sd, im.width, 66, S - 6, 92, S))
    const jacket = jackets[0] ?? '#394a50'
    const jacketDark = jackets.find((h) => lum(h) < lum(jacket) - 12) ?? '#202e37'
    const skins = common(sd, im.width, 36, 44, 60, 62).filter((h) => {
      const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16)
      return r > g && g > b && r - b > 40
    })
    const skin = skins[0] ?? '#d7b594'
    const skinDark = skins.find((h) => lum(h) < lum(skin) - 10) ?? '#ad7757'

    // силуэт по первому кадру: откуда у этого человека растут плечи
    const left: number[] = []
    const right: number[] = []
    for (let y = 0; y < S; y++) {
      let a = S
      let b = -1
      for (let x = 0; x < S; x++)
        if (sd[(y * im.width + x) * 4 + 3] >= 128) {
          a = Math.min(a, x)
          b = x
        }
      left.push(a)
      right.push(b < 0 ? S - 1 - a : b)
    }
    const torso = { l: left[S - 1] < S ? left[S - 1] : 4, r: right[S - 1] >= 0 ? right[S - 1] : S - 5 }

    const bottom = sd.slice((S - 1) * im.width * 4, (S - 1) * im.width * 4 + S * 4)
    return { canvas: out, w: out.width, h: out.height, jacket, jacketDark, skin, skinDark, cuff: '#ebede9', left, right, torso, bottom }
  })
  sheets.set(id, p)
  return p
}

/**
 * Руки рисуем прямо на спрайте, отдельным слоем поверх пиджака: плечо идёт вниз по краю туловища,
 * у края стола локоть, предплечья сходятся вперёд, кисти сложены перед собой. Слой крутится вместе с телом,
 * поэтому руки не отрываются от плеч ни при каком повороте головы. Два кадра — спокойно и жест ладонью.
 * Строки считаем в точках спрайта: 0 — верх портрета, S — низ нарисованного бюста, стол — около S + 16.
 */
function armsTexture(s: Sheet, gesture: boolean) {
  const W = S
  const c = document.createElement('canvas')
  c.width = W
  c.height = S + EXT
  const g = c.getContext('2d')!
  const R = (x: number, y: number, w: number, h: number, col: string) => {
    if (w <= 0 || h <= 0) return
    g.fillStyle = col
    g.fillRect(x, y, w, h)
  }
  const cx = Math.round((s.torso.l + s.torso.r + 1) / 2)
  const TOP = S - 12 // отсюда плечо видно сбоку от туловища
  const ELBOW = S + 26 // локоть — уже под краем стола
  const FORE = S + 12 // верх предплечья
  const WRIST = S + 23 // низ кисти: из-за дальнего края стола видно примерно до S + 24
  const HAND = 11 // от середины до манжеты

  // u — расстояние от внешнего края спрайта: правую руку рисуем тем же кодом зеркально
  const arm = (side: -1 | 1, lift: number) => {
    const Ru = (u: number, y: number, w: number, h: number, col: string) => R(side < 0 ? u : W - u - w, y, w, h, col)
    const edge = side < 0 ? s.torso.l : W - 1 - s.torso.r
    const end = cx - (side < 0 ? 0 : W - 2 * cx) - HAND // u, где рукав кончается
    // плечо и рукав вниз по краю туловища; кромки темнее — рукав отделяется от пиджака
    for (let y = TOP; y < ELBOW; y++) {
      const sil = y < S ? (side < 0 ? s.left[y] : W - 1 - s.right[y]) : edge
      const u0 = Math.max(edge, sil)
      const w = 12 - (u0 - edge)
      if (w < 4) continue
      Ru(u0, y, w, 1, s.jacket)
      Ru(u0, y, 1, 1, s.jacketDark)
      Ru(u0 + w - 1, y, 1, 1, s.jacketDark)
    }
    // предплечье: от локтя вперёд и к середине; к нам оно укорочено, поэтому это полоса у края стола
    const top = FORE - lift
    const bot = WRIST - lift
    for (let y = top; y < bot; y++) {
      const u0 = edge + 3 + Math.round((1 - (y - top) / (bot - top)) * 7)
      Ru(u0, y, end - u0, 1, s.jacket)
    }
    Ru(edge + 10, top, end - edge - 10, 1, s.jacketDark) // складка сверху
    Ru(edge + 3, bot - 1, end - edge - 3, 1, s.jacketDark) // тень снизу
    Ru(end - 2, top + 1, 2, bot - top - 2, s.cuff) // манжета
  }
  arm(-1, 0)
  arm(1, gesture ? 4 : 0)

  // кисти: левая лежит, правая накрывает её сверху; в жесте правая приподнимается — человек объясняет
  const hand = (x: number, y: number, w: number, h: number) => {
    R(x, y, w, h, s.skin)
    R(x, y + h - 1, w, 1, s.skinDark)
  }
  const L = cx - HAND
  hand(L, FORE + 2, 10, WRIST - FORE - 3)
  for (let k = 0; k < 3; k++) R(L + 3 + k * 2, WRIST - 4, 1, 2, s.skinDark)
  if (gesture) {
    // правая чуть приподнята и отошла от левой — ладонь раскрыта
    const x = cx + 1
    hand(x, FORE - 3, HAND - 1, WRIST - FORE - 3)
    for (let k = 0; k < 4; k++) R(x + 1 + k * 2, FORE - 5, 1, 2, s.skin)
    R(x, FORE - 3, 1, WRIST - FORE - 4, s.skinDark)
  } else {
    const x = cx - 3
    hand(x, FORE + 1, HAND + 3, WRIST - FORE - 2)
    R(x, FORE + 1, 1, WRIST - FORE - 3, s.skinDark)
    for (let k = 0; k < 3; k++) R(x + 4 + k * 2, FORE + 4, 1, 3, s.skinDark)
  }
  const t = new CanvasTexture(c)
  t.magFilter = NearestFilter
  t.minFilter = LinearMipmapLinearFilter
  return t
}

/** Ниже портрета у вставшего: торс до пояса, ноги, обувь — в точках спрайта. */
const TORSO = 44
const LEGS = 120
const SHOE = 6
const LOW = TORSO + LEGS + SHOE
/** низ портрета у стоящего — над полом, м */
const STAND_BOTTOM = LOW * M
/** середина лица сидящего собеседника — от неё считается, насколько поднять взгляд на вставшего */
export const SEATED_FACE_Y = BUST_BOTTOM + S * M * 0.6
const WP = 2
const FW = S + WP * 2
/** шаг: кадр ног меняется через столько метров пути */
const STRIDE = 0.34

/** Цвет темнее на долю k. */
function darker(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16)
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - k)))
  return `rgb(${c.join(',')})`
}

/**
 * Тот, кто встал и уходит, — во весь рост: торс продолжает нижнюю строку портрета и сужается к поясу, руки висят
 * вдоль него, ниже брюки (у женщин — юбка и тёмные колготки) и обувь. Три кадра: стоит, шаг левой, шаг правой
 * (поднятая нога короче на 5 точек).
 */
function walkerTexture(s: Sheet, female: boolean) {
  const c = document.createElement('canvas')
  c.width = FW * 3
  c.height = LOW + WP * 2
  const g = c.getContext('2d')!
  const cx = Math.round((s.torso.l + s.torso.r + 1) / 2)
  const legs = female ? '#341c27' : s.jacketDark
  const shoe = '#10141f'
  for (let f = 0; f < 3; f++) {
    const R = (x: number, y: number, w: number, h: number, col: string) => {
      if (w <= 0 || h <= 0) return
      g.fillStyle = col
      g.fillRect(f * FW + WP + x, WP + y, w, h)
    }
    // торс: столбцы — цветами нижней строки портрета, края сходятся к поясу
    for (let y = 0; y < TORSO; y++) {
      const k = y / (TORSO - 1)
      const l = Math.round(s.torso.l + (cx - 24 - s.torso.l) * k)
      const r = Math.round(s.torso.r + (cx + 23 - s.torso.r) * k)
      for (let x = l; x <= r; x++) {
        const i = x * 4
        if (s.bottom[i + 3] < 128) continue
        R(x, y, 1, 1, `rgb(${s.bottom[i]},${s.bottom[i + 1]},${s.bottom[i + 2]})`)
      }
    }
    R(cx - 24, TORSO - 1, 48, 1, s.jacketDark) // низ пиджака
    // руки висят от плеч вдоль торса; поднятая на шаге сторона — рука чуть вперёд (на точку выше)
    for (const side of [-1, 1] as const) {
      const lift = (f === 1 && side === 1) || (f === 2 && side === -1) ? 1 : 0
      const x0 = side < 0 ? s.torso.l : s.torso.r - 9
      const len = TORSO - 4 - lift
      R(x0, 0, 10, len, side < 0 ? s.jacket : s.jacketDark)
      R(side < 0 ? x0 + 9 : x0, 2, 1, len - 2, darker(s.jacketDark, 0.3))
      R(x0 + 1, len, 8, 2, s.cuff)
      R(x0 + 1, len + 2, 8, 7, s.skin)
      R(x0 + 1, len + 8, 8, 1, s.skinDark)
    }
    // ноги: у мужчин брюки цветом тени пиджака, у женщин — юбка до колен и колготки
    let top = TORSO
    if (female) {
      for (let y = 0; y < 34; y++) {
        const w = 24 + Math.round(y / 8)
        R(cx - w, TORSO + y, w * 2, 1, y === 33 ? darker(s.jacketDark, 0.3) : s.jacketDark)
      }
      top = TORSO + 34
    }
    const half = female ? 9 : 18
    const gap = female ? 4 : 3
    for (const side of [-1, 1] as const) {
      const up = (f === 1 && side === -1) || (f === 2 && side === 1) ? 5 : 0
      const x = side < 0 ? cx - gap - half : cx + gap
      const bottom = LOW - SHOE - up
      R(x, top, half, bottom - top, legs)
      R(side < 0 ? x : x + half - 1, top, 1, bottom - top, darker(female ? '#341c27' : s.jacketDark, 0.35))
      // обувь носком наружу
      const sw = half + (female ? 3 : 4)
      const sx = side < 0 ? x - (sw - half) : x
      R(sx, bottom, sw, SHOE, shoe)
      R(sx + 1, bottom, sw - 2, 1, '#202e37')
    }
  }
  const t = new CanvasTexture(c)
  t.magFilter = NearestFilter
  t.minFilter = LinearMipmapLinearFilter
  return t
}

function spriteMaterial(tex: Texture) {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      map: { value: tex },
      frame: { value: [0, 0, 1, 1] },
      tint: { value: new Vector3(1, 1, 1) },
      flip: { value: 0 },
    },
    side: DoubleSide,
  })
}

export type Gaze = 'you' | 'table' | 'down'

export interface PersonOpts {
  id: PortraitId
  x: number
  z: number
  /** собеседник: всегда лицом к нам, говорит; массовка — молчит */
  lead?: boolean
  /** куда повёрнут, когда не смотрит на нас: точка на столе */
  focus?: { x: number; z: number }
  /** собеседнику — как уйти из этой комнаты и какой дверью (exit.ts, RoomBuild.door) */
  exit?: ExitPlan
  door?: (open: number) => void
}

export class Person {
  readonly group = new Group()
  readonly id: PortraitId
  readonly lead: boolean
  private body: Mesh<PlaneGeometry, ShaderMaterial> | null = null
  private hands: Mesh<PlaneGeometry, ShaderMaterial> | null = null
  private handFrames: Texture[] = []
  private sheet: Sheet | null = null
  private tex: Texture | null = null
  private disposed = false
  private focus: { x: number; z: number }
  emotion: PortraitEmotion = 'neutral'
  talking = false
  gaze: Gaze = 'you'
  private frame: PortraitFrame = 'idle'
  private blinkAt = 1 + Math.random() * 3
  private blinkEnd = 0
  private talkFlip = 0
  private gazeUntil = 0
  private turn = 0
  private facing: number
  private jolt = 0
  private prevEmotion: PortraitEmotion = 'neutral'
  /** уход: секунды с начала (встаёт) и секунды ходьбы (0 — ещё стоит у стола, договаривает) */
  private gone = 0
  private walk = 0
  private readonly exit?: ExitPlan
  private readonly door?: (open: number) => void
  /** во весь рост: голова из листа портретов и торс с ногами */
  private walker: Group | null = null
  private walkerHead: Mesh<PlaneGeometry, ShaderMaterial> | null = null
  private walkerBody: Mesh<PlaneGeometry, ShaderMaterial> | null = null
  private walkerTex: Texture | null = null
  /** где сейчас лицо уходящего (мир) — за ним поворачивается голова игрока */
  readonly exitAt = new Vector3()
  /** встал и ещё виден — игрок смотрит на него */
  tracking = false
  /** идёт (не стоит у стола) */
  walking = false
  /** ушёл совсем: скрылся, дверь за ним закрылась */
  exited = false
  /** насколько открыта дверь, в которую он уходит (для прогонов) */
  doorOpen = 0
  leaving = false
  flip = false

  constructor(o: PersonOpts) {
    this.id = o.id
    this.lead = !!o.lead
    this.focus = o.focus ?? { x: 0, z: -0.3 }
    this.exit = o.exit
    this.door = o.door
    this.facing = this.turn = seatYaw(o.x)
    this.group.position.set(o.x + Math.sin(this.facing) * SEATED_FORWARD, 0, o.z + Math.cos(this.facing) * SEATED_FORWARD)
    loadSheet(o.id).then((s) => this.build(s))
  }

  get ready() {
    return !!this.body
  }

  private build(s: Sheet) {
    if (this.disposed) return
    this.sheet = s
    const tex = (this.tex = new CanvasTexture(s.canvas))
    tex.magFilter = NearestFilter
    tex.minFilter = LinearMipmapLinearFilter
    const h = (S + EXT) * M
    const geo = new PlaneGeometry(S * M, h)
    geo.translate(0, h / 2, 0)
    this.body = new Mesh(geo, spriteMaterial(tex))
    this.body.position.y = BUST_BOTTOM - EXT * M
    this.group.add(this.body)

    // руки — слой на том же спрайте чуть ближе к нам: крутится и встаёт вместе с телом
    this.handFrames = [armsTexture(s, false), armsTexture(s, true)]
    this.hands = new Mesh(geo, spriteMaterial(this.handFrames[0]))
    this.hands.position.z = 0.004
    this.body.add(this.hands)

    // собеседник, который может уйти, — ещё и во весь рост: голова того же листа, торс и ноги своей текстурой
    if (this.exit) {
      const w = (this.walker = new Group())
      const head = new PlaneGeometry(S * M, S * M).translate(0, (S * M) / 2, 0)
      this.walkerHead = new Mesh(head, spriteMaterial(tex))
      this.walkerHead.position.y = STAND_BOTTOM
      this.walkerTex = walkerTexture(s, PORTRAITS[this.id].female)
      const low = new PlaneGeometry(S * M, LOW * M).translate(0, (LOW * M) / 2, 0)
      this.walkerBody = new Mesh(low, spriteMaterial(this.walkerTex))
      w.add(this.walkerHead, this.walkerBody)
      w.visible = false
      this.group.add(w)
    }
  }

  setFrameUV() {
    if (!this.body || !this.sheet) return
    const s = this.sheet
    const row = EMOTIONS.indexOf(spriteEmotion(this.emotion))
    const col = FRAMES[this.frame]
    const u0 = (col * CW + PAD) / s.w
    // CanvasTexture переворачивает по Y: строка сверху листа — большие v
    const v0 = 1 - (row * CH + PAD + S + EXT) / s.h
    this.body.material.uniforms.frame.value = [u0, v0, S / s.w, (S + EXT) / s.h]
    this.body.material.uniforms.flip.value = this.flip ? 1 : 0
    // голова вставшего — только портрет, без пиджака под стол
    if (this.walkerHead) this.walkerHead.material.uniforms.frame.value = [u0, 1 - (row * CH + PAD + S) / s.h, S / s.w, S / s.h]
  }

  update(t: number, dt: number, cam: Camera, stir: boolean) {
    if (!this.body) return
    // кадр: рот, моргание, «смотрит в бумаги» — это моргание подольше
    // у собеседника, пока звучит голос, рот — по громкости звука; нет голоса — по печати текста
    const lip = this.lead ? lipState() : 'off'
    if (lip !== 'off') {
      this.frame = lip === 'open' ? 'talk' : 'idle'
    } else if (this.talking) {
      this.talkFlip -= dt
      if (this.talkFlip <= 0) {
        this.talkFlip = 0.11
        this.frame = this.frame === 'talk' ? 'idle' : 'talk'
      }
    } else if (this.gaze === 'down') {
      this.frame = 'blink'
    } else if (t >= this.blinkAt) {
      this.frame = 'blink'
      this.blinkEnd = t + 0.12
      this.blinkAt = t + 2.2 + Math.random() * 3.4
    } else if (this.frame !== 'idle' && t >= this.blinkEnd) {
      this.frame = 'idle'
    }

    // массовка сама решает, куда смотреть; stir — в комнате что-то происходит, все смотрят на говорящего
    if (!this.lead && t >= this.gazeUntil && !stir) {
      const r = Math.random()
      this.gaze = r < 0.28 ? 'you' : r < 0.55 ? 'down' : 'table'
      this.gazeUntil = t + (this.gaze === 'down' ? 2 + Math.random() * 3 : 2.5 + Math.random() * 5)
    }

    if (this.prevEmotion !== this.emotion) {
      this.prevEmotion = this.emotion
      this.jolt = 0.14
    }
    this.jolt = Math.max(0, this.jolt - dt)
    this.setFrameUV()

    // поворот: к нам (биллборд) или к столу; ограничиваем, чтобы плоский спрайт не превращался в линию
    const p = this.group.position
    const cp = cam.position
    const toCam = Math.atan2(cp.x - p.x, cp.z - p.z)
    const toFocus = Math.atan2(this.focus.x - p.x, this.focus.z - p.z)
    let want = toCam
    if (this.gaze === 'table' || this.gaze === 'down') {
      const d = MathUtils.euclideanModulo(toFocus - toCam + Math.PI, Math.PI * 2) - Math.PI
      want = toCam + MathUtils.clamp(d, -0.75, 0.75)
    }
    want = seatedTurn(want, this.facing)
    const d = MathUtils.euclideanModulo(want - this.turn + Math.PI, Math.PI * 2) - Math.PI
    this.turn += d * (1 - Math.exp(-dt * (this.lead ? 20 : 5)))
    this.body.rotation.y = this.turn
    this.body.rotation.z = emotionTilt(this.emotion) * Math.PI / 180
    this.body.position.y = BUST_BOTTOM - EXT * M + (this.jolt > 0 ? M : 0)

    this.updateExit(dt, cam, lip !== 'off' || this.talking)

    // руки: во время речи иногда жест (речь — печать текста или голос, который уже звучит, пока ход ещё идёт)
    if (this.hands && this.handFrames.length) {
      const gesture = (this.talking || lip !== 'off') && Math.sin(t * 2.3) > 0.35
      const u = this.hands.material.uniforms
      u.map.value = this.handFrames[gesture ? 1 : 0]
      u.flip.value = this.flip ? 1 : 0
    }
  }

  /**
   * Уход (exit.ts): встаёт, договаривает (не дольше 3,5 с), идёт по пути к двери, темнеет в проёме и скрывается;
   * дверь комнаты открывается перед ним и закрывается за ним. Всё время к нам лицом, как вырезка-биллборд.
   * Отменили уход (переиграли ход) — сразу снова сидит, дверь закрыта.
   */
  private updateExit(dt: number, cam: Camera, speaking: boolean) {
    const w = this.walker
    if (!this.exit || !w || !this.body) return
    if (!this.leaving) {
      if (this.gone) this.door?.(0)
      this.gone = this.walk = this.doorOpen = 0
      this.walking = this.tracking = this.exited = false
      w.visible = false
      this.body.visible = true
      return
    }
    this.gone += dt
    if (!this.walk && this.gone > STAND_S + 0.3 && (!speaking || this.gone > 3.5)) this.walk = 1e-6
    else if (this.walk) this.walk += dt
    const f = exitFrame(this.exit, this.gone, this.walk)
    this.door?.(f.door)
    this.doorOpen = f.door
    this.body.visible = false
    w.visible = !f.gone
    this.walking = this.walk > 0 && !f.gone
    this.tracking = !f.gone
    this.exited = exitDone(this.exit, this.walk)
    // ноги: на ходу — кадр шага по пройденному пути и лёгкое покачивание вверх-вниз
    const phase = f.s / STRIDE
    const bob = f.moving ? Math.abs(Math.sin(phase * Math.PI)) * 0.018 : 0
    const p = this.group.position
    w.position.set(f.x - p.x, (BUST_BOTTOM - STAND_BOTTOM) * (1 - f.stand) + bob, f.z - p.z)
    this.exitAt.set(f.x, w.position.y + STAND_BOTTOM + S * M * 0.6, f.z)
    // лицом к нам: биллборд по своему месту на полу, а не по стулу
    w.rotation.y = Math.atan2(cam.position.x - f.x, cam.position.z - f.z)
    w.rotation.z = emotionTilt(this.emotion) * Math.PI / 180 * (1 - f.stand)
    const col = f.moving ? 1 + (Math.floor(phase) % 2) : 0
    const u = this.walkerBody!.material.uniforms
    u.frame.value = [(col * FW + WP) / (FW * 3), WP / (LOW + WP * 2), S / (FW * 3), LOW / (LOW + WP * 2)]
    // в тёмном проёме (и на вечерней улице за витриной) темнеет
    const k = 1 - f.dark * 0.85
    for (const m of [this.walkerHead!, this.walkerBody!]) {
      m.material.uniforms.tint.value.set(k, k, k * 1.05)
      m.material.uniforms.flip.value = this.flip ? 1 : 0
    }
  }

  /** Точка «над головой» и «под подбородком» — для реплики и рентгена. */
  anchor(which: 'head' | 'chin' | 'chest', out = new Vector3()) {
    const y = { head: BUST_BOTTOM + (S - 8) * M, chin: BUST_BOTTOM + 26 * M, chest: BUST_BOTTOM + 10 * M }[which]
    return out.set(this.group.position.x, y, this.group.position.z)
  }

  dispose() {
    this.disposed = true
    this.tex?.dispose()
    this.body?.geometry.dispose()
    this.body?.material.dispose()
    this.hands?.material.dispose()
    for (const t of this.handFrames) t.dispose()
    this.walkerTex?.dispose()
    for (const m of [this.walkerHead, this.walkerBody]) {
      m?.geometry.dispose()
      m?.material.dispose()
    }
  }
}
