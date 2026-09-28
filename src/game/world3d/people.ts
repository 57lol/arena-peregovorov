// Люди за столом: плоские спрайты бюстов из тех же листов, что в 2D (96×96, 6 эмоций × 3 кадра).
// Лист при загрузке «достраивается» вниз — пиджак продолжается под край стола, чтобы тело не обрывалось в воздухе.
// Руки лежат на столе отдельной плоскостью, цвет рукавов и кожи берём с самого портрета.
// Собеседник всегда смотрит на нас. Массовка молчит: моргает, смотрит в бумаги, поворачивается к говорящему
// и иногда поглядывает на нас. Плоский спрайт при повороте сужается — это и читается как поворот головы.

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
import { EMOTIONS, FRAMES, PORTRAITS, PORTRAIT_SIZE, type PortraitEmotion, type PortraitFrame, type PortraitId } from '../ui/assets'
import { SPRITE_M_PER_PX as M, TABLE } from './layout'

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
  tex: Texture
  w: number
  h: number
  jacket: string
  jacketDark: string
  skin: string
  skinDark: string
  cuff: string
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

    const tex = new CanvasTexture(out)
    tex.magFilter = NearestFilter
    tex.minFilter = LinearMipmapLinearFilter
    tex.generateMipmaps = true
    return { tex, w: out.width, h: out.height, jacket, jacketDark, skin, skinDark, cuff: '#ebede9' }
  })
  sheets.set(id, p)
  return p
}

/** Руки на столе: предплечья в рукавах, манжеты, кисти. Два кадра — спокойно и жест. */
function handsTexture(s: Sheet, gesture: boolean) {
  const W = 60
  const H = 22
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const R = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col
    g.fillRect(x, y, w, h)
  }
  const arm = (x: number, mirror: boolean, lift: number) => {
    // рукав от локтя (верх текстуры — сторона человека) к кисти
    R(x, 0, 13, 12 - lift, s.jacket)
    R(mirror ? x + 12 : x, 0, 1, 12 - lift, s.jacketDark)
    R(x, 11 - lift, 13, 1, s.jacketDark)
    R(x + 1, 12 - lift, 11, 2, s.cuff)
    // кисть: ладонь вниз, пальцы к нам
    R(x + 1, 14 - lift, 11, 5, s.skin)
    R(x + 2, 19 - lift, 9, 1, s.skin)
    R(mirror ? x + 1 : x + 10, 14 - lift, 2, 4, s.skinDark)
    for (let k = 0; k < 3; k++) R(x + 3 + k * 3, 17 - lift, 1, 3, s.skinDark)
  }
  arm(10, false, 0)
  arm(37, true, gesture ? 3 : 0)
  if (gesture) {
    // ладонь приподнята и развёрнута — «смотрите»
    R(38, 12, 11, 1, s.skinDark)
  }
  const t = new CanvasTexture(c)
  t.magFilter = NearestFilter
  t.minFilter = LinearMipmapLinearFilter
  return { tex: t, w: W, h: H }
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
}

export class Person {
  readonly group = new Group()
  readonly id: PortraitId
  readonly lead: boolean
  private body: Mesh<PlaneGeometry, ShaderMaterial> | null = null
  private hands: Mesh<PlaneGeometry, ShaderMaterial> | null = null
  private handFrames: Texture[] = []
  private sheet: Sheet | null = null
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
  private jolt = 0
  private prevEmotion: PortraitEmotion = 'neutral'
  private gone = 0
  leaving = false
  flip = false

  constructor(o: PersonOpts) {
    this.id = o.id
    this.lead = !!o.lead
    this.focus = o.focus ?? { x: 0, z: -0.3 }
    this.group.position.set(o.x, 0, o.z)
    loadSheet(o.id).then((s) => this.build(s))
  }

  get ready() {
    return !!this.body
  }

  private build(s: Sheet) {
    this.sheet = s
    const h = (S + EXT) * M
    const geo = new PlaneGeometry(S * M, h)
    geo.translate(0, h / 2, 0)
    this.body = new Mesh(geo, spriteMaterial(s.tex))
    this.body.position.y = BUST_BOTTOM - EXT * M
    this.group.add(this.body)

    const a = handsTexture(s, false)
    const b = handsTexture(s, true)
    this.handFrames = [a.tex, b.tex]
    const hw = a.w * M
    const hd = 0.25
    const hg = new PlaneGeometry(hw, hd)
    const hm = spriteMaterial(a.tex)
    hm.polygonOffset = true
    hm.polygonOffsetFactor = -2
    this.hands = new Mesh(hg, hm)
    this.hands.rotation.x = -Math.PI / 2
    this.group.add(this.hands)
    this.placeHands()
  }

