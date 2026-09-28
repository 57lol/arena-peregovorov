// Суточный бюджет на платные API. Токены берём из usage в ответе модели, символы озвучки и секунды записи
// считаем сами. Всё за сутки (по Москве) лежит в CACHE_DIR/usage/<дата>.json и переживает перезапуск.
// До 80% лимита — основная модель (Pro), до 100% — запасная (Lite), дальше — офлайн-разметка и шаблоны.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CACHE_DIR } from './cache'

export type Mode = 'pro' | 'lite' | 'offline'

interface Model {
  in: number
  out: number
  calls: number
  rub: number
}

export interface Day {
  date: string
  rub: number
  llm: Record<string, Model>
  ttsChars: number
  sttSec: number
}

const num = (v: string | undefined, def: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : def)
const isLite = (model: string) => /lite/i.test(model)

export function limits(env = process.env) {
  return {
    rub: num(env.LLM_DAILY_RUB, 150),
    priceIn: num(env.YANDEX_PRICE_IN, 0.8),
    priceOut: num(env.YANDEX_PRICE_OUT, 0.8),
    litePriceIn: num(env.YANDEX_LITE_PRICE_IN, 0.2),
    litePriceOut: num(env.YANDEX_LITE_PRICE_OUT, 0.2),
    ttsChars: num(env.TTS_DAILY_CHARS, 40000),
    sttSec: num(env.STT_DAILY_SEC, 3600),
  }
}

/** Цена вызова в рублях: цены за 1000 токенов, у Lite свои. */
export function priceOf(model: string, tokensIn: number, tokensOut: number, env = process.env): number {
  const l = limits(env)
  const [pi, po] = isLite(model) ? [l.litePriceIn, l.litePriceOut] : [l.priceIn, l.priceOut]
  return (tokensIn * pi + tokensOut * po) / 1000
}

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })
const empty = (date: string): Day => ({ date, rub: 0, llm: {}, ttsChars: 0, sttSec: 0 })

export function makeBudget(dir = join(CACHE_DIR, 'usage'), env = process.env) {
  let day: Day = empty('')
  let writing = Promise.resolve()

  /** Сегодняшний счёт: из памяти, а после полуночи или перезапуска — с диска. */
  async function load(): Promise<Day> {
    const date = today()
    if (day.date === date) return day
    try {
      day = { ...empty(date), ...JSON.parse(await readFile(join(dir, `${date}.json`), 'utf8')), date }
    } catch {
      day = empty(date)
    }
    return day
  }

  function save() {
    const snapshot = JSON.stringify(day, null, 1)
    const file = join(dir, `${day.date}.json`)
    writing = writing.then(() => mkdir(dir, { recursive: true }).then(() => writeFile(file, snapshot))).catch((e) => {
      console.warn(`[бюджет] не записал ${file}: ${(e as Error).message}`)
    })
    return writing
  }

  /** Режим по уже известному счёту — без диска, для /api/health и ключа кэша. */
  function modeNow(): Mode {
    const l = limits(env)
    if (day.date === today() && day.rub >= l.rub) return 'offline'
    if (day.date === today() && day.rub >= l.rub * 0.8) return 'lite'
    return 'pro'
  }

  return {
    dir,
    modeNow,
    async mode(): Promise<Mode> {
      await load()
      return modeNow()
    },
    async addLlm(model: string, tokensIn: number, tokensOut: number) {
      const d = await load()
      const rub = priceOf(model, tokensIn, tokensOut, env)
      const m = (d.llm[model] ??= { in: 0, out: 0, calls: 0, rub: 0 })
      m.in += tokensIn
      m.out += tokensOut
      m.calls += 1
      m.rub = Math.round((m.rub + rub) * 1e4) / 1e4
      d.rub = Math.round((d.rub + rub) * 1e4) / 1e4
      await save()
    },
    /** Озвучка: хватит ли на эту фразу сегодняшнего лимита символов. */
    async ttsAllowed(chars: number) {
      const d = await load()
      return d.ttsChars + chars <= limits(env).ttsChars
    },
    async addTts(chars: number) {
      ;(await load()).ttsChars += chars
      await save()
    },
    async sttAllowed() {
      return (await load()).sttSec < limits(env).sttSec
    },
    async addStt(sec: number) {
      const d = await load()
      d.sttSec = Math.round((d.sttSec + sec) * 10) / 10
      await save()
    },
    async today() {
      return structuredClone(await load())
    },
    /** Строка для server.log: сколько потрачено за сегодня. */
    async summary() {
      const d = await load()
      const l = limits(env)
      const models = Object.entries(d.llm)
        .map(([name, m]) => `${name}: ${m.calls} вызовов, ${m.in} вх. + ${m.out} исх. ток., ${m.rub.toFixed(2)} ₽`)
        .join('; ')
      return `[бюджет] ${d.date}: модель ${d.rub.toFixed(2)} из ${l.rub} ₽, режим ${modeNow()}${models ? ` (${models})` : ''}; озвучка ${d.ttsChars} из ${l.ttsChars} симв.; распознавание ${d.sttSec} из ${l.sttSec} с`
    },
  }
}

export type Budget = ReturnType<typeof makeBudget>

let shared: Budget | undefined
/** Один счёт на процесс. Создаётся лениво, чтобы CACHE_DIR из .env успел прочитаться. */
export const budget = () => (shared ??= makeBudget())

/** Раз в час пишем расход в лог сервера. */
export function logBudgetHourly(b = budget()) {
  const tick = () => b.summary().then((s) => console.log(`${new Date().toISOString()} ${s}`))
  void tick()
  setInterval(tick, 3600_000).unref()
}
