// Бюджет на платные API. Главный — ОБЩИЙ лимит LLM_TOTAL_RUB (₽ на модель и голос вместе) с момента первого
// запуска: счёт в CACHE_DIR/usage/total.json. Токены берём из usage в ответе модели, символы озвучки и секунды
// записи считаем сами и переводим в рубли по ценам SpeechKit. Подробности по дням — в CACHE_DIR/usage/<дата>.json.
// До 80% лимита — основная модель (Pro), до 100% — запасная (Lite), дальше — офлайн-разметка, шаблоны и без голоса.
// Суточные LLM_DAILY_RUB, TTS_DAILY_CHARS, STT_DAILY_SEC по умолчанию сняты (без лимита).

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CACHE_DIR } from './cache'
import { usageContext } from './usage'
import type { Judge } from './pass'
import { writeJson } from './storage'
import { z } from 'zod'

export type Mode = 'pro' | 'lite' | 'offline'

interface Model {
  in: number
  out: number
  calls: number
  rub: number
}

export interface JudgeUsage extends Judge {
  turns: number
  starts: number
  finishes: number
  llmCalls: number
  llmRub: number
  ttsRub: number
  sttRub: number
  rub: number
  ttsChars: number
  sttSec: number
  lastAt: string
}

export interface Day {
  date: string
  judges: Record<string, JudgeUsage>
  rub: number
  llm: Record<string, Model>
  ttsChars: number
  sttSec: number
}

export interface Total {
  since: string
  judges: Record<string, JudgeUsage>
  rub: number
  llmRub: number
  ttsRub: number
  sttRub: number
  ttsChars: number
  sttSec: number
}

const Amount = z.number().min(0)
const counters = { rub: Amount, ttsChars: Amount.default(0), sttSec: Amount.default(0) }
const prices = { llmRub: Amount.default(0), ttsRub: Amount.default(0), sttRub: Amount.default(0) }
const Judges = z.record(z.string(), z.object({
  id: z.string(), name: z.string(), kind: z.enum(['personal', 'shared']), lastAt: z.string(),
  ...counters, ...prices, turns: Amount, starts: Amount, finishes: Amount, llmCalls: Amount,
})).default({})
const TotalFile = z.object({ since: z.string(), judges: Judges, ...counters, ...prices })
const DayFile = z.object({ date: z.string(), judges: Judges, ...counters,
  llm: z.record(z.string(), z.object({ in: Amount, out: Amount, calls: Amount, rub: Amount })).default({}),
})

const num = (v: string | undefined, def: number) => (v?.trim() && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : def)
const validAmounts = (...values: number[]) => values.every((v) => Number.isFinite(v) && v >= 0)
const checkAmounts = (...values: number[]) => { if (!validAmounts(...values)) throw new Error('Некорректное списание бюджета') }
const isLite = (model: string) => /lite/i.test(model)

