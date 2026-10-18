// «Кто чему рад»: живые партии по стратегиям игрока, построенным по таблицам дел. Разметка задана кодом (без модели),
// решение — движок, заход — YandexGPT Pro (как на проде), реплика — Claude Sonnet 5.5 через AITunnel. Судья — отдельно
// (scripts/sides5-judge.ts). Платно: только с --live.
//   npx tsx scripts/sides5-live.ts <выход.json> --live [--cases dorm,stop] [--games soft,hard,concede] [--budget 250]
//   [--hard-games hard,concede] [--no-opener] [--dry]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const flag = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const dry = process.argv.includes('--dry')
if (!dry && !process.argv.includes('--live')) { console.error('платно: добавьте --live (или --dry — без моделей)'); process.exit(1) }
process.env.AITUNNEL_API_KEY ??= readFileSync(resolve(process.env.HOME!, 'Arena-materials/.aitunnel_key'), 'utf8').trim()
try { process.loadEnvFile(resolve(process.env.HOME!, 'Arena/.env')) } catch { /* без Яндекса — без захода */ }
const out = resolve(args[0] ?? 'sides5-live.json')
process.env.CACHE_DIR = `${out}.cache`
mkdirSync(process.env.CACHE_DIR, { recursive: true })

const { voice } = await import('../src/server/voice')
const { writeOpener, spareOpener } = await import('../src/server/opener')
const { llmFromSpec } = await import('../src/server/llm')
const { dict, findScenario } = await import('../src/server/library')
const { initialState, step } = await import('../src/engine/turn')
const { withContext, withBareYes, isRude } = await import('../src/engine/offline')
const { budget } = await import('../src/server/budget')
const { unstress } = await import('../src/server/stress')
const { stripTags } = await import('../src/server/tags')
const { isEn } = await import('../src/engine/lang')
type Scenario = import('../src/engine/types').Scenario
type MoveAnalysis = import('../src/engine/types').MoveAnalysis
type Offer = import('../src/engine/types').Offer
type OpponentState = import('../src/engine/types').OpponentState
type TurnRecord = import('../src/engine/types').TurnRecord
const generated = JSON.parse(readFileSync(new URL('../src/engine/__fixtures__/generatedScenario.json', import.meta.url), 'utf8')) as Scenario

// ——— стратегии игрока по таблицам ———

type Move = { text: string; a: MoveAnalysis; label: string }

const P = (sc: Scenario, id: string) => sc.player.profile.points[id]
const O = (sc: Scenario, id: string) => sc.opponent.profile.points[id]
const best = (xs: number[]) => xs.indexOf(Math.max(...xs))
const worst = (xs: number[]) => xs.indexOf(Math.min(...xs))
const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs)
const deal = (sc: Scenario) => sc.issues.filter((i) => i.kind !== 'compatible')
/** пункты по важности для игрока / собеседника */
const forMe = (sc: Scenario) => [...deal(sc)].sort((a, b) => span(P(sc, b.id)) - span(P(sc, a.id)))
const forHim = (sc: Scenario) => [...deal(sc)].sort((a, b) => span(O(sc, b.id)) - span(O(sc, a.id)))
const sheetOf = (s: OpponentState): Offer => s.lastOpponentOffer ?? {}
/** вариант посередине между его листком и моим лучшим (по моим очкам) */
function mid(sc: Scenario, id: string, s: OpponentState): number {
  const p = P(sc, id), cur = sheetOf(s)[id] ?? best(O(sc, id)), mine = best(p)
  const want = (p[cur] + p[mine]) / 2
  let pick = mine
  for (const [n, v] of p.entries()) if (v >= want && v < p[pick] && O(sc, id)[n] >= O(sc, id)[mine]) pick = n
  return pick === cur ? mine : pick
}
const en = (sc: Scenario) => isEn(sc)
const say = (sc: Scenario, o: Offer) =>
  sc.issues.filter((i) => typeof o[i.id] === 'number').map((i) => `${en(sc) ? i.title.toLowerCase() : i.title.toLowerCase()} — ${i.options[o[i.id]!]}`).join(en(sc) ? ', and ' : ', ')

