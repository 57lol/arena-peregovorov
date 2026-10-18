// Живые реплики по заготовленным партиям: разметка — правила (или заданная), решение — движок, реплика — модель
// с прода (Claude Sonnet 5.5 через AITunnel). Для сравнения «до/после» правок рамки. Платно: только с --live.
//   npx tsx scripts/sides4-live.ts <дело|all> <выход.json> --live [--voice aitunnel:claude-sonnet-5.5]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const flag = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
if (!process.argv.includes('--live')) { console.error('платно: добавьте --live'); process.exit(1) }
process.env.AITUNNEL_API_KEY ??= readFileSync(resolve(process.env.HOME!, 'Arena-materials/.aitunnel_key'), 'utf8').trim()
const out = resolve(args[1] ?? 'sides4-live.json')
process.env.CACHE_DIR = join(out + '.cache')
mkdirSync(process.env.CACHE_DIR, { recursive: true })

const { voice } = await import('../src/server/voice')
const { llmFromSpec } = await import('../src/server/llm')
const { dict, findScenario } = await import('../src/server/library')
const { initialState, step } = await import('../src/engine/turn')
const { groundedOffline, withContext, withBareYes } = await import('../src/engine/offline')
const { formatOffer } = await import('../src/engine/utility')
const { budget } = await import('../src/server/budget')
const { unstress } = await import('../src/server/stress')
const { stripTags } = await import('../src/server/tags')
type MoveAnalysis = import('../src/engine/types').MoveAnalysis
type TurnRecord = import('../src/engine/types').TurnRecord

type Move = { text: string; a?: MoveAnalysis }
const GAMES: Record<string, Move[]> = {
  // партия капитана 18.10 (разметка — из кэша прода), реплики игрока восстановлены по цитатам разметки
  stop: [
    { text: 'Слышь, две тыщи на кроссы закидывать — у меня денег таких нету, ты чё. Пятихатку на химчистку дам.', a: { behaviors: [{ id: 'priority', quote: 'две тыщи на кроссы закидывать — у меня денег таких нету' }], toneViolation: true, talk: ['question'], offer: { money: 1 } } },
    { text: 'Ладно, ладно, не кипишуй, сори. Ты расскажи, чё за кроссы-то это?', a: { behaviors: [{ id: 'rapport', quote: 'Ладно, ладно, не кипишуй, сори' }, { id: 'ask_interest', quote: 'Ты расскажи, чё за кроссы-то это?' }], asksAbout: ['money'], talk: ['apology', 'question'] } },
    { text: 'Ну так чё, пятихатка на химчистку, нормально же?', a: { behaviors: [] } },
    { text: 'Ладно. На громкой дам позвонить. И извинюсь при пацанах, без проблем.', a: { behaviors: [], offer: { phone: 1, sorry: 3 } } },
    { text: 'Да ладно, давай я просто молча уйду и всё.', a: { behaviors: [], offer: { sorry: 0 } } },
    { text: 'Давай я тебе скажу «sorry».', a: { behaviors: [{ id: 'signpost', quote: 'Давай я тебе скажу «sorry»' }], talk: ['apology'] } },
  ],
  shop: [
    { text: 'Здравствуйте. Чайник потёк на второй день, чека нет, но платил картой. Поменяйте, пожалуйста, сегодня.' },
    { text: 'Я соглашусь на акт с фото и подписями, только если скидку дадите пятнадцать процентов.' },
    { text: 'Хорошо, давайте десять процентов и пластиковую карту.' },
    { text: 'Да, давайте так.' },
  ],
  dorm: [
    { text: 'Привет. Давай договоримся по комнате: я плачу 300 за вай-фай, и тихо с 23:00.' },
    { text: 'Ладно, давай 450 за вай-фай, но тишина с полуночи.' },
    { text: 'И график уборки на двери повесим, ок? Гости в субботу допоздна — без вопросов.' },
    { text: 'Договорились.' },
  ],
  china: [
    { text: 'Здравствуйте, господин Ли. Нам нужны датчики, давайте 36 юаней за штуку, партия 500 штук.' },
    { text: 'Хорошо, давайте 40 юаней, если партия тысяча штук и аккредитив после инспекции.' },
    { text: 'Эталон и спецификация повторных поставок — нам это важно. И доставка авто через Казахстан за 20 дней.' },
    { text: 'Ладно, согласен.' },
  ],
  lagos: [
    { text: 'Good morning, Mr Adeyemi. Our price for the batch is 440 thousand dollars, 100 percent upfront.' },
    { text: 'We can go to 420 thousand if you pay 70 percent upfront and ship in 16 weeks.' },
    { text: 'Non-exclusive distribution is important for us. But we can host your engineers for two weeks on site.' },
    { text: 'Okay, deal.' },
  ],
}
const spec = flag('voice') ?? 'aitunnel:claude-sonnet-5.5'
const speaker = llmFromSpec(spec)
const which = args[0] === 'all' || !args[0] ? Object.keys(GAMES) : args[0].split(',')
const result: Record<string, unknown[]> = {}
const rub0 = (await budget().total()).llmRub
for (const id of which) {
  const sc = findScenario(id)!
  let state = initialState(sc)
  const history: TurnRecord[] = []
  result[id] = []
  console.log(`\n### ${id}`)
  for (const m of GAMES[id]) {
    if (state.status !== 'open') break
    const raw = m.a ?? groundedOffline(sc, m.text, dict)
    const a = withContext(withBareYes(m.text, raw, history), state, history, dict)
    const r = step(sc, state, a, dict, history.map((h) => h.analysis))
    const t0 = Date.now()
    const v = await voice(speaker, sc, history, m.text, r.decision, r.state, { marks: true })
    const line = stripTags(unstress(v.line))
    const d = r.decision
    const dec = `${d.kind}${'reason' in d && d.reason ? ':' + d.reason : ''}${'offer' in d && d.offer ? ' → ' + formatOffer(sc, d.offer) : ''}`
    console.log(`игрок: ${m.text}\n  движок: ${dec}\n  ${sc.opponent.character.name.split(' ')[0]}: ${line}  [${line.split(/\s+/).length} сл., ${v.source}${v.problems?.length ? '; ' + v.problems.join(' | ') : ''}]`)
    ;(result[id] as unknown[]).push({ player: m.text, offer: a.offer, decision: dec, line, words: line.split(/\s+/).length, source: v.source, problems: v.problems, ms: Date.now() - t0 })
    history.push({ turn: r.state.turn, playerText: m.text, analysis: a, deltas: r.deltas, decision: r.decision, opponentLine: line, emotion: v.emotion, stateAfter: r.state })
    state = r.state
  }
}
const rub = (await budget().total()).llmRub - rub0
console.log(`\nрасход: ${rub.toFixed(2)} ₽`)
writeFileSync(out, JSON.stringify({ spec, rub, result }, null, 1))
