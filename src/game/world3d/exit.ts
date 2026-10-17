// Собеседник уходит со встречи: встаёт, протискивается между своим стулом и стулом соседа, обходит стол за спинами
// и выходит в дверь своей комнаты — или, где двери нет, туда, куда уходят по-настоящему (с остановки — за ларёк).
// Здесь только план и время: точки пути по полу, когда открывается дверь, когда человек темнеет в проёме и пропадает.
// Рисует это people.ts, дверь двигает комната (RoomBuild.door), голову игрока за уходящим поворачивает stage.ts.
// Пути сняты по виду сверху каждой комнаты: проходы между мебелью, без стола, стульев и шкафов (exit.test.ts).

import type { WorldKind } from './rooms'
import { ROOM, SEATED_FORWARD, SEATS } from './layout'
import { PLACE as OFFICES } from './room3d.gen'
import { PLACE as BYTOVKA } from './rooms/bytovka.gen'
import { PLACE as DORM } from './rooms/dorm.gen'
import { PLACE as INEI } from './rooms/inei.gen'
import { PLACE as SHOP } from './rooms/shop.gen'

export type Pt = readonly [number, number]

export interface ExitPlan {
  /** точки на полу (x, z) от места собеседника; на последней он уже скрылся */
  path: readonly Pt[]
  /** дверь: с какого метра пути открывается (за 1,6 м до точки перед проёмом) и с какого закрывается за ним */
  door?: { at: number; shut: number }
  /** последний отрезок — в тёмный проём: человек темнеет, пока не скроется за стеной */
  dark?: boolean
  /** за стеклом, на вечерней улице, человек чуть темнее (магазин) */
  dusk?: { x: number }
}

const HW = ROOM.halfW
/** где стоит поднявшийся собеседник: его место за столом */
export const SEAT: Pt = [SEATS.opponent.x, SEATS.opponent.z + SEATED_FORWARD]
/** проход между своим стулом и стулом соседа слева (зазор −0,62…−0,4 м во всех комнатах) */
const GAP_X = -0.52
/** за спинками дальнего ряда */
const BEHIND = -1.72
/** в проёме: за плоскостью стены, где его уже не видно */
const OUT = -HW - 0.3

const leave = (aisle: number, z: number): Pt[] => [SEAT, [GAP_X, SEAT[1] - 0.04], [GAP_X, BEHIND], [aisle, BEHIND], [aisle, z], [OUT, z]]
const mid = (d: readonly number[]) => (d[0] + d[1]) / 2

/** Дверь в левой стене: середина проёма, или своя точка входа, если у двери что-то стоит. */
const PATHS: Record<WorldKind, Pt[]> = {
  // кабинет снабжения: вешалка у левой стены (−2,98; −0,35), фикус в углу — проход x = −2,55
  factory: leave(-2.55, mid(OFFICES.factory.door)),
  // переговорная: тренч на стене, у торца стул — проход x = −2,6
  office: leave(-2.6, mid(OFFICES.office.door)),
  // общага: слева кровать до z = −0,76 — вдоль неё, между изножьем и спинкой стула в торце, потом вдоль гитары и курток
  dorm: [SEAT, [GAP_X, SEAT[1] - 0.04], [GAP_X, -1.62], [-2.15, -1.62], [-2.2, -0.9], [-2.27, -0.63], [-2.62, -0.4], [-2.62, mid(DORM.door)], [OUT, mid(DORM.door)]],
  // бытовка: стойка с микроволновкой в левом дальнем углу — обходим её край, дальше вдоль огнетушителя
  bytovka: [SEAT, [GAP_X, SEAT[1] - 0.04], [GAP_X, BEHIND], [-2.35, BEHIND], [-2.55, -1.2], [-2.55, mid(BYTOVKA.door)], [OUT, mid(BYTOVKA.door)]],
  // «Иней»: у двери фикус (z 0,95) и вешалка (z 2,0) — входим между ними
  inei: leave(-2.4, (INEI.ficus[1] + INEI.coat[1]) / 2),
  // магазин: из-за кассы назад, вдоль стеллажей налево, между промостойкой и рамкой у входа, в автоматическую дверь
  // и по улице за витриной налево, пока не скроется за глухой стеной
  shop: [SEAT, [0, -1.6], [-2.45, -1.6], [-2.45, mid(SHOP.door)], [-HW - 0.18, mid(SHOP.door)], [-HW - 0.18, SHOP.glass[0] - 0.45]],
  // остановка: перешагивает лавку, мимо собаки по тропинке назад-налево и за ларёк
  street: [SEAT, [0, -1.62], [-1.2, -2.2], [-2.5, -2.75], [-4.3, -3.5], [-4.4, -6.3]],
}

