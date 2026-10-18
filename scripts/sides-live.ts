// Живая проверка разметки на трудных репликах «кому что выгодно»: Claude Sonnet (как на проде) и YandexGPT Pro (запасной).
// Платно: ~20 реплик × 2 модели ≈ 50–60 ₽. Без --live только печатает план.
//   AITUNNEL_API_KEY=… YANDEX_API_KEY=… YANDEX_FOLDER_ID=… npx tsx scripts/sides-live.ts --live [--out папка]
// Каждая реплика — в разговоре: последняя фраза собеседника и его листок. Итог — разметка модели после проверки
// словами игрока (analyzeMove) и после правила «да, давайте» (withBareYes), как в ходе на сервере.

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getScenario } from '../src/content/scenarios'
import { BEHAVIOR_DICT } from '../src/engine/behaviors'
import { withBareYes } from '../src/engine/offline'
import { initialState } from '../src/engine/turn'
import type { Offer, TurnRecord } from '../src/engine/types'
import { analyzeMove } from '../src/server/analyze'
import { aitunnel, DEFAULT_ANALYZE_MODEL, yandex } from '../src/server/llm'

interface Case {
  sc: string
  said: string          // последняя фраза собеседника
  sheet: Offer          // его листок
  text: string          // реплика игрока
  want: Offer           // что игрок предлагает (пусто — ничего)
  never?: Offer         // чего в разметке быть не должно (отказ, чужой пункт)
  accepts?: boolean
}

const CASES: Case[] = [
  { sc: 'shop', said: 'Я слушаю, не торопитесь. Что скажете: десять и виртуальная, или опять пятнадцать?', sheet: { swap: 3, disc: 2, card: 2, paper: 2 }, text: 'Давайте десять и пластиковую.', want: { disc: 2, card: 1 }, never: { swap: 1 } },
  { sc: 'shop', said: 'Права свои знаю не хуже вас. Ладно, обмен сегодня — тут сойдёмся. Только с актом: фото, подписи.', sheet: { swap: 3, disc: 0, card: 2, paper: 2 }, text: 'Я соглашусь на акт с фото и подписями, только если скидку дадите 15%.', want: { paper: 2, disc: 3 } },
  { sc: 'shop', said: 'Пластиковую так пластиковую. У нас обмен сегодня и десять.', sheet: { swap: 3, disc: 2, card: 1, paper: 2 }, text: 'Да, давайте.', want: {}, accepts: true },
  { sc: 'shop', said: 'Пластиковую так пластиковую. У нас обмен сегодня и десять.', sheet: { swap: 3, disc: 2, card: 1, paper: 2 }, text: 'Окей.', want: {} },
  { sc: 'shop', said: 'Чек есть? Нет? Тогда только проверка до 20 дней, по регламенту.', sheet: { swap: 0, disc: 0, card: 2 }, text: 'Только не проверка на двадцать дней, мне чайник сегодня нужен.', want: {}, never: { swap: 0 } },
  { sc: 'shop', said: 'Виртуальная карта у вас есть? Нет — оформлю за минуту.', sheet: { swap: 0, disc: 0, card: 2 }, text: 'Карту не надо, рассылкой завалите.', want: { card: 0 }, never: { card: 2 } },
  { sc: 'tara', said: 'Двести двенадцать за короб, оплата по факту отгрузки.', sheet: { price: 0, payment: 0, rush: 0, term: 3 }, text: 'Давай дешевле, и отсрочку побольше.', want: {} },
  { sc: 'tara', said: 'Договор на два года — и тогда поговорим о цене.', sheet: { price: 0, payment: 0, rush: 0, term: 3 }, text: 'Согласен на 2 года, если цена 188.', want: { term: 3, price: 3 } },
  { sc: 'tara', said: 'Двести четыре — это уже со скидкой.', sheet: { price: 1, payment: 0, rush: 0, term: 3 }, text: '204 — нет, это дорого. Давайте 196.', want: { price: 2 }, never: { price: 1 } },
  { sc: 'client', said: 'Двенадцать процентов, иначе уходим в Нинбо.', sheet: { price: 4, term: 0, payment: 4, stock: 3 }, text: 'Снижение 12% — не пойдёт, могу 3%.', want: { price: 1 }, never: { price: 4 } },
  { sc: 'client', said: 'Цена твёрдая на год, никакой индексации.', sheet: { price: 4, term: 0, payment: 4, stock: 3 }, text: 'Без индексации мы не работаем, давайте раз в квартал.', want: { index: 2 }, never: { index: 0 } },
  { sc: 'offer', said: 'Мне нужна квартира на год, иначе переезд не потяну.', sheet: { salary: 4, start: 3, housing: 3, study: 2 }, text: 'Квартира на год — нет, это много. Общежитие на три месяца дадим.', want: { housing: 1 }, never: { housing: 3 } },
  { sc: 'offer', said: 'Двести десять и выход через два месяца.', sheet: { salary: 4, start: 3, housing: 3, study: 2 }, text: 'Готовы на 180, если выйдете через две недели.', want: { salary: 2, start: 0 }, never: { housing: 2 } },
  { sc: 'china', said: 'Друг, сто процентов предоплата через Alipay, так все работают.', sheet: { price: 0, moq: 0, delivery: 0, payment: 0 }, text: 'Только не стопроцентная предоплата. Аккредитив после инспекции.', want: { payment: 2 }, never: { payment: 0 } },
  { sc: 'china', said: 'Сорок четыре юаня, друг, это уже хорошая цена.', sheet: { price: 1, moq: 0, delivery: 0, payment: 0 }, text: 'Давайте 40.', want: { price: 2 }, never: { delivery: 0 } },
  { sc: 'istanbul', said: 'We work with 100% upfront, that is standard for new customers.', sheet: { price: 0, payment: 0, delivery: 0, warranty: 0 }, text: 'Not 100% upfront, no way. Fifty-fifty.', want: { payment: 2 }, never: { payment: 0 } },
  { sc: 'dorm', said: 'Выходные допоздна — это святое, братан.', sheet: { wifi: 0, quiet: 0, cleaning: 0, guests: 3 }, text: 'Только не выходные допоздна, давай до 22:00.', want: { guests: 1 }, never: { guests: 3 } },
  { sc: 'stop', said: 'Телефон дай позвонить — в руки.', sheet: { phone: 0, money: 0, sorry: 3 }, text: 'Телефон доставать не буду.', want: { phone: 3 }, never: { phone: 0 } },
  { sc: 'launch', said: 'Плюс пятьдесят процентов за ночь, иначе никто не выйдет.', sheet: { pay: 3, start: 0, bus: 2, food: 2 }, text: 'Плюс пятьдесят — нет, много. Сорок процентов, если старт со среды.', want: { pay: 2, start: 1 }, never: { pay: 3 } },
]

