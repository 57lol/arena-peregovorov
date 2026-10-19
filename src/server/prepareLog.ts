import { randomUUID } from 'node:crypto'
import { diagnosticId } from '../shared/prepareDiag'

export const PROCESS_ID = randomUUID()
export const canonical = (value: unknown) => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)
export interface PrepareParts {
  who: string; sc: unknown; history: unknown; text: string; reaction?: string; offer?: unknown
  accept: boolean; walkAway: boolean; opener: boolean; natural: boolean; marks: boolean; lab?: string; voiceLlm?: string
}
export interface PrepareLifecycle { state?: 'cancelled' | 'ttl' | 'failed' }
export interface PrepareObservation {
  id: string; who: string; at: number; status: number; reason: string
  parts?: PrepareParts; tts?: unknown; lifecycle?: PrepareLifecycle
}
const fields = ['who', 'sc', 'history', 'reaction', 'offer', 'accept', 'walkAway', 'opener', 'natural', 'marks', 'lab', 'voiceLlm'] as const
const names = { who: 'session', sc: 'scenario', history: 'history', reaction: 'reaction', offer: 'offer', accept: 'accept', walkAway: 'walkAway', opener: 'opener', natural: 'natural', marks: 'marks', lab: 'lab', voiceLlm: 'voiceLlm' }
/** Сравниваем именно нормализованные поля ключа. Значения никогда не форматируем в лог. */
export function prepareDifference(a: PrepareParts, b: PrepareParts) {
  const changed: string[] = fields.filter((k) => canonical(a[k]) !== canonical(b[k])).map((k) => names[k])
  if (a.text !== b.text) {
    let prefix = 0
    while (prefix < Math.min(a.text.length, b.text.length) && a.text[prefix] === b.text[prefix]) prefix++
    changed.unshift(`text:${a.text.length}/${b.text.length}/prefix:${prefix}`)
  }
  return changed.join(',') || '-'
}
/** Ограниченный журнал живёт дольше jobs: сохраняет причину удаления, но не бесконечно. */
export function prepareJournal() {
  const entries = new Map<string, PrepareObservation>()
  function prune() {
    for (const [id, e] of entries) if (Date.now() - e.at > 300_000) entries.delete(id)
    while (entries.size > 2000) entries.delete(entries.keys().next().value!)
  }
  return {
    add(e: PrepareObservation) { entries.delete(e.id); entries.set(e.id, e); prune() },
    find(id: string | undefined, who: string) {
      prune()
      // Явный id нельзя подменять последней попыткой другой вкладки.
      if (id) return entries.get(id)
      return [...entries.values()].reverse().find((e) => e.who === who)
    },
  }
}
export function sessionPrepareRejected(id: unknown) {
  console.log(`[заготовка] событие=prepare процесс=${PROCESS_ID} попытка=${diagnosticId(id) ?? '-'} статус=401 причина=session`)
}

/** Синтез не входит в ключ (кроме включения opener). Выводим только известные имена полей. */
export function ttsDifference(a: unknown, b: unknown) {
  const known = ['voice', 'speed', 'format', 'emotion', 'api', 'model', 'lang', 'role']
  const left = a && typeof a === 'object' ? a as Record<string, unknown> : {}
  const right = b && typeof b === 'object' ? b as Record<string, unknown> : {}
  const changes = known.filter((k) => canonical(left[k]) !== canonical(right[k]))
  if (!!a !== !!b) changes.unshift('enabled')
  const extra = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).filter(([k]) => !known.includes(k)))
  if (canonical(extra(left)) !== canonical(extra(right))) changes.push('other')
  return changes.join(',') || '-'
}
