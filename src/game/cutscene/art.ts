// Картинки катсцен (рисуют tools/art/cutscene_bg.py и cutscene_people.py) и их разметка: кадры, якоря, окна, экран.
// Всё, что знает о файлах, — здесь; рисовальщик берёт только эти описания.

import { BG } from './bg.gen'
import { PEOPLE } from './people.gen'

export const H = 180
export const DIR = '/assets/cutscene/'

const file = (src: string) => src.replace(DIR, '')

/** Лист кадров человека: кадры в ряд одного размера, якорь — середина между пятками, низ подошвы. */
export interface Sheet {
  src: string
  fw: number
  fh: number
  ax: number
  ay: number
  walk: readonly number[]
  /** за сколько точек пути проходит весь цикл ходьбы */
  cycle: number
  stand: number
  ear?: number
  look?: number
  cheers?: number
  /** нарисован лицом влево */
  left?: boolean
}

const P = PEOPLE
const person = (p: typeof P.walk | typeof P.case | typeof P.box) => ({
  src: file(p.src),
  fw: p.w,
  fh: p.h,
  ax: p.ax,
  ay: p.ay,
  walk: p.walk,
  cycle: p.cycle,
  stand: p.stand,
})

export const SHEETS: Record<'newbie' | 'case' | 'box' | 'timur', Sheet> = {
  newbie: { ...person(P.walk), ear: P.walk.phoneEar, look: P.walk.phoneLook },
  case: person(P.case),
  box: person(P.box),
  timur: { src: file(P.timur.src), fw: P.timur.w, fh: P.timur.h, ax: P.timur.ax, ay: P.timur.ay, walk: [P.timur.idle], cycle: 32, stand: P.timur.idle, cheers: P.timur.sip, left: P.timur.faces === 'left' },
}

export const BUS = {
  src: 'bus.png',
  lights: 'bus_lights.png',
  w: BG.bus.w,
  h: BG.bus.h,
  wheel: { src: 'wheel.png', size: BG.bus.wheelFrame, frames: BG.bus.wheelFrames },
  /** центры колёс относительно левого верхнего угла автобуса */
  wheels: BG.bus.wheels,
  /** строка, которая стоит на асфальте (y колёс на земле — BG.road.wheelGroundY) */
  bottom: BG.bus.bottomY,
  ground: BG.road.wheelGroundY,
}

/** Салон: где сидит новенький, кадры его листа. */
export const BUS_IN = {
  bg: file(P.busIn.src),
  fg: file(P.busIn.fg),
  sit: { src: file(P.sit.src), fw: P.sit.w, fh: P.sit.h, x: P.sit.at[0], y: P.sit.at[1], look: P.sit.phone, scroll: P.sit.scroll, window: P.sit.window, doze: P.sit.doze },
  /** куда смотреть камере на узком экране: на новенького */
  focus: P.sit.at[0] + P.sit.w / 2,
  /** вид из окна: Кама и берег должны попасть в стёкла */
  view: -4,
}

/** Салон от первого лица (телефон в руках в автобусе): стёкла прозрачные, за ними едет трасса. */
export const BUS_POV = { src: file(P.busPov.src), w: P.busPov.w, view: -4 }

export const PHONE = {
  src: file(P.phone.src),
  fw: P.phone.w,
  fh: P.phone.h,
  swipe: P.phone.swipe,
  rest: P.phone.rest,
  /** экран в кадре: x0, y0, x1, y1 включительно */
  screen: P.phone.screen,
}

/** Ключевые места на улице и в ОЭЗ, x в точках сцены. */
export const SPOTS = {
  ground: BG.feetY,
  street: { w: BG.size.street_near[0], stop: BG.street.stopX, shop: BG.street.shopDoorX, dorm: BG.street.dormDoorX },
  oez: { w: BG.size.oez_near[0], gate: BG.oez.gateX, parking: 290, vodogrey: BG.oez.vodogreyDoorX, workshop: BG.oez.workshopGateX, inei: BG.oez.ineiDoorX },
}