const MOVES: Record<string, (sc: Scenario, s: OpponentState) => Move> = {
  /** мягко: два своих главных пункта — посередине, совместимый — в выгодном обоим */
  soft: (sc, s) => {
    const o: Offer = {}
    for (const i of forMe(sc).slice(0, 2)) o[i.id] = mid(sc, i.id, s)
    const c = sc.issues.find((i) => i.kind === 'compatible')
    if (c) o[c.id] = best(P(sc, c.id))
    return { label: 'мягкая', a: { behaviors: [], offer: o }, text: en(sc) ? `Maybe we can meet somewhere here: ${say(sc, o)}. Would that work?` : `Может, так попробуем: ${say(sc, o)}? Мне так было бы удобнее.` }
  },
  /** жёстко: всё по максимуму для себя */
  hard: (sc) => {
    const o: Offer = Object.fromEntries(deal(sc).map((i) => [i.id, best(P(sc, i.id))]))
    return { label: 'жёсткая', a: { behaviors: [], offer: o }, text: en(sc) ? `My terms are simple: ${say(sc, o)}. That's what we need.` : `Мои условия такие: ${say(sc, o)}. Иначе нам неинтересно.` }
  },
  /** размен: ему его лучшее там, где ему важнее всего, а мне дёшево; себе — моё лучшее в моём главном */
  trade: (sc) => {
    const ratio = (id: string) => span(O(sc, id)) / Math.max(1, span(P(sc, id)))
    const give = [...deal(sc)].sort((a, b) => ratio(b.id) - ratio(a.id))[0]
    const take = forMe(sc).find((i) => i.id !== give.id)!
    const o: Offer = { [give.id]: best(O(sc, give.id)), [take.id]: best(P(sc, take.id)) }
    return { label: 'размен', a: { behaviors: [], offer: o }, text: en(sc) ? `Let's trade. ${give.title}: ${give.options[o[give.id]!]}, the way you want it. But then ${take.title.toLowerCase()}: ${take.options[o[take.id]!]}.` : `Давайте размен. ${give.title} — пусть будет по-вашему, ${give.options[o[give.id]!]}. А мне тогда ${take.title.toLowerCase()} — ${take.options[o[take.id]!]}.` }
  },
  /** уступка ему: его главный пункт — как он хочет, больше ничего не прошу */
  concede: (sc) => {
    const i = forHim(sc)[0]
    const o: Offer = { [i.id]: best(O(sc, i.id)) }
    return { label: 'уступка ему', a: { behaviors: [], offer: o }, text: en(sc) ? `Fine. ${i.title}: ${i.options[o[i.id]!]}, as you asked.` : `Хорошо. ${i.title} — как вы хотите: ${i.options[o[i.id]!]}.` }
  },
  /** отказ без своего варианта */
  refuse: (sc) => ({ label: 'отказ', a: { behaviors: [] }, text: en(sc) ? `No. That doesn't work for us at all.` : `Нет. Так нам совсем не подходит.` }),
  /** просьба о невыгодном ему: его худшее в его главном пункте */
  askBad: (sc) => {
    const i = forHim(sc)[0]
    const o: Offer = { [i.id]: worst(O(sc, i.id)) }
    return { label: 'просьба о невыгодном ему', a: { behaviors: [], offer: o }, text: en(sc) ? `And one more thing: ${i.title.toLowerCase()} — ${i.options[o[i.id]!]}.` : `И ещё: ${i.title.toLowerCase()} — ${i.options[o[i.id]!]}.` }
  },
  /** частичное согласие с его листком: два его главных пункта — как у него */
  agreePart: (sc, s) => {
    const sheet = sheetOf(s)
    const o: Offer = Object.fromEntries(forHim(sc).filter((i) => typeof sheet[i.id] === 'number').slice(0, 2).map((i) => [i.id, sheet[i.id]!]))
    return { label: 'согласие с его листком (часть)', a: { behaviors: [], offer: o }, text: en(sc) ? `On these two I agree with your sheet: ${say(sc, o)}.` : `По этим двум согласен с вашим листком: ${say(sc, o)}.` }
  },
  /** шаг за шагом, как капитан с Эмре: по одному пункту на ход — на вариант лучше для меня, чем у него в листке */
  nudge: (sc, s) => {
    const sheet = sheetOf(s)
    const tops = forMe(sc).slice(0, 3)
    const i = tops[(s.turn ?? 0) % tops.length]
    const p = P(sc, i.id), cur = sheet[i.id] ?? best(O(sc, i.id))
    const better = i.options.map((_, n) => n).filter((n) => p[n] > p[cur]).sort((a, b) => p[a] - p[b])[0] ?? best(p)
    const o: Offer = { [i.id]: better }
    return { label: 'шаг за шагом', a: { behaviors: [], offer: o }, text: en(sc) ? `What about ${i.title.toLowerCase()}: ${i.options[better]}?` : `А если ${i.title.toLowerCase()} — ${i.options[better]}?` }
  },
  /** согласие с его листком целиком */
  agreeAll: (sc) => ({ label: 'согласие с его листком', a: { behaviors: [], accepts: true }, text: en(sc) ? `Okay. I accept your terms as they are.` : `Ладно. Согласен на ваши условия, как на листке.` }),
}

const GAMES: Record<string, string[]> = {
  soft: ['soft', 'trade', 'agreeAll'],
  hard: ['hard', 'refuse', 'askBad'],
  concede: ['concede', 'agreePart', 'soft'],
  nudge: ['nudge', 'nudge', 'nudge', 'nudge'],
}

