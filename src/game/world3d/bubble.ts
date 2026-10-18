// Облачко реплики собеседника: где ему встать у головы, не закрывая лицо и не налезая на плашки.

export interface Rect {
  l: number
  t: number
  r: number
  b: number
}
interface Pt {
  x: number
  y: number
  behind: boolean
}
export interface BubbleSpot {
  x: number
  y: number
  /** куда смотрит хвостик облачка (к собеседнику); '' — без хвостика, голова за кадром */
  tail: 'down' | 'up' | 'left' | 'right' | ''
  /** хвостик: по горизонтали (вверх/вниз) или по вертикали (вбок) от края облачка, px */
  tx: number
  ty: number
  /** голова за кадром — в какую сторону повернуться */
  off: '' | 'left' | 'right' | 'behind' | 'up'
  /** облачко уже обычного — втиснулось между плашками над головой */
  w?: number
}

/** Где встать облачку реплики: над головой (можно на волосы, не на лицо), сбоку от лица, под подбородком;
 * на видеозвонке — под экраном. Не налезает на плашки (obstacles) и панель внизу (trayTop). */
export function placeBubble(o: {
  cw: number
  trayTop: number
  w: number
  h: number
  head: Pt
  chin: Pt
  under?: Pt
  desk?: boolean
  obstacles: Rect[]
  /** где облачко стояло до сих пор — туда в первую очередь */
  keep?: BubbleSpot['tail']
}): BubbleSpot {
  const { cw, trayTop, w, h, head, chin, obstacles } = o
  const M = 8
  const T = 10
  const clampX = (x: number) => Math.min(Math.max(x, M), Math.max(M, cw - w - M))
  const hit = (x: number, y: number) => obstacles.find((r) => x < r.r + 4 && x + w > r.l - 4 && y < r.b + 4 && y + h > r.t - 4)
  const inside = (x: number, y: number) => x >= M - 0.5 && x + w <= cw - M + 0.5 && y >= M - 0.5 && y + h <= trayTop - M + 0.5
  const tailX = (x: number, at: number) => Math.min(Math.max(at - x, 16), w - 16)
  const tailY = (y: number, at: number) => Math.min(Math.max(at - y, 12), h - 12)
  /** спуститься под плашки, что сверху */
  const below = (x: number, y: number) => {
    for (let k = 0, r = hit(x, y); r && k < 8; k++, r = hit(x, y)) y = r.b + 6
    return y
  }

  // голова за кадром: облачко у края, без хвостика — стрелка на имени
  const off: BubbleSpot['off'] = head.behind ? 'behind' : head.x < 0 ? 'left' : head.x > cw ? 'right' : head.y < 0 || o.desk ? 'up' : ''
  if (off) {
    const toRight = off === 'right' || (off === 'behind' && head.x < cw / 2)
    let x = off === 'up' ? M : toRight ? cw - w - M : M
    // за спиной высота головы на экране ничего не значит — облачко наверху
    let y = off === 'up' || off === 'behind' ? M : Math.min(Math.max(head.y - h / 2, M), trayTop - h - M)
    // сверху (склонились к столу): плашки слева — облачко правее них, а не на бумаги
    if (off === 'up')
      for (let k = 0, r = hit(x, y); r && k < 4; k++, r = hit(x, y)) {
        if (r.r + 12 + w <= cw - M) x = r.r + 12
        else {
          y = below(x, y)
          break
        }
      }
    else y = below(x, y)
    return { x, y, tail: '', tx: 0, ty: 0, off: off === 'behind' ? (toRight ? 'right' : 'left') : off }
  }

  /** где по горизонтали может встать облачко над точкой ax: по центру или впритык к плашкам, лишь бы ax было под ним */
  const xs = (ax: number) => {
    const out = [clampX(ax - w / 2)]
    for (const r of obstacles) out.push(clampX(r.r + 6), clampX(r.l - 6 - w))
    return out.filter((x) => ax >= x + 12 && ax <= x + w - 12)
  }
  const face = Math.max(chin.y - head.y, 20)
  const faceTop = head.y + face * 0.4
  const half = face * 0.5
  const eyes = head.y + face * 0.55
  const fits = (x: number, y: number) => inside(x, y) && !hit(x, y)
  const cands: BubbleSpot[] = []
  const add = (x: number, y: number, tail: BubbleSpot['tail'], ax: number, ay: number) =>
    cands.push({ x, y, tail, tx: tailX(x, ax), ty: tailY(y, ay), off: '' })

  if (o.under) add(clampX(o.under.x - w / 2), o.under.y + T, 'up', o.under.x, 0)
  // над головой: сколько позволяют плашки сверху; можно на волосы, но не ниже бровей
  // плашка сверху мешает — облачко сдвигается вбок от неё, пока голова под ним
  for (const x of xs(head.x)) {
    const y = below(x, Math.max(head.y - h - T, M))
    if (y + h + T <= faceTop && !hit(x, y)) {
      add(x, y, 'down', head.x, 0)
      break
    }
  }
  // сверху тесно: облачко сужается до просвета между плашками над головой (текст листается, высота та же)
  if (!cands.length && head.y - T > M) {
    let L = M
    let R = cw - M
    let blocked = false
    for (const r of obstacles) {
      if (r.t >= faceTop || r.b <= M - 4) continue
      if (r.r < head.x) L = Math.max(L, r.r + 6)
      else if (r.l > head.x) R = Math.min(R, r.l - 6)
      else blocked = true
    }
    const nw = Math.min(w, R - L)
    const y = Math.max(head.y - h - T, M)
    if (!blocked && nw >= 260 && y + h + T <= faceTop) {
      const x = Math.min(Math.max(head.x - nw / 2, L), R - nw)
      cands.push({ x, y, tail: 'down', tx: Math.min(Math.max(head.x - x, 16), nw - 16), ty: 0, off: '', w: nw })
    }
  }
  if (!o.under) {
    const top = Math.max(Math.min(head.y, eyes - h / 2), M)
    add(head.x + half + T, top, 'left', 0, eyes)
    add(head.x - half - T - w, top, 'right', 0, eyes)
    add(clampX(chin.x - w / 2), chin.y + T, 'up', chin.x, 0)
  }
  const ok = cands.find((c) => c.tail === o.keep && (c.w || fits(c.x, c.y))) ?? cands.find((c) => c.w || fits(c.x, c.y))
  if (ok) return ok
  // места нет нигде — над головой, под плашками; лучше на волосы, чем на панель
  const x = clampX(head.x - w / 2)
  const y = Math.min(below(x, M), Math.max(M, trayTop - h - M))
  return { x, y, tail: y + h + T <= eyes ? 'down' : '', tx: tailX(x, head.x), ty: 0, off: '' }
}