function limits(env = process.env) {
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
const empty = (date: string): Day => ({ date, judges: {}, rub: 0, llm: {}, ttsChars: 0, sttSec: 0 })
const emptyTotal = (): Total => ({ since: new Date().toISOString(), judges: {}, rub: 0, llmRub: 0, ttsRub: 0, sttRub: 0, ttsChars: 0, sttSec: 0 })

type UsageDelta = Partial<Pick<JudgeUsage, 'turns' | 'starts' | 'finishes' | 'llmCalls' | 'llmRub' | 'ttsRub' | 'sttRub' | 'rub' | 'ttsChars' | 'sttSec'>>
function track(d: Day, t: Total, who: Judge | undefined, delta: UsageDelta) {
  if (!who) return
  for (const target of [d, t]) {
    if (!Object.hasOwn(target.judges, who.id)) Object.defineProperty(target.judges, who.id, { enumerable: true, writable: true, configurable: true,
      value: { ...who, turns: 0, starts: 0, finishes: 0, llmCalls: 0, llmRub: 0, ttsRub: 0, sttRub: 0, rub: 0, ttsChars: 0, sttSec: 0, lastAt: '' } })
    const row = target.judges[who.id]
    row.name = who.name
    row.lastAt = new Date().toISOString()
    for (const key of Object.keys(delta) as (keyof UsageDelta)[]) row[key] = r4(row[key] + delta[key]!)
  }
  console.log(`[расход] судья=${JSON.stringify(who.name)} id=${who.id} ${JSON.stringify(delta)}`)
}

export function makeBudget(dir = join(CACHE_DIR, 'usage'), env = process.env) {
  let day: Day = empty('')
  let loadingDay: Promise<Day> | undefined
  let total: Total | undefined
  let writing = Promise.resolve()
  let reserving = Promise.resolve()
  let unreadable = false
  const totalFile = join(dir, 'total.json')

  /** Общий счёт: один раз с диска, дальше из памяти. Нет файла — начинаем с нуля и сразу пишем. */
  async function loadTotal(): Promise<Total> {
    if (total) return total
    let t: Total
    let fresh = false
    try {
      t = TotalFile.parse(JSON.parse(await readFile(totalFile, 'utf8')))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        unreadable = true
        throw new Error('Не удалось прочитать бюджет')
      }
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
    if (loadingDay) { await loadingDay; return load() }
    loadingDay = (async () => {
      try {
        day = { ...DayFile.parse(JSON.parse(await readFile(join(dir, `${date}.json`), 'utf8'))), date }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          day = empty('')
          unreadable = true
          throw new Error('Не удалось прочитать бюджет')
        }
        day = empty(date)
      }
      return day
    })()
    try { await loadingDay } finally { loadingDay = undefined }
    return day
  }

  function save(previousDay?: Day) {
    const files: [string, Day | Total][] = []
    if (previousDay && previousDay !== day) files.push([join(dir, `${previousDay.date}.json`), structuredClone(previousDay)])
    if (day.date) files.push([join(dir, `${day.date}.json`), structuredClone(day)])
    if (total) files.push([totalFile, structuredClone(total)])
    writing = writing
      .then(() => Promise.all(files.map(([f, s]) => writeJson(f, s))))
      .then(() => {})
      .catch((e) => {
        unreadable = true
        console.warn(`[бюджет] не записал ${dir}: ${(e as Error).message}`)
      })
    return writing
  }

  async function both() {
    return [await load(), await loadTotal()] as const
  }

  /** Режим по уже известному счёту — без диска, для /api/health и ключа кэша. */
  function modeNow(): Mode {
    if (unreadable) return 'offline'
    const l = limits(env)
    const t = total?.rub ?? 0
    const d = day.date === today() ? day.rub : 0
    if (t >= l.total || d >= l.rub) return 'offline'
    if (t >= l.total * 0.8 || d >= l.rub * 0.8) return 'lite'
    return 'pro'
  }

  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const job = reserving.then(run)
    reserving = job.then(() => {}, () => {})
    return job
  }

  async function mode(): Promise<Mode> {
    try { await both() } catch { return 'offline' }
    return modeNow()
  }

  return {
    dir,
    modeNow,
    mode,
    async addPlay(start: boolean, finish: boolean) {
      const who = usageContext.getStore()
      if (!who) return
      // Статистика не должна останавливать бесплатную встречу при повреждении счёта.
      const state = await both().catch(() => undefined)
      if (!state || unreadable) return
      const [d, t] = state
      track(d, t, who, { turns: 1, starts: Number(start), finishes: Number(finish) })
      await save()
    },
    /** rub — готовая цена (AITunnel пишет её в ответе), иначе по тарифу YandexGPT */
    async addLlm(model: string, tokensIn: number, tokensOut: number, price?: number) {
      const rub = price ?? priceOf(model, tokensIn, tokensOut, env)
      checkAmounts(tokensIn, tokensOut, rub)
      const [d, t] = await both()
      if (!Object.hasOwn(d.llm, model)) Object.defineProperty(d.llm, model, { enumerable: true, writable: true, configurable: true,
        value: { in: 0, out: 0, calls: 0, rub: 0 } })
      const m = d.llm[model]
      m.in += tokensIn
      m.out += tokensOut
      m.calls += 1
      m.rub = Math.round((m.rub + rub) * 1e4) / 1e4
      d.rub = r4(d.rub + rub)
      t.llmRub = r4(t.llmRub + rub)
      t.rub = r4(t.rub + rub)
      track(d, t, usageContext.getStore(), { llmCalls: 1, llmRub: rub, rub })
      await save()
    },
    /** Озвучка: общий бюджет не кончился и (если задан) хватает суточного лимита символов. */
    async ttsAllowed(chars: number) {
      if (await mode() === 'offline') return false
      const [d] = await both()
      return modeNow() !== 'offline' && d.ttsChars + chars <= limits(env).ttsChars
    },
    /** Резерв до очереди; отказ возвращает деньги и символы ровно один раз. */
    reserveTts(chars: number, live = false, rub = ttsPrice(chars, live, env)) {
      const who = usageContext.getStore()
      return serial(async () => {
        if (await mode() === 'offline') return undefined
        const [d, t] = await both()
        const l = limits(env)
        if (chars < 0 || rub < 0 || !Number.isFinite(chars + rub) || d.ttsChars + chars > l.ttsChars || t.rub + rub > l.total || d.rub + rub > l.rub) return undefined
        d.ttsChars += chars
        t.ttsChars += chars
        d.rub = r4(d.rub + rub)
        t.rub = r4(t.rub + rub)
        t.ttsRub = r4(t.ttsRub + rub)
        track(d, t, who, { ttsChars: chars, ttsRub: rub, rub })
        await save()
        let released = false
        return { release: () => serial(async () => {
          if (released) return
          released = true
          d.ttsChars -= chars
          t.ttsChars -= chars
          d.rub = r4(d.rub - rub)
          t.rub = r4(t.rub - rub)
          t.ttsRub = r4(t.ttsRub - rub)
          track(d, t, who, { ttsChars: -chars, ttsRub: -rub, rub: -rub })
          // Резерв мог пережить полночь.
          await save(d)
        }) }
      })
    },
    /** rub — готовая цена (внешний TTS), иначе считаем по тарифу SpeechKit */
    async addTts(chars: number, live = false, rub = ttsPrice(chars, live, env)) {
      checkAmounts(chars, rub)
      const [d, t] = await both()
      d.ttsChars += chars
      t.ttsChars += chars
      t.ttsRub = r4(t.ttsRub + rub)
      t.rub = r4(t.rub + rub)
      d.rub = r4(d.rub + rub)
      track(d, t, usageContext.getStore(), { ttsChars: chars, ttsRub: rub, rub })
      await save()
    },
    /** Атомарно занимаем секунды и деньги до запроса, включая параллельные попытки. */
    reserveStt(sec: number, rub = sttPrice(sec, env)): Promise<boolean> {
      const who = usageContext.getStore()
      const job = reserving.then(async () => {
        if (await mode() === 'offline') return false
        const [d, t] = await both()
        const l = limits(env)
        if (sec < 0 || rub < 0 || !Number.isFinite(sec + rub) || d.sttSec + sec > l.sttSec || t.rub + rub > l.total || d.rub + rub > l.rub) return false
        d.sttSec = Math.round((d.sttSec + sec) * 10) / 10
        t.sttSec = Math.round((t.sttSec + sec) * 10) / 10
        t.sttRub = r4(t.sttRub + rub)
        t.rub = r4(t.rub + rub)
        d.rub = r4(d.rub + rub)
        track(d, t, who, { sttSec: sec, sttRub: rub, rub })
        await save()
        return true
      })
      reserving = job.then(() => {}, () => {})
      return job
    },
    async sttAllowed() {
      if (await mode() === 'offline') return false
      const [d] = await both()
      return modeNow() !== 'offline' && d.sttSec < limits(env).sttSec
    },
    async addStt(sec: number, rub = sttPrice(sec, env)) {
      checkAmounts(sec, rub)
      const [d, t] = await both()
      d.sttSec = Math.round((d.sttSec + sec) * 10) / 10
      t.sttSec = Math.round((t.sttSec + sec) * 10) / 10
      t.sttRub = r4(t.sttRub + rub)
      t.rub = r4(t.rub + rub)
      d.rub = r4(d.rub + rub)
      track(d, t, usageContext.getStore(), { sttSec: sec, sttRub: rub, rub })
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
      const judges = Object.values(t.judges).map((j) => `${JSON.stringify(j.name)}: ${j.turns} ходов, ${j.starts} начал, ${j.finishes} завершений, ${j.rub.toFixed(2)} ₽`).join('; ')
      return (
        `[бюджет] всего ${t.rub.toFixed(2)} из ${l.total} ₽ с ${t.since.slice(0, 10)} (модель ${t.llmRub.toFixed(2)}, озвучка ${t.ttsRub.toFixed(2)}, распознавание ${t.sttRub.toFixed(2)}), режим ${modeNow()}; ` +
        `${d.date}: расход ${d.rub.toFixed(2)}${lim(l.rub)} ₽${models ? ` (${models})` : ''}; озвучка ${d.ttsChars}${lim(l.ttsChars)} симв.; распознавание ${d.sttSec}${lim(l.sttSec)} с${judges ? `; судьи: ${judges}` : ''}`
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
  const tick = () => b.summary().then((s) => console.log(`${new Date().toISOString()} ${s}`)).catch(() => console.warn('[бюджет] счёт недоступен, платные запросы закрыты'))
  void tick()
  setInterval(tick, 3600_000).unref()
}
