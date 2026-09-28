// Бумаги на столе: мой блокнот, карточка с делами и листок с предложением.
// Каждая бумага — пиксельный лист в 3D (свет, тень, дизеринг) и поверх него DOM-страница в той же плоскости
// (CSS3DRenderer): кнопки и стрелки блокнота нажимаются прямо на столе.
// Когда сидим прямо, листы лежат плашмя и DOM прячется — видна исписанная бумага. Когда склоняемся к столу,
// каждый лист чуть приподнимается дальним краем к нам (ровно настолько, чтобы читалось), и страница проявляется.
// На телефоне лист можно взять в руки: он поднимается со стола и встаёт перед глазами во весь экран.

import {
  CanvasTexture,
  Group,
  LinearMipmapLinearFilter,
  MathUtils,
  Matrix4,
  Mesh,
  NearestFilter,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type PerspectiveCamera,
  type Texture,
} from 'three'
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import { TABLE } from './layout'

export type PaperId = 'notebook' | 'card' | 'slip'

interface Spot {
  x: number
  z: number
  w: number
  h: number
  /** поворот на столе, градусы */
  rot: number
}

/** Раскладка: ноутбук — блокнот слева, дела справа, листок дальше по центру; телефон — листок далеко, блокнот у нас. */
const WIDE: Record<PaperId, Spot> = {
  notebook: { x: -0.14, z: -0.05, w: 0.26, h: 0.32, rot: 2 },
  card: { x: 0.22, z: -0.01, w: 0.15, h: 0.2, rot: -4 },
  slip: { x: 0.12, z: -0.36, w: 0.2, h: 0.17, rot: 3 },
}
const TALL: Record<PaperId, Spot> = {
  notebook: { x: -0.04, z: 0.06, w: 0.26, h: 0.36, rot: 3 },
  card: { x: 0.15, z: -0.2, w: 0.14, h: 0.19, rot: -7 },
  slip: { x: -0.03, z: -0.46, w: 0.22, h: 0.24, rot: 2 },
}

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPos = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
// бумага не дизерится (альфа 0.5) и не синеет в рентгене; свет — от лампы над столом, мягко к краям
const FRAG = /* glsl */ `
uniform sampler2D map;
uniform float light;
uniform float opacity;
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.5 || opacity < 0.5) discard;
  float l = light * (1.0 - 0.18 * clamp(length(vPos.xz - vec2(0.0, -0.2)) - 0.2, 0.0, 1.0));
  gl_FragColor = vec4(c.rgb * l, 0.5);
}
`

type Draw = (R: (x: number, y: number, w: number, h: number, c: string) => void) => void

function pixelTexture(W: number, H: number, draw: Draw): Texture {
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!
  draw((x, y, w, h, c) => {
    g.fillStyle = c
    g.fillRect(x, y, w, h)
  })
  const t = new CanvasTexture(cv)
  t.magFilter = NearestFilter
  t.minFilter = LinearMipmapLinearFilter
  return t
}

// «Почерк»: строки из штрихов разной длины — издалека читается как исписанная бумага
function scribble(R: Parameters<Draw>[0], x0: number, x1: number, y0: number, y1: number, step: number, color: string) {
  for (let y = y0; y <= y1; y += step) {
    let x = x0
    while (x < x1 - 2) {
      const w = Math.min(x1 - x, 2 + Math.floor(Math.random() * 6))
      R(x, y, w, 1, color)
      x += w + 1 + (Math.random() < 0.2 ? 2 : 0)
    }
  }
}

const PAPER = '#ebede9'
const PAPER_2 = '#c7cfcc'
const GRID = '#a8b5b2'
const INK = '#394a50'
const PEN = '#3c5e8b'
const CORAL = '#cf573c'

