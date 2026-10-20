/** Лёгкий пульс: никаких реплик, предложений или скрытых очков собеседника. */
type LivePhase = 'brief' | 'playing' | 'left' | 'finished'

export interface Pulse {
  clientId: string
  attemptId: string
  /** Порядок снимков, включая перемотку и повторную отправку. */
  seq: number
  name: string
  turn: number
  total: number
  trust: number
  tension: number
  phase: LivePhase
}

export interface TrustPoint { turn: number; trust: number }
export interface LiveRow {
  pid: string
  name: string
  turn: number
  total: number
  trust: number
  tension: number
  phase: LivePhase
  at: number
  needsHelp: boolean
  silent: boolean
}

export const SILENT_AFTER = 2 * 60_000
export const PULSE_TTL = 24 * 60 * 60_000

/** Повторный снимок одного хода не считается падением; перемотка стирает будущее. */
export function trustTrail(trail: TrustPoint[], turn: number, trust: number): TrustPoint[] {
  return [...trail.filter((p) => p.turn < turn), { turn, trust }].slice(-3)
}

export function needsHelp(tension: number, trail: TrustPoint[]): boolean {
  if (tension >= 70) return true
  const [a, b, c] = trail.slice(-3)
  return !!(a && b && c && b.turn === a.turn + 1 && c.turn === b.turn + 1 && a.trust > b.trust && b.trust > c.trust)
}

export const isSilent = (at: number, now = Date.now()) => now - at > SILENT_AFTER
