// «Пиксельное 3D»: сцена рендерится в маленькую текстуру (≈320–420 точек по ширине), потом один проход
// сводит каждую точку к ближайшему цвету Apollo с упорядоченным дизерингом Байера 4×4 — как на камере
// платформы из «Безопасного маршрута», только на GPU. Холст того же размера растягивается CSS без сглаживания.
//
// Альфа в кадре — флаг: мир пишет 1 (дизеринг полный), спрайты людей и бумаги пишут 0.5 (без дизеринга,
// чтобы нарисованные пиксели лиц не рябили).

import {
  Camera,
  ColorManagement,
  LinearSRGBColorSpace,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { RGB_OF } from './palette'

// Цвета материалов и текстур — как есть, без перевода в линейное пространство: свет считается «по-старому»,
// в гамме, и палитра проходит через кадр без сдвигов.
ColorManagement.enabled = false

const N = RGB_OF.length

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform vec3 pal[${N}];
uniform vec2 res;
uniform float spread;
uniform float vignette;
uniform float xray;
uniform float fade;
uniform float dim;
varying vec2 vUv;

float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float x = q.x, y = q.y;
  // матрица Байера 4×4, построчно
  float m = 0.0;
  if (y < 0.5) m = x < 0.5 ? 0.0 : x < 1.5 ? 8.0 : x < 2.5 ? 2.0 : 10.0;
  else if (y < 1.5) m = x < 0.5 ? 12.0 : x < 1.5 ? 4.0 : x < 2.5 ? 14.0 : 6.0;
  else if (y < 2.5) m = x < 0.5 ? 3.0 : x < 1.5 ? 11.0 : x < 2.5 ? 1.0 : 9.0;
  else m = x < 0.5 ? 15.0 : x < 1.5 ? 7.0 : x < 2.5 ? 13.0 : 5.0;
  return (m + 0.5) / 16.0;
}

vec3 nearest(vec3 c) {
  vec3 best = pal[0];
  float bd = 1e9;
  for (int i = 0; i < ${N}; i++) {
    vec3 d = c - pal[i];
    // «дешёвое» перцептивное расстояние: зелёный важнее, синий меньше
    float r = (c.r + pal[i].r) * 0.5;
    float dd = (2.0 + r) * d.r * d.r + 4.0 * d.g * d.g + (3.0 - r) * d.b * d.b;
    if (dd < bd) { bd = dd; best = pal[i]; }
  }
  return best;
}

void main() {
  vec4 s = texture2D(tScene, vUv);
  vec3 c = s.rgb;
  float world = step(0.75, s.a);
  vec2 p = vUv - 0.5;
  float v = 1.0 - vignette * dot(p, p) * 2.2;
  c *= mix(1.0, v, world * 0.85 + 0.15);
  if (xray > 0.0) {
    // рентген: мир уходит в холодную синеву, люди остаются живыми
    float l = dot(c, vec3(0.3, 0.55, 0.15));
    vec3 cold = mix(vec3(0.06, 0.08, 0.16), vec3(0.45, 0.75, 0.83), l);
    c = mix(c, cold, xray * world);
  }
  c *= 1.0 - fade;
  // лист в руках: мир за ним притухает, сам лист и люди — нет
  c *= 1.0 - dim * world;
  float b = bayer4(gl_FragCoord.xy) - 0.5;
  c += b * spread * mix(0.25, 1.0, world);
  gl_FragColor = vec4(nearest(clamp(c, 0.0, 1.0)), 1.0);
}
`

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export interface PostOptions {
  /** 0..1 — сила рентгена */
  xray?: number
  /** 0..1 — затемнение в чёрное */
  fade?: number
  /** 0..1 — притушить только мир (не людей и не бумаги) */
  dim?: number
}

export class PixelPipeline {
  readonly renderer: WebGLRenderer
  private target: WebGLRenderTarget
  private quad: Scene
  private quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private mat: ShaderMaterial
  w = 0
  h = 0

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false })
    this.renderer.setPixelRatio(1)
    this.renderer.outputColorSpace = LinearSRGBColorSpace
    this.renderer.setClearColor(0x10141f, 1)
    this.target = new WebGLRenderTarget(4, 4, { minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true })
    this.mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tScene: { value: this.target.texture },
        pal: { value: RGB_OF.map(([r, g, b]) => new Vector3(r / 255, g / 255, b / 255)) },
        res: { value: [4, 4] },
        spread: { value: 0.11 },
        vignette: { value: 0.0 },
        xray: { value: 0 },
        fade: { value: 0 },
        dim: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new Scene()
    this.quad.add(new Mesh(new PlaneGeometry(2, 2), this.mat))
  }

  /** Размер кадра в «игровых» точках. Холст — того же размера, растягивает его CSS. */
  setSize(w: number, h: number) {
    if (w === this.w && h === this.h) return
    this.w = w
    this.h = h
    this.renderer.setSize(w, h, false)
    this.target.setSize(w, h)
    this.mat.uniforms.res.value = [w, h]
  }

  render(scene: Scene, camera: Camera, o: PostOptions = {}) {
    this.mat.uniforms.xray.value = o.xray ?? 0
    this.mat.uniforms.fade.value = o.fade ?? 0
    this.mat.uniforms.dim.value = o.dim ?? 0
    const r = this.renderer
    r.setRenderTarget(this.target)
    r.setClearColor(0x10141f, 1)
    r.clear()
    r.render(scene, camera)
    r.setRenderTarget(null)
    r.render(this.quad, this.quadCam)
  }

  dispose() {
    this.target.dispose()
    this.mat.dispose()
    this.renderer.dispose()
  }
}

/** Есть ли WebGL вообще: без него — классический 2D-вид. */
export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}