function textures(id: PaperId, W: number, H: number): [Texture, Texture] {
  const base: Draw = (R) => {
    R(0, 0, W, H, id === 'card' ? '#e7d5b3' : PAPER)
    R(0, H - 1, W, 1, PAPER_2)
    R(W - 1, 0, 1, H, PAPER_2)
    if (id === 'notebook') {
      for (let x = 3; x < W; x += 4) R(x, 4, 1, H - 4, '#d7dcda')
      for (let y = 7; y < H; y += 4) R(0, y, W, 1, '#d7dcda')
      R(W - 8, 4, 1, H - 4, CORAL)
      // пружина сверху
      for (let x = 3; x < W - 2; x += 4) {
        R(x, 0, 2, 3, INK)
        R(x, 3, 2, 1, GRID)
      }
    } else if (id === 'card') {
      R(0, 3, W, 1, CORAL)
      for (let y = 7; y < H; y += 4) R(1, y, W - 2, 1, '#c09473')
    } else {
      R(0, 0, W, 2, PAPER_2)
    }
  }
  const blank = pixelTexture(W, H, base)
  const written = pixelTexture(W, H, (R) => {
    base(R)
    if (id === 'notebook') {
      R(4, 6, 20, 2, PEN)
      scribble(R, 4, W - 12, 12, H - 10, 4, INK)
      for (let y = 12; y < H - 10; y += 8) R(W - 14, y, 4, 2, PEN)
      R(4, H - 7, 18, 4, '#de9e41')
    } else if (id === 'card') {
      for (let y = 8; y < H - 3; y += 4) {
        R(2, y - 1, 2, 2, INK)
        R(6, y, 6 + Math.floor(Math.random() * 10), 1, INK)
      }
    } else {
      R(3, 4, 16, 1, INK)
      scribble(R, 3, W - 4, 8, H - 8, 3, INK)
      R(W - 14, H - 5, 10, 1, PEN)
      R(W - 12, H - 6, 3, 1, PEN)
    }
  })
  return [blank, written]
}

interface Sheet {
  id: PaperId
  root: Group
  mesh: Mesh<PlaneGeometry, ShaderMaterial>
  shadow: Mesh<PlaneGeometry, ShaderMaterial>
  css: CSS3DObject
  host: HTMLDivElement
  tex: [Texture, Texture]
  spot: Spot
  /** лист ещё едет по столу (новое предложение): 0..1 */
  slide: number
  slideFrom: Vector3
  /** в руках: 0 — на столе, 1 — перед глазами */
  held: number
  tilt: number
  /** CSS-размер страницы, пиксели */
  pxW: number
  pxH: number
  /** страница сейчас видна (0..1) */
  shown: number
}

const TEX_SIZE: Record<PaperId, [number, number]> = { notebook: [60, 70], card: [34, 46], slip: [44, 36] }
const UP = new Vector3(0, 1, 0)
const MAX_TILT = 30 * MathUtils.DEG2RAD

// рабочие переменные без выделения памяти в кадре
const vA = new Vector3()
const vB = new Vector3()
const vC = new Vector3()
const qA = new Quaternion()
const qB = new Quaternion()
const mA = new Matrix4()
const camX = new Vector3()
const camY = new Vector3()
const camZ = new Vector3()

export class Desk {
  readonly group = new Group()
  readonly sheets: Record<PaperId, Sheet>
  private tall = false
  /** лист, который держим в руках (телефон) */
  holding: PaperId | null = null
  /** лист с предложением на столе вообще есть */
  slipVisible = false