const live = process.argv.includes('--live')
const outDir = (() => { const i = process.argv.indexOf('--out'); return i < 0 ? join(homedir(), 'Arena-materials/final/sides-live') : process.argv[i + 1] })()
if (!live) {
  console.log(`План: ${CASES.length} реплик × 2 модели (Claude ${DEFAULT_ANALYZE_MODEL} через AITunnel и YandexGPT Pro). Платно — запуск с --live.`)
  for (const c of CASES) console.log(`  ${c.sc}: «${c.text}»`)
  process.exit(0)
}
process.env.CACHE_DIR ??= join(outDir, 'cache')
mkdirSync(outDir, { recursive: true })

const models = [
  { name: 'claude', llm: aitunnel(DEFAULT_ANALYZE_MODEL) },
  { name: 'yandex', llm: yandex(undefined, undefined, undefined, process.env.YANDEX_ANALYZE_MODEL ?? 'yandexgpt-5.1') },
]
const show = (o: Offer | undefined) => (!o || !Object.keys(o).length ? '—' : Object.entries(o).map(([k, v]) => `${k}=${v}`).join(', '))
const rows: unknown[] = []
let bad = 0
for (const c of CASES) {
  const sc = getScenario(c.sc)!
  const state = { ...initialState(sc), turn: 1, lastOpponentOffer: c.sheet, tableOffer: c.sheet }
  const history: TurnRecord[] = [{ turn: 1, playerText: '…', analysis: { behaviors: [] }, deltas: [], decision: { kind: 'counter', offer: c.sheet }, opponentLine: c.said, emotion: 'neutral', stateAfter: state }]
  for (const m of models) {
    const t0 = Date.now()
    const r = await analyzeMove(m.llm, sc, BEHAVIOR_DICT, history, c.text, c.sheet)
    const a = withBareYes(c.text, r.analysis, history)
    const got = a.offer ?? {}
    const miss = Object.entries(c.want).filter(([k, v]) => got[k] !== v).map(([k]) => k)
    const extra = Object.keys(got).filter((k) => c.want[k] === undefined)
    const wrong = Object.entries(c.never ?? {}).filter(([k, v]) => got[k] === v).map(([k]) => k)
    const acc = !!a.accepts === !!c.accepts
    const ok = !miss.length && !wrong.length && acc
    if (!ok) bad++
    rows.push({ sc: c.sc, text: c.text, model: m.name, source: r.source, error: r.error, offer: got, accepts: !!a.accepts, ok, miss, extra, wrong, ms: Date.now() - t0 })
    console.log(`${ok ? 'ок ' : 'НЕТ'} ${m.name.padEnd(6)} ${c.sc.padEnd(8)} «${c.text}» → ${show(got)}${a.accepts ? ' +согласие' : ''}${miss.length ? ` | не хватает: ${miss.join(', ')}` : ''}${wrong.length ? ` | ПЕРЕВЁРНУТО: ${wrong.join(', ')}` : ''}${extra.length ? ` | лишнее: ${extra.join(', ')}` : ''}${r.source !== 'llm' ? ` [${r.source}${r.error ? `: ${r.error.slice(0, 60)}` : ''}]` : ''}`)
  }
}
writeFileSync(join(outDir, 'results.json'), JSON.stringify(rows, null, 1))
console.log(`\nНе так: ${bad} из ${rows.length}. Подробно: ${join(outDir, 'results.json')}`)
