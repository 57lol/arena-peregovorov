// Судья «кто чему рад» для прогонов scripts/sides5-live.ts. По каждой реплике собеседника: факты по очкам движка
// (что для него уступка, что выигрыш) → LLM-судья выписывает оценочные высказывания (радость, благодарность, «моя
// уступка», «твой шаг», просьбы) и сам отмечает ошибки → код сверяет высказывания с очками. Ошибка хода — если её
// нашёл код (сверка с очками) или судья; разногласия печатаются для ручного разбора.
//   npx tsx scripts/sides5-judge.ts <прогон.json> [--model aitunnel:claude-sonnet-5.5] [--out судейство.json]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const flag = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
process.env.AITUNNEL_API_KEY ??= readFileSync(resolve(process.env.HOME!, 'Arena-materials/.aitunnel_key'), 'utf8').trim()
const src = resolve(args[0])
const out = resolve(flag('out') ?? src.replace(/\.json$/, '.judged.json'))
process.env.CACHE_DIR = `${out}.cache`
mkdirSync(process.env.CACHE_DIR, { recursive: true })
const { llmFromSpec } = await import('../src/server/llm')
const { cached } = await import('../src/server/cache')
const { budget } = await import('../src/server/budget')

type Offer = Record<string, number>
interface Case { title: string; lang: string; character: string; player: string; issues: { id: string; title: string; kind: string; options: string[] }[]; P: Record<string, number[]>; O: Record<string, number[]> }
interface Turn {
  n: number; strategy: string; text: string; analysis: { offer?: Offer; accepts?: boolean }
  decision: { kind: string; reason?: string; offer?: Offer; feigned?: string[]; final?: boolean; interestId?: string }
  prev: Offer; stanceBefore: Offer; stance: Offer; position: Offer; status: string; opener?: string; line: string; source: string
  ms?: { ttft?: number; first?: number; done?: number }
}
interface Game { case: string; game: string; turns: Turn[] }
const run = JSON.parse(readFileSync(src, 'utf8')) as { cases: Record<string, Case>; games: Game[] }

// ——— факты по очкам ———

const who = (c: Case) => c.character.split(',')[0].split(' ')[0]
const rank = (xs: number[], x: number) => {
  const max = Math.max(...xs), min = Math.min(...xs)
  return xs[x] >= max ? 'ЛУЧШЕЕ' : xs[x] <= min ? 'ХУДШЕЕ' : 'среднее'
}
function prefs(c: Case): string {
  const name = who(c)
  return c.issues.map((i) => {
    const o = c.O[i.id], p = c.P[i.id]
    const order = (xs: number[]) => i.options.map((x, n) => ({ x, v: xs[n] })).sort((a, b) => b.v - a.v).map((x) => `«${x.x}»`).join(' > ')
    return `- ${i.id} «${i.title}»${i.kind === 'compatible' ? ' (совместимый: лучший вариант выгоден обоим)' : ''}: ${i.options.map((x, n) => `${n} «${x}»`).join(', ')}.\n  Для ${name} от лучшего к худшему: ${order(o)}. Для игрока: ${order(p)}.`
  }).join('\n')
}