/** Дверь в стене: открывается за 1,6 м пути до точки перед проёмом, закрывается, когда он скрылся за стеной. */
const inDoor = (path: Pt[]): ExitPlan => ({ path, door: { at: pathLength(path.slice(0, -1)) - 1.6, shut: pathLength(path) }, dark: true })

export const EXITS: Record<WorldKind, ExitPlan> = {
  factory: inDoor(PATHS.factory),
  office: inDoor(PATHS.office),
  dorm: inDoor(PATHS.dorm),
  bytovka: inDoor(PATHS.bytovka),
  inei: inDoor(PATHS.inei),
  // автоматическая дверь магазина закрывается, когда он вышел на улицу
  shop: { path: PATHS.shop, door: { at: pathLength(PATHS.shop.slice(0, -2)) - 1.6, shut: pathLength(PATHS.shop.slice(0, -1)) + 0.4 }, dusk: { x: -HW } },
  street: { path: PATHS.street },
}

export function pathLength(path: readonly Pt[]) {
  let n = 0
  for (let i = 1; i < path.length; i++) n += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
  return n
}

/** Точка на пути через s метров от начала. */
export function pointAt(path: readonly Pt[], s: number): { x: number; z: number } {
  let left = Math.max(0, s)
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1]
    const [bx, bz] = path[i]
    const len = Math.hypot(bx - ax, bz - az)
    if (left <= len || i === path.length - 1) {
      const k = len ? Math.min(1, left / len) : 1
      return { x: ax + (bx - ax) * k, z: az + (bz - az) * k }
    }
    left -= len
  }
  return { x: path[0][0], z: path[0][1] }
}

/** Встаёт, с. */
export const STAND_S = 0.45
/** Шаг, м/с: уходит быстро, но не бежит. */
export const WALK_SPEED = 1.35
/** Разгон с места, с. */
const ACCEL_S = 0.4
/** Дверь открывается и закрывается, с (по пути — за 1,6 м до проёма до 0,5 м). */
const DOOR_CLOSE_S = 0.7

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const smooth = (v: number) => v * v * (3 - 2 * v)

/** Сколько метров прошёл за walk секунд ходьбы. */
export function walked(walk: number) {
  if (walk <= 0) return 0
  return walk < ACCEL_S ? (WALK_SPEED * walk * walk) / (2 * ACCEL_S) : WALK_SPEED * (walk - ACCEL_S / 2)
}

/** За сколько секунд ходьбы пройдено s метров (обратное к walked). */
export function walkFor(s: number) {
  const ramp = (WALK_SPEED * ACCEL_S) / 2
  return s <= ramp ? Math.sqrt((2 * ACCEL_S * Math.max(0, s)) / WALK_SPEED) : s / WALK_SPEED + ACCEL_S / 2
}

export interface ExitFrame {
  x: number
  z: number
  /** 0 — сидит, 1 — встал */
  stand: number
  /** пройдено метров: от этого — шаг ногами */
  s: number
  moving: boolean
  /** дверь: 0 — закрыта, 1 — открыта */
  door: number
  /** насколько темнее (проём, вечерняя улица): 0 — как в комнате */
  dark: number
  /** скрылся — больше не рисуем */
  gone: boolean
}

/**
 * Кадр ухода: t — секунды с начала ухода, walk — секунды ходьбы (0, пока стоит у стола и договаривает).
 * Дверь открывается по мере подхода, после ухода закрывается за DOOR_CLOSE_S.
 */
export function exitFrame(plan: ExitPlan, t: number, walk: number): ExitFrame {
  const L = pathLength(plan.path)
  const s = Math.min(L, walked(walk))
  const p = pointAt(plan.path, s)
  const gone = s >= L
  let door = 0
  if (plan.door) {
    door = smooth(clamp01((s - plan.door.at) / 1.1))
    door *= 1 - smooth(clamp01((walk - walkFor(plan.door.shut)) / DOOR_CLOSE_S))
  }
  let dark = 0
  // в проёме темнеет: от 0,4 м до стены — до полной темноты у самой стены, где его скрывает проём
  if (plan.dark) dark = smooth(clamp01((-HW + 0.4 - p.x) / 0.38))
  if (plan.dusk && p.x < plan.dusk.x) dark = 0.35
  return { x: p.x, z: p.z, stand: smooth(clamp01(t / STAND_S)), s, moving: walk > 0 && !gone, door, dark, gone }
}

/** Ушёл совсем: путь пройден и дверь за ним закрылась. */
export function exitDone(plan: ExitPlan, walk: number) {
  return walk > Math.max(walkFor(pathLength(plan.path)), plan.door ? walkFor(plan.door.shut) + DOOR_CLOSE_S : 0)
}
