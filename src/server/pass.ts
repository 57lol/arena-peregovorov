import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { PILOT_PREFIX, pilotOpen } from './pilot'

const TTL = 30 * 24 * 3600
export function same(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
const sign = (secret: string, what: string) => createHmac('sha256', secret).update(what).digest('base64url')

export interface Judge { id: string; name: string; kind: 'personal' | 'shared'; pilot?: true }

/** Пропуск пилота: свой номер на каждый браузер, чтобы лимиты и расход считались по людям, а не на всю ссылку. */
export const pilotJudge = (secret: string, n: number): Judge =>
  ({ id: sign(secret, `pilot.${randomBytes(12).toString('base64url')}`), name: `${PILOT_PREFIX}игрок ${n}`, kind: 'personal', pilot: true })

/** Личный номер постоянен для ключа; сам ключ в пропуск не попадает. */
export const personalJudge = (secret: string, name: string, key: string): Judge => ({ id: sign(secret, `jury.${key}`), name, kind: 'personal' })

/** По умолчанию строгая проверка для генератора; сервер журналирует ошибку и пропускает запись. */
export function parseJuryKeys(raw = '', { sharedKey, onInvalid = (message: string) => { throw new Error(message) } }: {
  sharedKey?: string
  onInvalid?: (message: string) => void
} = {}) {
  const entries = raw.trim() ? raw.split(',').map((part) => part.trim().split(':')) : []
  const names = new Set<string>(), keys = new Set<string>()
  return entries.flatMap(([name, key, extra], index) => {
    name = name?.trim()
    key = key?.trim()
    const reason = extra !== undefined || !name || !key ? 'нужна пара имя:ключ' :
      name.length > 80 || /[\p{Cc}\p{Cf}]/u.test(name) ? 'недопустимое имя (до 80 символов, без управляющих символов)' :
      !/^[A-Za-z0-9_-]{32,128}$/.test(key) ? 'нужен base64url-токен от 32 до 128 символов' :
      key === sharedKey ? 'личный ключ совпадает с общим JURY_KEY' :
      names.has(name) ? 'повтор имени' : keys.has(key) ? 'повтор ключа' : undefined
    if (reason) {
      onInvalid(`JURY_KEYS: запись ${index + 1} пропущена — ${reason}`)
      return []
    }
    names.add(name)
    keys.add(key)
    return [{ name, key }]
  })
}

/** Старый общий пропуск сохраняем; личный содержит подписанные имя и номер. */
export function makePass(secret: string, now = Date.now(), judge?: Judge, ttl = TTL) {
  const exp = Math.floor(now / 1000) + ttl
  if (judge) {
    const payload = Buffer.from(JSON.stringify({ exp, ...judge })).toString('base64url')
    return `v3.${payload}.${sign(secret, `v3.${payload}`)}`
  }
  const id = randomBytes(9).toString('base64url')
  return `${exp}.${id}.${sign(secret, `v2.${exp}.${id}`)}`
}

/** Проверяем подпись до чтения имени; старые пропуски ещё действуют. */
export function readPass(secret: string, value: string | undefined, now = Date.now()): Judge | undefined {
  if (!value || value.length > 2048) return undefined
  const parts = value.split('.')
  if (parts[0] === 'v3') {
    const [, payload, sig] = parts
    if (parts.length !== 3 || !sig || !same(sig, sign(secret, `v3.${payload}`))) return undefined
    try {
      const p = JSON.parse(Buffer.from(payload, 'base64url').toString())
      if (typeof p.exp !== 'number' || !Number.isFinite(p.exp) || p.exp <= now / 1000 || p.kind !== 'personal' ||
          typeof p.id !== 'string' || !/^[\w-]{43}$/.test(p.id) || typeof p.name !== 'string' || !p.name || p.name.length > 80 || /[\p{Cc}\p{Cf}]/u.test(p.name)) return undefined
      return { id: p.id, name: p.name, kind: p.kind, ...(p.pilot === true ? { pilot: true as const } : {}) }
    } catch { return undefined }
  }
  const [exp, id, sig] = parts.length === 2 ? [parts[0], undefined, parts[1]] : parts
  if (!sig || parts.length > 3 || !Number.isFinite(Number(exp)) || !(Number(exp) > now / 1000)) return undefined
  if (!same(sig, sign(secret, id === undefined ? `v1.${exp}` : `v2.${exp}.${id}`))) return undefined
  const safeId = sign(secret, `pass.${value}`)
  return { id: safeId, name: `Общий ${safeId.slice(0, 8)}`, kind: 'shared' }
}

export const passValid = (secret: string, value: string | undefined, now = Date.now()) => !!readPass(secret, value, now)

/** Подпись не отменяет отзыв: личность и актуальное имя берём из реестра. */
export function verifyPass(secret: string, value: string | undefined, juryKeys: string | { name: string; key: string }[] = '', now = Date.now(), sharedKey?: string): Judge | undefined {
  const judge = readPass(secret, value, now)
  if (!judge || judge.kind === 'shared') return judge
  // пилот не в реестре: живёт, пока пилот открыт
  if (judge.pilot) return pilotOpen(now) ? judge : undefined
  // Ошибки конфигурации уже записаны воротами при запуске; запросы не засоряют журнал.
  const judges = typeof juryKeys === 'string' ? parseJuryKeys(juryKeys, { sharedKey, onInvalid: () => {} }) : juryKeys
  return judges.map((j) => personalJudge(secret, j.name, j.key))
    .find((j) => same(j.id, judge.id))
}