  /** Руки — на столе перед человеком: у длинных сторон к нам, в торцах — к середине стола.
   * Кисти лежат на столешнице, предплечья поднимаются к локтям: плашмя лист виден слишком косо и читается как брусок. */
  private placeHands() {
    if (!this.hands) return
    const p = this.group.position
    const end = Math.abs(p.x) > TABLE.halfLen
    const yaw = end ? (p.x < 0 ? Math.PI / 2 : -Math.PI / 2) : 0
    const toEdge = end ? Math.abs(p.x) - TABLE.halfLen + 0.13 : Math.abs(TABLE.far - p.z) + 0.13
    const hd = this.hands.geometry.parameters.height
    const tilt = 38 * MathUtils.DEG2RAD
    // ближний край (кисти) остаётся на столе, дальний (локти) поднимается к человеку
    const up = (hd / 2) * Math.sin(tilt)
    const back = (hd / 2) * (1 - Math.cos(tilt))
    const dx = Math.sin(yaw)
    const dz = Math.cos(yaw)
    this.hands.position.set(dx * (toEdge + back), TABLE.y + 0.003 + up, dz * (toEdge + back))
    this.hands.rotation.set(0, yaw, 0, 'YXZ')
    this.hands.rotateX(-Math.PI / 2 + tilt)
  }

  setFrameUV() {
    if (!this.body || !this.sheet) return
    const s = this.sheet
    const row = EMOTIONS.indexOf(this.emotion)
    const col = FRAMES[this.frame]
    const u0 = (col * CW + PAD) / s.w
    // CanvasTexture переворачивает по Y: строка сверху листа — большие v
    const v0 = 1 - (row * CH + PAD + S + EXT) / s.h
    this.body.material.uniforms.frame.value = [u0, v0, S / s.w, (S + EXT) / s.h]
    this.body.material.uniforms.flip.value = this.flip ? 1 : 0
  }

  update(t: number, dt: number, cam: Camera, stir: boolean) {
    if (!this.body) return
    // кадр: рот, моргание, «смотрит в бумаги» — это моргание подольше
    if (this.talking) {
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
    const d = MathUtils.euclideanModulo(want - this.turn + Math.PI, Math.PI * 2) - Math.PI
    this.turn += d * (1 - Math.exp(-dt * (this.lead ? 20 : 5)))
    this.body.rotation.y = this.turn

    // уходит из-за стола: встаёт и уходит вбок
    if (this.leaving) {
      this.gone += dt
      // встаёт, отступает от стола за спины соседей и уходит к двери (она слева в обеих комнатах)
      const up = Math.min(1, this.gone / 0.5)
      const back = MathUtils.smoothstep(this.gone, 0.5, 1.1)
      const away = Math.max(0, this.gone - 0.9)
      this.body.position.y = BUST_BOTTOM - EXT * M + up * 0.3
      this.body.position.z = -back * 0.45
      this.body.position.x = -away * away * 1.6
      if (this.hands) this.hands.visible = false
      this.body.visible = this.gone < 2.8
    } else {
      this.body.position.y = BUST_BOTTOM - EXT * M + (this.jolt > 0 ? M : 0)
      this.body.position.x = 0
      this.body.position.z = 0
      this.gone = 0
      this.body.visible = true
      if (this.hands) this.hands.visible = true
    }

    // руки: во время речи иногда жест
    if (this.hands && this.handFrames.length) {
      const gesture = this.talking && Math.sin(t * 2.3) > 0.35
      this.hands.material.uniforms.map.value = this.handFrames[gesture ? 1 : 0]
    }
  }

  /** Точка «над головой» и «под подбородком» — для реплики и рентгена. */
  anchor(which: 'head' | 'chin' | 'chest', out = new Vector3()) {
    const y = { head: BUST_BOTTOM + (S - 8) * M, chin: BUST_BOTTOM + 26 * M, chest: BUST_BOTTOM + 10 * M }[which]
    return out.set(this.group.position.x, y, this.group.position.z)
  }

  dispose() {
    this.body?.geometry.dispose()
    this.body?.material.dispose()
    this.hands?.geometry.dispose()
    this.hands?.material.dispose()
    for (const t of this.handFrames) t.dispose()
  }
}
