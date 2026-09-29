// Бюджет на платные API. Главный — ОБЩИЙ лимит LLM_TOTAL_RUB (₽ на модель и голос вместе) с момента первого
// запуска: счёт в CACHE_DIR/usage/total.json. Токены берём из usage в ответе модели, символы озвучки и секунды
// записи считаем сами и переводим в рубли по ценам SpeechKit. Подробности по дням — в CACHE_DIR/usage/<дата>.json.
// До 80% лимита — основная модель (Pro), до 100% — запасная (Lite), дальше — офлайн-разметка, шаблоны и без голоса.
// Суточные LLM_DAILY_RUB, TTS_DAILY_CHARS, STT_DAILY_SEC по умолчанию сняты (без лимита).

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

export interface Total {
  since: string
  rub: number
  llmRub: number
  ttsRub: number
  sttRub: number
  ttsChars: number
  sttSec: number
}

const num = (v: string | undefined, def: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : def)
const isLite = (model: string) => /lite/i.test(model)

export function limits(env = process.env) {
  return {
    total: num(env.LLM_TOTAL_RUB, 6000),
    rub: num(env.LLM_DAILY_RUB, Infinity),
    priceIn: num(env.YANDEX_PRICE_IN, 0.8),
    priceOut: num(env.YANDEX_PRICE_OUT, 0.8),
    litePriceIn: num(env.YANDEX_LITE_PRICE_IN, 0.2),
    litePriceOut: num(env.YANDEX_LITE_PRICE_OUT, 0.2),
    ttsChars: num(env.TTS_DAILY_CHARS, Infinity),
    sttSec: num(env.STT_DAILY_SEC, Infinity),
    // SpeechKit: v3 — 0,1626 ₽ за начатые 250 символов, livetts — 0,25 ₽; распознавание — 0,1626 ₽ за 15 с
    ttsPrice250: num(env.TTS_PRICE_250, 0.1626),
    livePrice250: num(env.LIVETTS_PRICE_250, 0.25),
    sttPrice15: num(env.STT_PRICE_15S, 0.1626),
  }
}

/** Цена вызова в рублях: цены за 1000 токенов, у Lite свои. */
export function priceOf(model: string, tokensIn: number, tokensOut: number, env = process.env): number {
  const l = limits(env)
  const [pi, po] = isLite(model) ? [l.litePriceIn, l.litePriceOut] : [l.priceIn, l.priceOut]
  return (tokensIn * pi + tokensOut * po) / 1000
}

/** Цена озвучки в рублях: SpeechKit берёт за каждые начатые 250 символов. */
export function ttsPrice(chars: number, live = false, env = process.env): number {
  const l = limits(env)
  return Math.ceil(chars / 250) * (live ? l.livePrice250 : l.ttsPrice250)
}

/** Цена распознавания: кусками по 15 секунд. */
export const sttPrice = (sec: number, env = process.env) => Math.ceil(sec / 15) * limits(env).sttPrice15

const r4 = (x: number) => Math.round(x * 1e4) / 1e4
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })
const empty = (date: string): Day => ({ date, rub: 0, llm: {}, ttsChars: 0, sttSec: 0 })
const emptyTotal = (): Total => ({ since: new Date().toISOString(), rub: 0, llmRub: 0, ttsRub: 0, sttRub: 0, ttsChars: 0, sttSec: 0 })

