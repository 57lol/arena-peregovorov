import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Пилот с друзьями: одна общая ссылка ?key=<PILOT_KEY>, каждый браузер по ней получает свой пропуск «Пилот · игрок N».
// Доступ закрывается сам в PILOT_UNTIL (ISO-время) или кнопкой на /pilot-admin; тогда не работают ни ссылка, ни
// выданные по ней пропуски. Закрытие и счётчик переходов лежат в CACHE_DIR/pilot.json и переживают перезапуск.
// Новый PILOT_KEY — новый пилот: старое закрытие к нему не относится.

interface State { of: string; entries: number; closedAt?: number }

let state: State | undefined
const file = () => join(process.env.CACHE_DIR ?? join(process.cwd(), '.cache'), 'pilot.json')
const tag = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 12)

export const PILOT_PREFIX = 'Пилот · '

export const pilotKey = (env = process.env) => {
  const k = env.PILOT_KEY?.trim()
  return k && /^[A-Za-z0-9]{32,128}$/.test(k) ? k : undefined
}

export const pilotUntil = (env = process.env) => {
  const t = Date.parse(env.PILOT_UNTIL ?? '')
  return Number.isFinite(t) ? t : 0
}

function load(env = process.env): State {
  const of = tag(pilotKey(env) ?? '')
  if (state?.of === of) return state
  try {
    const s = JSON.parse(readFileSync(file(), 'utf8'))
    if (s?.of === of) {
      state = { of, entries: Number.isSafeInteger(s.entries) && s.entries > 0 ? s.entries : 0,
        ...(Number.isFinite(s.closedAt) ? { closedAt: s.closedAt } : {}) }
      return state
    }
  } catch { /* файла ещё нет */ }
  state = { of, entries: 0 }
  return state
}

function save() {
  try {
    mkdirSync(dirname(file()), { recursive: true })
    writeFileSync(file(), JSON.stringify(state))
  } catch (e) {
    console.warn(`пилот: не записал ${file()} — ${(e as Error).message}`)
  }
}

export const pilotOpen = (now = Date.now(), env = process.env) =>
  !!pilotKey(env) && now < pilotUntil(env) && load(env).closedAt === undefined

export function pilotClose(now = Date.now()) {
  if (load().closedAt !== undefined) return
  state!.closedAt = now
  save()
  console.log('[пилот] доступ закрыт кнопкой')
}

/** Новый браузер перешёл по ссылке: его номер. */
export function pilotEnter() {
  const s = load()
  s.entries++
  save()
  return s.entries
}

export const pilotState = () => ({ ...load() })

/** только для тестов: забыть состояние в памяти */
export const resetPilot = () => { state = undefined }