  constructor() {
    const mk = (id: PaperId): Sheet => {
      const spot = WIDE[id]
      const [tw, th] = TEX_SIZE[id]
      const tex = textures(id, tw, th)
      const mat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { map: { value: tex[1] }, light: { value: 1 }, opacity: { value: 1 } } })
      const mesh = new Mesh(new PlaneGeometry(1, 1), mat)
      mesh.rotation.x = -Math.PI / 2
      const shadowTex = pixelTexture(4, 4, (R) => R(0, 0, 4, 4, '#202e37'))
      const shadow = new Mesh(
        new PlaneGeometry(1, 1),
        new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { map: { value: shadowTex }, light: { value: 0.55 }, opacity: { value: 1 } } }),
      )
      shadow.rotation.x = -Math.PI / 2
      const host = document.createElement('div')
      host.className = `w3-paper w3-paper--${id}`
      host.dataset.paper = id
      const css = new CSS3DObject(host)
      css.rotation.x = -Math.PI / 2
      css.position.y = 0.0015
      const root = new Group()
      root.add(mesh, css)
      this.group.add(shadow, root)
      return { id, root, mesh, shadow, css, host, tex, spot, slide: 1, slideFrom: new Vector3(), held: 0, tilt: 0, pxW: 300, pxH: 300, shown: 0 }
    }
    this.sheets = { notebook: mk('notebook'), card: mk('card'), slip: mk('slip') }
    this.layout(false)
  }

  /** Разложить бумаги под ноутбук или телефон. pxPerM — CSS-пикселей в метре, когда склонились к столу. */
  layout(tall: boolean, pxPerM = 1500, screenW = 390) {
    this.tall = tall
    for (const s of Object.values(this.sheets)) {
      const spot = (tall ? TALL : WIDE)[s.id]
      s.spot = spot
      s.mesh.scale.set(spot.w, spot.h, 1)
      s.shadow.scale.set(spot.w, spot.h, 1)
      // страница — примерно того размера, каким лист виден на экране (на телефоне — в руках, почти во всю ширину)
      const w = tall ? Math.round(screenW * 0.92) : Math.max(Math.round(spot.w * pxPerM), s.id === 'notebook' ? 400 : s.id === 'slip' ? 300 : 220)
      s.pxW = w
      s.pxH = Math.round((w * spot.h) / spot.w)
      s.host.style.width = `${s.pxW}px`
      s.host.style.height = `${s.pxH}px`
      s.css.scale.setScalar(spot.w / s.pxW)
    }
  }

  get isTall() {
    return this.tall
  }

  /** Лист с предложением поехал по столу: от собеседника или от моего блокнота. */
  slideSlip(from: 'them' | 'me') {
    const s = this.sheets.slip
    s.slide = 0
    s.slideFrom.set(from === 'them' ? 0.05 : this.sheets.notebook.spot.x, 0, from === 'them' ? -0.78 : this.sheets.notebook.spot.z)
  }

  hold(id: PaperId | null) {
    this.holding = id
  }

  /** lean — насколько склонились над столом (0..1); cam — чтобы развернуть листы к глазам. */
  update(dt: number, lean: number, cam: PerspectiveCamera) {
    cam.matrixWorld.extractBasis(camX, camY, camZ)
    const tanH = Math.tan((cam.fov * MathUtils.DEG2RAD) / 2)
    for (const s of Object.values(this.sheets)) {
      const sp = s.spot
      const live = s.id !== 'slip' || this.slipVisible
      // лист едет по столу
      let bx = sp.x
      let bz = sp.z
      let rot = -sp.rot * MathUtils.DEG2RAD
      if (s.slide < 1) {
        s.slide = Math.min(1, s.slide + dt / 0.55)
        const k = 1 - (1 - s.slide) ** 3
        bx = MathUtils.lerp(s.slideFrom.x, sp.x, k)
        bz = MathUtils.lerp(s.slideFrom.z, sp.z, k)
        rot += (1 - k) * 25 * MathUtils.DEG2RAD
      }
      // наклон к глазам: сколько не хватает, чтобы лист смотрел на нас под углом ≤ 18°, но не больше 30°
      vA.set(bx, TABLE.y, bz)
      vB.copy(cam.position).sub(vA).normalize()
      const angle = Math.acos(MathUtils.clamp(vB.dot(UP), -1, 1))
      const want = MathUtils.clamp(angle - 18 * MathUtils.DEG2RAD, 0, MAX_TILT) * MathUtils.smoothstep(lean, 0.25, 0.9)
      s.tilt += (want - s.tilt) * (1 - Math.exp(-dt * 10))

      // на столе: поворот вокруг вертикали и подъём дальнего края вокруг ближнего
      qA.setFromAxisAngle(UP, rot)
      qB.setFromAxisAngle(vC.set(1, 0, 0), s.tilt)
      qA.multiply(qB)
      vA.set(0, (sp.h / 2) * Math.sin(s.tilt), sp.h / 2 - (sp.h / 2) * Math.cos(s.tilt)).applyAxisAngle(UP, rot)
      vA.x += bx
      vA.y += TABLE.y + 0.004
      vA.z += bz

      // в руках: перед камерой, лицом к ней, верх листа — вверх экрана
      const target = this.holding === s.id ? 1 : 0
      s.held += (target - s.held) * (1 - Math.exp(-dt * 9))
      if (Math.abs(s.held - target) < 0.002) s.held = target
      if (s.held > 0) {
        const aspect = cam.aspect
        const dW = sp.w / (2 * 0.9 * tanH * aspect)
        const dH = sp.h / (2 * 0.66 * tanH)
        const d = Math.max(dW, dH)
        vB.copy(cam.position).addScaledVector(camZ, -d).addScaledVector(camY, d * tanH * 0.12)
        mA.makeBasis(camX, camZ, vC.copy(camY).negate())
        qB.setFromRotationMatrix(mA)
        const k = s.held * s.held * (3 - 2 * s.held)
        vA.lerp(vB, k)
        qA.slerp(qB, k)
      }
      s.root.position.copy(vA)
      s.root.quaternion.copy(qA)
      s.root.visible = live

      // тень лежит на столе и тает, когда лист в руках
      s.shadow.position.set(bx + 0.006, TABLE.y + 0.0025, bz + 0.008)
      s.shadow.rotation.set(-Math.PI / 2, 0, rot)
      s.shadow.visible = live && s.held < 0.5

      // страницу видно, когда лист повёрнут к нам (в руках — всегда)
      s.root.updateMatrixWorld()
      vC.set(0, 1, 0).applyQuaternion(s.root.quaternion)
      vB.copy(cam.position).sub(s.root.position).normalize()
      const facing = vC.dot(vB)
      const forward = -camZ.dot(vB) // лист перед глазами, а не за спиной
      // когда один лист в руках, остальные страницы на столе прячем: DOM не знает глубины и лез бы поверх
      const other = this.holding !== null && this.holding !== s.id
      const shown = live && !other && forward < -0.2 ? Math.max(MathUtils.smoothstep(facing, 0.8, 0.9), s.held > 0.6 ? 1 : 0) : 0
      s.shown = shown
      s.host.style.opacity = String(shown)
      s.host.style.visibility = shown < 0.02 ? 'hidden' : 'visible'
      s.host.classList.toggle('is-live', shown > 0.6)
      s.host.classList.toggle('is-held', s.held > 0.5)
      s.mesh.material.uniforms.map.value = s.tex[shown > 0.35 ? 0 : 1]
    }
  }

  /** Центр листа в мире — для подписей над ним. */
  center(id: PaperId, out = new Vector3()) {
    return out.copy(this.sheets[id].root.position)
  }

  /** Что-нибудь держим в руках (для затемнения мира). */
  get heldAmount() {
    return Math.max(...Object.values(this.sheets).map((s) => s.held))
  }

  dispose() {
    for (const s of Object.values(this.sheets)) {
      s.mesh.geometry.dispose()
      s.mesh.material.dispose()
      s.shadow.geometry.dispose()
      s.shadow.material.dispose()
      s.tex.forEach((t) => t.dispose())
      s.host.remove()
    }
  }
}
