/** Только счётчики событий; ни текста речи, ни ключа задания. */
const PREPARE_REASONS = ['noPartial', 'shortPause', 'textChanged', 'manual', 'limit', 'unavailable', 'duplicate'] as const
export type PrepareReason = typeof PREPARE_REASONS[number]
export type PrepareCounts = Partial<Record<PrepareReason, number>>
export interface PrepareDiag { id?: string; process?: string; status?: number; counts?: PrepareCounts }
export const diagnosticId = (v: unknown): string | undefined => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v) ? v : undefined
/** Непроверенные служебные поля не должны ломать ход или попадать в журнал. */
export function prepareDiag(value: unknown): PrepareDiag {
  const v = value && typeof value === 'object' ? value as PrepareDiag : {}
  const counts: PrepareCounts = {}
  for (const k of PREPARE_REASONS) {
    const n = v.counts?.[k]
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) counts[k] = Math.min(n, 999)
  }
  return { id: diagnosticId(v.id), process: diagnosticId(v.process), status: typeof v.status === 'number' && Number.isInteger(v.status) && v.status >= 0 && v.status <= 599 ? v.status : undefined, counts }
}
export const prepareCountsLog = (value: unknown) => {
  const { counts } = prepareDiag(value)
  return PREPARE_REASONS.filter((k) => counts![k]).map((k) => `${k}:${counts![k]}`).join(',') || '-'
}

/** Старый Safari умеет getRandomValues, но может ещё не иметь randomUUID. */
export function newPrepareId() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
