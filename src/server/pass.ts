import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const TTL = 30 * 24 * 3600
function same(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const sign = (secret: string, what: string) => createHmac('sha256', secret).update(what).digest('base64url')

/** Пропуск: срок, случайный номер входа (по нему лимиты на сессию) и подпись. */
export function makePass(secret: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + TTL
  const id = randomBytes(9).toString('base64url')
  return `${exp}.${id}.${sign(secret, `v2.${exp}.${id}`)}`
}

/** Пропуски до 17.10 — без номера входа («срок.подпись»): жюри не выкидывает на вход. */
export function passValid(secret: string, value: string | undefined, now = Date.now()) {
  const parts = (value ?? '').split('.')
  const [exp, id, sig] = parts.length === 2 ? [parts[0], undefined, parts[1]] : parts
  if (!sig || parts.length > 3 || !(Number(exp) > now / 1000)) return false
  return same(sig, sign(secret, id === undefined ? `v1.${exp}` : `v2.${exp}.${id}`))
}

