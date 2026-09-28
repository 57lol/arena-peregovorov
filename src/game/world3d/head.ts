// Голова игрока: сидим на стуле, поворачиваемся в пределах ±100°, смотрим от стола до чуть выше горизонта.
// Всё плавно: цель задают клавиши, мышь, пальцы и кнопки, а сама голова догоняет её с затуханием.

import { MathUtils } from 'three'

const D = MathUtils.DEG2RAD

export const YAW_MAX = 100 * D
export const PITCH_MIN = -64 * D
export const PITCH_MAX = 14 * D

export type Pose = 'face' | 'desk'

export interface PoseAngles {
  face: { yaw: number; pitch: number }
  desk: { yaw: number; pitch: number }
}

export class Head {
  yaw = 0
  pitch = -6 * D
  /** цель, к которой тянется голова */
  ty = 0
  tp = -6 * D
  /** небольшой сдвиг за курсором мыши, без нажатия */
  py = 0
  pp = 0
  /** скорость поворота стрелками, рад/с (−1..1 × скорость) */
  spin = 0
  poses: PoseAngles = { face: { yaw: 0, pitch: -6 * D }, desk: { yaw: 0, pitch: -56 * D } }
  /** быстрее или медленнее догоняет цель (reduced motion — почти сразу) */
  stiffness = 7

  look(pose: Pose) {
    this.ty = this.poses[pose].yaw
    this.tp = this.poses[pose].pitch
  }

  /** Сдвиг цели на угол (перетаскивание мышью или пальцем). */
  nudge(dYaw: number, dPitch: number) {
    this.ty = MathUtils.clamp(this.ty + dYaw, -YAW_MAX, YAW_MAX)
    this.tp = MathUtils.clamp(this.tp + dPitch, PITCH_MIN, PITCH_MAX)
  }

  /** Где мы сейчас: у стола или лицом к собеседнику (для кнопок-подсказок). */
  get pose(): Pose {
    return this.tp < (this.poses.face.pitch + this.poses.desk.pitch) / 2 ? 'desk' : 'face'
  }

  /** Насколько склонились над столом: 0 — сидим прямо, 1 — наклонились к бумагам. */
  get lean() {
    const a = this.poses.face.pitch - 8 * D
    const b = this.poses.desk.pitch
    return 1 - MathUtils.smoothstep(this.pitch, b, a)
  }

  update(dt: number) {
    if (this.spin) this.ty = MathUtils.clamp(this.ty + this.spin * dt, -YAW_MAX, YAW_MAX)
    const k = 1 - Math.exp(-dt * this.stiffness)
    const y = MathUtils.clamp(this.ty + this.py, -YAW_MAX, YAW_MAX)
    const p = MathUtils.clamp(this.tp + this.pp, PITCH_MIN, PITCH_MAX)
    this.yaw += (y - this.yaw) * k
    this.pitch += (p - this.pitch) * k
    // доехали — встаём точно, иначе бумаги на столе вечно сдвигались бы на доли пикселя
    if (Math.abs(y - this.yaw) < 1e-4) this.yaw = y
    if (Math.abs(p - this.pitch) < 1e-4) this.pitch = p
  }

  /** Голова почти остановилась — можно не пересчитывать то, что зависит от взгляда. */
  get still() {
    return Math.abs(this.ty + this.py - this.yaw) < 0.002 && Math.abs(this.tp + this.pp - this.pitch) < 0.002
  }
}
