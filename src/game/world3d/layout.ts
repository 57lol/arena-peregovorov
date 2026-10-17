// Геометрия переговорной в метрах. Ось Y вверх, мы сидим на +Z и смотрим в −Z, собеседник — напротив.
// Этим файлом пользуются и комната (room.ts), и люди, и бумаги на столе: всё, что должно совпасть, — здесь.

export const ROOM = {
  /** стены: x от −halfW до +halfW, z от back (за собеседником) до front (за нами) */
  halfW: 3.2,
  back: -2.7,
  front: 2.3,
  height: 3.0,
}

export const TABLE = {
  /** столешница: верх на высоте y, по x от −halfLen до +halfLen, по z от far до near */
  y: 0.74,
  thick: 0.05,
  halfLen: 1.55,
  far: -0.9,
  near: 0.28,
}

/** Глаза сидящего игрока и куда он смотрит по умолчанию. */
export const EYE = { x: 0, y: 1.2, z: 0.62 }

/** Места за столом: x, z — начало координат стула. */
export const SEATS = {
  opponent: { x: 0, z: -1.08 },
  /** массовка: по бокам от собеседника и в торцах стола (торцевые сидят боком к столу) */
  extras: [
    { x: -0.92, z: -1.1 },
    { x: 0.95, z: -1.1 },
    { x: -2.0, z: -0.3 },
    { x: 2.0, z: -0.3 },
  ],
  player: { x: 0, z: 0.85 },
}

/** Часы над головой собеседника на дальней стене: центр циферблата и радиус. */
export const CLOCK = { x: 0.0, y: 1.98, z: ROOM.back + 0.03, r: 0.17 }

/** Метров на точку спрайта: лицо собеседника (96 точек) — 0.62 м, как живой человек за столом. */
export const SPRITE_M_PER_PX = 0.62 / 96

/** Стулья в торцах смотрят к столу, дальний ряд — к игроку. */
export const seatYaw = (x: number) => Math.abs(x) > 1.8 ? (x < 0 ? Math.PI / 2 : -Math.PI / 2) : 0
export const SEATED_FORWARD = 0.06
export const SEATED_TURN = 0.55

/** Край биллборда остаётся перед спинкой даже при взгляде на соседа. */
export function seatedTurn(want: number, facing: number) {
  const d = ((want - facing + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
  return facing + Math.max(-SEATED_TURN, Math.min(SEATED_TURN, d))
}