function facts(c: Case, t: Turn): string {
  const name = who(c)
  const opt = (id: string, x: number) => `«${c.issues.find((i) => i.id === id)!.options[x]}»`
  const lines: string[] = []
  const named = t.analysis.offer ?? {}
  for (const i of c.issues) {
    const x = named[i.id]
    if (typeof x !== 'number') continue
    const O = c.O[i.id], P = c.P[i.id], ref = t.prev[i.id], was = t.stanceBefore[i.id]
    let s = `игрок назвал ${i.id}=${opt(i.id, x)}: для ${name} это ${rank(O, x)}`
    if (i.kind === 'compatible') s += O[x] >= Math.max(...O) && P[x] >= Math.max(...P) ? ' — выгодно обоим' : ''
    else if (typeof ref === 'number') {
      if (x === ref) s += `, совпадает с листком ${name} — игрок СОГЛАШАЕТСЯ на его условие${P[x] < Math.max(...P) ? ' (игроку это чего-то стоит: это УСТУПКА ИГРОКА)' : ' (игроку это тоже лучшее)'}`
      else if (O[x] > O[ref]) s += `, для ${name} даже лучше его листка ${opt(i.id, ref)} — УСТУПКА ИГРОКА`
      else s += `, хуже для ${name}, чем его листок ${opt(i.id, ref)} — ТРЕБОВАНИЕ ИГРОКА в свою пользу`
    }
    if (typeof was === 'number' && was !== x) s += `; раньше игрок просил ${opt(i.id, was)} — это шаг ${O[x] > O[was] ? `К ${name}` : `ОТ ${name} (игрок просит больше)`}`
    lines.push(s)
  }
  if (t.analysis.accepts) lines.push(`игрок соглашается на листок ${name} целиком`)
  if (!lines.length) lines.push('игрок не назвал условий')
  const d = t.decision
  const dec: string[] = []
  if (d.kind === 'accept') {
    const gave = c.issues.filter((i) => i.kind !== 'compatible' && c.O[i.id][t.position[i.id]] < Math.max(...c.O[i.id])).map((i) => `${i.id}=${opt(i.id, t.position[i.id])}`)
    const got = c.issues.filter((i) => c.O[i.id][t.position[i.id]] >= Math.max(...c.O[i.id])).map((i) => `${i.id}=${opt(i.id, t.position[i.id])}`)
    dec.push(`${name} СОГЛАШАЕТСЯ на сделку. Для него в ней лучшее: ${got.join(', ') || 'ничего'}; уступлено им (не лучшее для него): ${gave.join(', ') || 'ничего'}`)
  } else {
    dec.push(`решение: ${d.kind}${d.reason ? ':' + d.reason : ''}`)
    for (const i of c.issues) {
      const a = t.prev[i.id], b = t.position[i.id]
      if (typeof b !== 'number' || a === b) continue
      const O = c.O[i.id]
      if (typeof a !== 'number') { dec.push(`${name} вписывает ${i.id}=${opt(i.id, b)}${i.kind === 'compatible' ? ' (совместимый, выгоден обоим)' : ''}`); continue }
      const mine = t.stance[i.id] === b ? ' — ровно то, что просил игрок' : ''
      dec.push(O[b] < O[a] ? `${name} УСТУПАЕТ по ${i.id}: было ${opt(i.id, a)}, теперь ${opt(i.id, b)} (ему хуже, игроку лучше)${mine}` : `${name} по ${i.id}: было ${opt(i.id, a)}, теперь ${opt(i.id, b)} — ему ЛУЧШЕ${mine ? ' — берёт уступку игрока' : ' (забирает назад)'}`)
    }
    if (dec.length === 1) dec.push(`листок ${name} не меняется`)
    if (d.feigned?.length) dec.push(`по замыслу игры ${d.feigned.join(', ')} он может выдать за свою уступку (ложная уступка) — это не ошибка`)
  }
  return `Игрок сделал так:\n  - ${lines.join('\n  - ')}\nДвижок: ${dec.join('; ')}.`
}

// ——— судья ———