const BASE = ['dorm', 'stop', 'shop', 'launch', 'client', 'tara', 'offer', 'istanbul', 'lagos', 'china']
const want = (flag('cases') ?? [...BASE, 'gen', ...BASE.map((x) => `${x}-hard`)].join(',')).split(',')
const games = (flag('games') ?? 'soft,hard,concede').split(',')
const hardGames = (flag('hard-games') ?? 'hard,concede').split(',')
const limit = Number(flag('budget') ?? 300)

const speaker = llmFromSpec(flag('voice') ?? 'aitunnel:claude-sonnet-5.5')
let opens: ReturnType<typeof llmFromSpec> | undefined
if (!process.argv.includes('--no-opener') && process.env.YANDEX_API_KEY) opens = llmFromSpec('yandex:yandexgpt-5.1')

const caseOf = (id: string): Scenario => (id === 'gen' ? generated : findScenario(id)!)
const snap = (sc: Scenario) => ({
  title: sc.title, lang: sc.lang ?? 'ru', character: `${sc.opponent.character.name}, ${sc.opponent.character.role}`, player: sc.player.role,
  issues: sc.issues.map((i) => ({ id: i.id, title: i.title, kind: i.kind, options: i.options })), P: sc.player.profile.points, O: sc.opponent.profile.points,
  batna: { P: sc.player.profile.batna, O: sc.opponent.profile.batna },
})

const spent = async () => {
  const t = await budget().total() as unknown as { llmRub: number }
  return t.llmRub
}
const rub0 = await spent()
const result: { spec: string; cases: Record<string, ReturnType<typeof snap>>; games: unknown[]; rub?: number } = { spec: speaker.model, cases: {}, games: [] }
const save = () => writeFileSync(out, JSON.stringify(result, null, 1))

outer: for (const id of want) {
  const sc = caseOf(id)
  if (!sc) { console.error(`нет дела ${id}`); continue }
  result.cases[id] = snap(sc)
  for (const g of id.endsWith('-hard') ? games.filter((x) => hardGames.includes(x)) : games) {
    let state = initialState(sc)
    const history: TurnRecord[] = []
    const turns: unknown[] = []
    console.log(`\n### ${id} / ${g}`)
    for (const k of GAMES[g]) {
      if (state.status !== 'open') break
      if (!dry && (await spent()) - rub0 > limit) { console.log('бюджет прогона исчерпан'); break outer }
      const m = MOVES[k](sc, state)
      const before = state
      const a = withContext(withBareYes(m.text, m.a, history), state, history, dict)
      const r = step(sc, state, a, dict, history.map((h) => h.analysis))
      const t0 = Date.now()
      const opener = dry || !opens ? undefined : (await writeOpener(opens, sc, history, m.text, before, isRude(m.text), 800)) ?? spareOpener(sc, history)
      const v = dry ? { line: '(dry)', source: 'dry', emotion: 'neutral', problems: [] as string[], ms: { done: 0 } } : await voice(speaker, sc, history, m.text, r.decision, r.state, { marks: true, opener, fallback: opens })
      const line = stripTags(unstress(v.line))
      const d = r.decision
      console.log(`[${m.label}] ${m.text}\n  движок: ${d.kind}${'reason' in d && d.reason ? ':' + d.reason : ''}${'offer' in d && d.offer ? ' ' + JSON.stringify(d.offer) : ''}\n  заход: ${opener ?? '-'}\n  ${sc.opponent.character.name.split(' ')[0]}: ${line}  [${v.source}${v.problems?.length ? '; ' + v.problems.join(' | ') : ''}]`)
      turns.push({
        n: r.state.turn, strategy: m.label, text: m.text, analysis: a, decision: d,
        prev: before.lastOpponentOffer ?? {}, stanceBefore: before.playerStance ?? {}, stance: r.state.playerStance ?? {},
        position: d.kind === 'accept' ? r.state.deal ?? r.state.tableOffer : ('offer' in d && d.offer) || before.lastOpponentOffer || {},
        status: r.state.status, opener, line, source: v.source, model: 'model' in v ? v.model : undefined, error: 'error' in v ? v.error : undefined, problems: v.problems, ms: { ...(v.ms ?? {}), wall: Date.now() - t0 },
      })
      history.push({ turn: r.state.turn, playerText: m.text, analysis: a, deltas: r.deltas, decision: d, opponentLine: line, emotion: v.emotion, stateAfter: r.state })
      state = r.state
    }
    result.games.push({ case: id, game: g, turns })
    result.rub = (await spent()) - rub0
    save()
  }
}
result.rub = (await spent()) - rub0
save()
console.log(`\nходов: ${result.games.reduce((n: number, g) => n + (g as { turns: unknown[] }).turns.length, 0)}, расход (все модели): ${result.rub.toFixed(2)} ₽ → ${out}`)