export function makeBudget(dir = join(CACHE_DIR, 'usage'), env = process.env) {
  let day: Day = empty('')
  let total: Total | undefined
  let writing = Promise.resolve()
  const totalFile = join(dir, 'total.json')

  /** Общий счёт: один раз с диска, дальше из памяти. Нет файла — начинаем с нуля и сразу пишем. */
  async function loadTotal(): Promise<Total> {
    if (total) return total
    let t: Total
    let fresh = false
    try {
      t = { ...emptyTotal(), ...JSON.parse(await readFile(totalFile, 'utf8')) }
    } catch {
      t = emptyTotal()
      fresh = true
    }
    if (total) return total
    total = t
    if (fresh) {
      console.log(`[бюджет] общий счёт начат с нуля: ${totalFile}`)
      void save()
    }
    return total
  }

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
    const files: [string, string][] = []
    if (day.date) files.push([join(dir, `${day.date}.json`), JSON.stringify(day, null, 1)])
    if (total) files.push([totalFile, JSON.stringify(total, null, 1)])
    writing = writing
      .then(() => mkdir(dir, { recursive: true }))
      .then(() => Promise.all(files.map(([f, s]) => writeFile(f, s))))
      .then(() => {})
      .catch((e) => {
        console.warn(`[бюджет] не записал ${dir}: ${(e as Error).message}`)
      })
    return writing
  }

  async function both() {
    return [await load(), await loadTotal()] as const
  }

  /** Режим по уже известному счёту — без диска, для /api/health и ключа кэша. */
  function modeNow(): Mode {
    const l = limits(env)
    const t = total?.rub ?? 0
    const d = day.date === today() ? day.rub : 0
    if (t >= l.total || d >= l.rub) return 'offline'
    if (t >= l.total * 0.8 || d >= l.rub * 0.8) return 'lite'
    return 'pro'
  }

  return {
    dir,
    modeNow,
    async mode(): Promise<Mode> {
      await both()
      return modeNow()
    },
    async addLlm(model: string, tokensIn: number, tokensOut: number) {
      const [d, t] = await both()
      const rub = priceOf(model, tokensIn, tokensOut, env)
      const m = (d.llm[model] ??= { in: 0, out: 0, calls: 0, rub: 0 })
      m.in += tokensIn
      m.out += tokensOut
      m.calls += 1
      m.rub = Math.round((m.rub + rub) * 1e4) / 1e4
      d.rub = r4(d.rub + rub)
      t.llmRub = r4(t.llmRub + rub)
      t.rub = r4(t.rub + rub)
      await save()
    },
    /** Озвучка: общий бюджет не кончился и (если задан) хватает суточного лимита символов. */
    async ttsAllowed(chars: number) {
      const [d] = await both()
      return modeNow() !== 'offline' && d.ttsChars + chars <= limits(env).ttsChars
    },
    async addTts(chars: number, live = false) {
      const [d, t] = await both()
      const rub = ttsPrice(chars, live, env)
      d.ttsChars += chars
      t.ttsChars += chars
      t.ttsRub = r4(t.ttsRub + rub)
      t.rub = r4(t.rub + rub)
      await save()
    },
    async sttAllowed() {
      const [d] = await both()
      return modeNow() !== 'offline' && d.sttSec < limits(env).sttSec
    },
    async addStt(sec: number) {
      const [d, t] = await both()
      const rub = sttPrice(sec, env)
      d.sttSec = Math.round((d.sttSec + sec) * 10) / 10
      t.sttSec = Math.round((t.sttSec + sec) * 10) / 10
      t.sttRub = r4(t.sttRub + rub)
      t.rub = r4(t.rub + rub)
      await save()
    },
    async total() {
      return structuredClone(await loadTotal())
    },
    async today() {
      return structuredClone(await load())
    },
    /** Строка для server.log: общий счёт и расход за сегодня. */
    async summary() {
      const [d, t] = await both()
      const l = limits(env)
      const lim = (x: number) => (Number.isFinite(x) ? ` из ${x}` : '')
      const models = Object.entries(d.llm)
        .map(([name, m]) => `${name}: ${m.calls} вызовов, ${m.in} вх. + ${m.out} исх. ток., ${m.rub.toFixed(2)} ₽`)
        .join('; ')
      return (
        `[бюджет] всего ${t.rub.toFixed(2)} из ${l.total} ₽ с ${t.since.slice(0, 10)} (модель ${t.llmRub.toFixed(2)}, озвучка ${t.ttsRub.toFixed(2)}, распознавание ${t.sttRub.toFixed(2)}), режим ${modeNow()}; ` +
        `${d.date}: модель ${d.rub.toFixed(2)}${lim(l.rub)} ₽${models ? ` (${models})` : ''}; озвучка ${d.ttsChars}${lim(l.ttsChars)} симв.; распознавание ${d.sttSec}${lim(l.sttSec)} с`
      )
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