const SYSTEM = `Ты строгий редактор игры-тренажёра переговоров. Персонаж (собеседник) торгуется с игроком. Его реплики пишет нейросеть по решению движка. Твоя задача — найти места, где персонаж путает, что выгодно ему, а что игроку. Кому что выгодно, сказано в фактах по очкам движка: верь им, а не своему ощущению.

Сначала по каждому ходу выпиши ВСЕ оценочные высказывания персонажа о конкретном условии, о шаге игрока или о сделке (statements):
- quote — точная цитата из реплики;
- issue — id пункта; "move" — о шаге/словах игрока в целом; "deal" — о сделке целиком;
- option — точный текст варианта из списка пункта, если ясно, о каком варианте речь, иначе null;
- attitude:
  "glad" — радуется, хвалит, одобряет с удовольствием («отлично», «вот это разговор», «красиво», «приятно слышать», «I'm glad», «very nice», «good»);
  "thanks" — благодарит;
  "accepts" — принимает по-деловому или нехотя («ладно, так и быть», «тут сойдёмся», «okay, I can do that», «I take it»);
  "rejects" — отказывает, недоволен, «не пойдёт», «слишком», «это мне не подходит»;
  "gives" — называет своей уступкой, подарком, шагом навстречу игроку («уступлю», «это моя уступка», «I give you», «I move here», «for you I...»);
  "received" — говорит о нём как о том, что получает: уступка или шаг игрока к нему, «ты мне дал», «беру», «принимаю», «I take it», или то, ЗА ЧТО он сам теперь уступает («за это я двигаю цену», «for this I move»);
  "demands" — просит или требует это от игрока для себя, ставит игроку условием («дай мне», «только если ты», «I need from you»). Своё предложение «давай X», «let's do X», «I can do X» — это не demands, а его вариант (не выписывай или "gives");
  "nothing_given" — прямо говорит, что игрок ничего не дал, не сдвинулся, только берёт. «Ещё не всё», «остальное ещё обсудим» — не это.
quote — коротко, до 10 слов. Простая констатация условий без оценки («сто восемьдесят», «payment fifty percent») — не высказывание, не выписывай. Заход (первые слова до продолжения) — часть реплики.

Потом сам отметь ошибки (errors), только если они явно есть:
E1 — радуется, хвалит или одобряет с удовольствием то, что ему невыгодно: свою же уступку или требование игрока в пользу игрока.
E2 — недоволен выгодным: отвергает или обесценивает то, что ему выгодно (уступку игрока, своё лучшее), или говорит «ты ничего не дал / только берёшь», когда игрок в этом ходе уступил.
E3 — путает, кто уступает: называет своей уступкой то, что получает или что ему ничего не стоит; называет уступкой игрока (или тем, за что сам двигается) то, что уступает сам или что выгодно игроку.
E4 — просит или требует у игрока то, что выгодно игроку, а ему хуже его собственного листка.
E5 — благодарит за то, что ему невыгодно.
НЕ ошибки: нехотя принять свою уступку («ладно, восемь недель так восемь»); радоваться шагу игрока к нему, даже если тот ещё не дошёл до его листка; радоваться сделке, когда движок соглашается; вежливость и шутки не про условия; ложная уступка, если факты говорят, что она по замыслу; отказ по требованию игрока в пользу игрока.

Ответ — только JSON: {"turns":[{"n":номер хода,"statements":[{"quote":"…","issue":"…","option":null,"attitude":"…"}],"errors":[{"type":"E1","quote":"…","why":"коротко"}]}]}`

function userFor(c: Case, g: Game): string {
  const name = who(c)
  const turns = g.turns.map((t) => `### Ход ${t.n}\nИгрок: «${t.text}»\n${facts(c, t)}\nЛисток ${name} до хода: ${fmt(c, t.prev)}.\nРеплика ${name}: «${t.line}»`).join('\n\n')
  return `Дело «${c.title}». Персонаж: ${c.character}. Игрок: ${c.player}.
Пункты и варианты:
${prefs(c)}

Начальный листок ${name}: ${fmt(c, g.turns[0]?.prev ?? {})}.

${turns}`
}
const fmt = (c: Case, o: Offer) => c.issues.filter((i) => typeof o[i.id] === 'number').map((i) => `${i.id}=«${i.options[o[i.id]]}»`).join(', ') || '—'

// ——— сверка с очками ———

interface Statement { quote: string; issue: string; option: number | string | null; attitude: string }
/** вариант по тексту судьи (или номеру) */
function optionOf(i: { options: string[] }, o: Statement['option']): number | undefined {
  if (typeof o === 'number') return i.options[o] ? o : undefined
  if (typeof o !== 'string') return undefined
  const norm = (t: string) => t.toLowerCase().replace(/[«»"\s ]/g, '')
  const k = i.options.findIndex((x) => norm(x) === norm(o))
  return k >= 0 ? k : i.options.findIndex((x) => norm(x).includes(norm(o)) || norm(o).includes(norm(x))) >= 0 ? i.options.findIndex((x) => norm(x).includes(norm(o)) || norm(o).includes(norm(x))) : undefined
}
interface Verdict { n: number; statements: Statement[]; errors: { type: string; quote: string; why: string }[] }

/** Высказывание против очков: ошибка (тип) или undefined. */
function scoreStatement(c: Case, t: Turn, s: Statement, all: Statement[] = []): string | undefined {
  const i = c.issues.find((x) => x.id === s.issue)
  const feigned = t.decision.feigned ?? []
  if (s.issue === 'move') {
    const named = Object.keys(t.analysis.offer ?? {})
    const toward = t.analysis.accepts || named.some((id) => {
      const O = c.O[id], x = t.analysis.offer![id], ref = t.prev[id], was = t.stanceBefore[id]
      return (typeof ref === 'number' && O[x] >= O[ref] && c.P[id][x] < Math.max(...c.P[id])) || (typeof was === 'number' && O[x] > O[was])
    })
    if ((s.attitude === 'glad' || s.attitude === 'thanks' || s.attitude === 'received') && !toward && named.length) return 'E1'
    // «за карту спасибо, а по чайнику вы ничего не принесли» — шаг признан, «ничего» про остальное
    if (s.attitude === 'nothing_given' && toward && !all.some((x) => ['glad', 'thanks', 'received', 'accepts'].includes(x.attitude))) return 'E2'
    return undefined
  }
  const x = i ? optionOf(i, s.option) : undefined
  if (!i || x === undefined) return undefined
  const O = c.O[i.id], P = c.P[i.id], ref = t.prev[i.id], was = t.stanceBefore[i.id]
  const bothBest = O[x] >= Math.max(...O) && P[x] >= Math.max(...P)
  const good = typeof ref === 'number' ? O[x] >= O[ref] : O[x] >= Math.max(...O)
  const stepToward = typeof was === 'number' && t.stance[i.id] === x && O[x] > O[was]
  switch (s.attitude) {
    case 'glad':
      return good || bothBest || stepToward ? undefined : 'E1'
    case 'thanks':
      return good || bothBest || stepToward ? undefined : 'E5'
    case 'rejects':
      // «моя цена остаётся» — держит своё, а не отвергает выгодное
      return typeof ref === 'number' && O[x] >= O[ref] && !bothBest && t.position[i.id] !== x ? 'E2' : undefined
    case 'gives':
      return O[x] >= Math.max(...O) && !feigned.includes(i.id) && !(i.kind === 'compatible') ? 'E3' : undefined
    case 'received':
      // «беру», «твой шаг», «за это я…» — о том, что он сам отдаёт (хуже его листка), а не о шаге игрока к нему
      return (typeof ref === 'number' ? O[x] < O[ref] : O[x] < Math.max(...O)) && !stepToward && !bothBest ? 'E3' : undefined
    case 'demands':
      return typeof ref === 'number' && O[x] < O[ref] ? 'E4' : undefined
    default:
      return undefined
  }
}

const model = llmFromSpec(flag('model') ?? 'aitunnel:claude-sonnet-5.5')
const rub0 = (await budget().total() as unknown as { llmRub: number }).llmRub
const only = flag('cases')?.split(',')
// судья-субагент: --export пишет промпты по партиям, --import читает его вердикты (<дело>__<партия>.json)
const exportDir = flag('export'), importDir = flag('import')
if (exportDir) { mkdirSync(exportDir, { recursive: true }); writeFileSync(join(exportDir, 'SYSTEM.txt'), SYSTEM) }
const results: { case: string; game: string; turns: (Turn & { verdict: Verdict; code: { type: string; quote: string }[]; judge: { type: string; quote: string; why: string }[]; bad: boolean })[] }[] = []
const queue = run.games.filter((g) => g.turns.length && (!only || only.includes(g.case)))
const par = Number(flag('par') ?? 4)
let next = 0
async function worker() {
  while (next < queue.length) {
    const g = queue[next++]
    const c = run.cases[g.case]
    const user = userFor(c, g)
    let v: { turns: Verdict[] } = { turns: [] }
    const file = `${g.case}__${g.game}`
    if (exportDir) { writeFileSync(join(exportDir, `${file}.txt`), user); continue }
    if (importDir) {
      try { v = JSON.parse(readFileSync(join(importDir, `${file}.json`), 'utf8')) } catch { console.error(`нет вердикта ${file}`) }
    } else try {
      v = (await cached('judge', { v: 'j4', m: model.model, SYSTEM, user }, async () => (await model.json({ system: SYSTEM, user, temperature: 0, maxTokens: 2500, timeoutMs: 90_000 })) as { turns: Verdict[] })).value
    } catch (e) {
      console.error(`судья не ответил: ${g.case}/${g.game}: ${(e as Error).message}`)
    }
    results.push({
      case: g.case, game: g.game,
      turns: g.turns.map((t) => {
        const verdict = v.turns?.find((x) => x.n === t.n) ?? { n: t.n, statements: [], errors: [] }
        const code = (verdict.statements ?? []).map((s) => ({ type: scoreStatement(c, t, s, verdict.statements ?? []), quote: s.quote, s })).filter((x) => x.type).map((x) => ({ type: x.type!, quote: `${x.quote} [${x.s.issue}${x.s.option ?? ''}:${x.s.attitude}]` }))
        const judge = verdict.errors ?? []
        return { ...t, verdict, code, judge, bad: code.length > 0 || judge.length > 0 }
      }),
    })
  }
}
await Promise.all(Array.from({ length: par }, worker))
if (exportDir) { console.log(`промпты судьи → ${exportDir}`); process.exit(0) }
results.sort((a, b) => a.case.localeCompare(b.case) || a.game.localeCompare(b.game))
const rub = (await budget().total() as unknown as { llmRub: number }).llmRub - rub0

// ——— сводка ———
const byCase = new Map<string, { n: number; bad: number; code: number; judge: number }>()
for (const g of results) for (const t of g.turns) {
  const r = byCase.get(g.case) ?? { n: 0, bad: 0, code: 0, judge: 0 }
  r.n++; r.bad += +t.bad; r.code += +(t.code.length > 0); r.judge += +(t.judge.length > 0)
  byCase.set(g.case, r)
}
const total = [...byCase.values()].reduce((a, r) => ({ n: a.n + r.n, bad: a.bad + r.bad, code: a.code + r.code, judge: a.judge + r.judge }), { n: 0, bad: 0, code: 0, judge: 0 })
console.log('дело | ходов | с ошибкой | по очкам | по судье')
for (const [k, r] of [...byCase.entries()].sort()) console.log(`${k} | ${r.n} | ${r.bad} | ${r.code} | ${r.judge}`)
console.log(`ВСЕГО | ${total.n} | ${total.bad} (${((100 * total.bad) / Math.max(1, total.n)).toFixed(1)}%) | ${total.code} | ${total.judge}`)
console.log('\n— ошибки —')
for (const g of results) for (const t of g.turns) if (t.bad) {
  console.log(`\n[${g.case}/${g.game} ход ${t.n} ${t.strategy}] ${t.decision.kind}${t.decision.reason ? ':' + t.decision.reason : ''}\n  игрок: ${t.text}\n  заход: ${t.opener ?? '-'}\n  реплика: ${t.line}`)
  for (const e of t.code) console.log(`  очки ${e.type}: ${e.quote}`)
  for (const e of t.judge) console.log(`  судья ${e.type}: «${e.quote}» — ${e.why}`)
}
console.log(`\nрасход судьи: ${rub.toFixed(2)} ₽`)
writeFileSync(out, JSON.stringify({ rub, total, byCase: Object.fromEntries(byCase), results }, null, 1))
