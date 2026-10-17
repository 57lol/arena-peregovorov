// Живая партия на настоящих моделях: тот же путь, что /api/turn (разметка → движок → реплика), но с записью
// рамки, всех попыток модели, замечаний проверки, задержек и рублей. Платно, поэтому только с флагом --live.
//
//   npx tsx scripts/dialog-live.ts turn <дело> <партия.json> "<реплика игрока>" [--voice aitunnel:gpt-6.1-sol] --live
//   npx tsx scripts/dialog-live.ts replay <партия.json> <модель реплики> <выход.json> --live   — те же решения движка, другая модель
//   npx tsx scripts/dialog-live.ts show <партия.json>
//
// Ключи: YANDEX_* из .env (разметка на YandexGPT Pro, как на проде), AITUNNEL_API_KEY из .env или --aitunnel-key-file.
// Кэш и счёт рублей — в DIALOG_DIR (по умолчанию ./.cache/dialog-live), чтобы не смешивать с игрой.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
try {
  process.loadEnvFile(flag('env') ?? '.env')
} catch {
  // без .env — ключи из окружения
}
const keyFile = flag('aitunnel-key-file')
if (keyFile && !process.env.AITUNNEL_API_KEY) process.env.AITUNNEL_API_KEY = readFileSync(keyFile, 'utf8').trim()
const DIR = resolve(process.env.DIALOG_DIR ?? '.cache/dialog-live')
process.env.CACHE_DIR = join(DIR, 'cache')
process.env.LLM_PROVIDER = 'yandex'
process.env.YANDEX_ANALYZE_MODEL = flag('analyze') ?? 'yandexgpt-5.1' // как на проде с 16.10
process.env.NATURAL_SPEECH ??= 'voices+'
process.env.VOICE_LLM = 'main' // реплику выбираем сами ниже

const [cmd] = args
if (cmd !== 'show' && !process.argv.includes('--live')) {
  console.error('Ходы на живой модели платные: добавьте --live')
  process.exit(1)
}

const { analyzeMove } = await import('../src/server/analyze')
const { voice } = await import('../src/server/voice')
const { llmFromSpec, makeLLM } = await import('../src/server/llm')
const { dict, findScenario } = await import('../src/server/library')
const { initialState, step } = await import('../src/engine/turn')
const { withContext } = await import('../src/engine/offline')
const { unstress } = await import('../src/server/stress')
const { stripTags } = await import('../src/server/tags')
const { formatOffer } = await import('../src/engine/utility')
const { budget } = await import('../src/server/budget')
type TurnRecord = import('../src/engine/types').TurnRecord
type Scenario = import('../src/engine/types').Scenario
type Decision = import('../src/engine/types').Decision

interface Attempt { model: string; attempt: number; line: string; hard: string[]; soft: string[]; ms: number }
interface Turn {
  playerText: string
  record: TurnRecord
  spoken: string
  voice: { model?: string; source: string; problems?: string[]; error?: string; attempts: Attempt[] }
  ms: { analyze: number; voice: number }
  rub: { analyze: number; voice: number }
}
interface Session { scenario: string; voiceModel: string; turns: Turn[] }

const decisionText = (sc: Scenario, d: Decision) =>
  `${d.kind}${'reason' in d && d.reason ? ':' + d.reason : ''}${'to' in d ? ` [${d.to.join(',')}${d.back ? ', к делу' : ''}]` : ''}${'offer' in d && d.offer ? ' → ' + formatOffer(sc, d.offer) : ''}${'interestId' in d ? ` [${d.interestId}${d.general ? ', общий' : ''}${d.again ? ', снова' : ''}]` : ''}`

const rubNow = async () => (await budget().total()).llmRub
const path = (p: string) => resolve(p)

async function speak(sc: Scenario, spec: string, history: TurnRecord[], text: string, d: Decision, state: TurnRecord['stateAfter']) {
  const main = makeLLM('yandex').llm
  const speaker = spec === 'main' ? main : llmFromSpec(spec)
  const attempts: Attempt[] = []
  const r0 = await rubNow()
  const t0 = Date.now()
  const v = await voice(speaker, sc, history, text, d, state, { marks: true, fallback: main, trace: (a) => attempts.push(a) })
  return { v, attempts, ms: Date.now() - t0, rub: (await rubNow()) - r0 }
}

if (cmd === 'turn') {
  const [, scId, file, text] = args
  const sc = findScenario(scId)!
  const spec = flag('voice') ?? 'aitunnel:gpt-6.1-sol'
  mkdirSync(dirname(path(file)), { recursive: true })
  const ses: Session = existsSync(path(file)) ? JSON.parse(readFileSync(path(file), 'utf8')) : { scenario: scId, voiceModel: spec, turns: [] }
  const history = ses.turns.map((t) => t.record)
  const before = history.length ? history[history.length - 1].stateAfter : initialState(sc)
  const { llm } = makeLLM('yandex')
  const r0 = await rubNow()
  const t0 = Date.now()
  const a = await analyzeMove(llm.analyzer ?? llm, sc, dict, history, text, before.lastOpponentOffer)
  const msA = Date.now() - t0
  const rubA = (await rubNow()) - r0
  const analysis = withContext(a.analysis, before, history, dict)
  const r = step(sc, before, analysis, dict, history.map((h) => h.analysis))
  const s = await speak(sc, spec, history, text, r.decision, r.state)
  const line = stripTags(unstress(s.v.line))
  const record: TurnRecord = { turn: r.state.turn, playerText: text, analysis, deltas: r.deltas, decision: r.decision, opponentLine: line, emotion: s.v.emotion, stateAfter: r.state }
  ses.turns.push({ playerText: text, record, spoken: s.v.line, voice: { model: s.v.model, source: s.v.source, problems: s.v.problems, error: s.v.error, attempts: s.attempts }, ms: { analyze: msA, voice: s.ms }, rub: { analyze: rubA, voice: s.rub } })
  writeFileSync(path(file), JSON.stringify(ses, null, 1))
  console.log(`ход ${record.turn}: ${JSON.stringify({ b: analysis.behaviors.map((b) => b.id), offer: analysis.offer, ask: analysis.asksAbout, talk: analysis.talk, acc: analysis.accepts })}`)
  console.log(`  решение: ${decisionText(sc, r.decision)} | доверие ${r.state.trust} напряж. ${r.state.tension} | разметка ${a.source} ${msA} мс ${rubA.toFixed(2)} ₽`)
  for (const x of s.attempts) if (x.hard.length || x.soft.length) console.log(`  попытка ${x.attempt + 1} (${x.ms} мс): «${x.line}» — ${[...x.hard.map((h) => '!' + h), ...x.soft].join('; ')}`)
  console.log(`  ${sc.opponent.character.name} [${s.v.source}, ${s.v.model}, ${s.ms} мс, ${s.rub.toFixed(2)} ₽]: ${s.v.line}`)
}

if (cmd === 'replay') {
  const [, file, spec, out] = args
  const src: Session = JSON.parse(readFileSync(path(file), 'utf8'))
  const sc = findScenario(src.scenario)!
  const res: Session = { scenario: src.scenario, voiceModel: spec, turns: [] }
  const hist: TurnRecord[] = []
  for (const t of src.turns) {
    const before = hist.length ? hist[hist.length - 1].stateAfter : initialState(sc)
    if (before.status !== 'open') break
    const r = step(sc, before, t.record.analysis, dict, hist.map((h) => h.analysis))
    const s = await speak(sc, spec, hist, t.playerText, r.decision, r.state)
    const line = stripTags(unstress(s.v.line))
    const record = { ...t.record, decision: r.decision, deltas: r.deltas, stateAfter: r.state, opponentLine: line, emotion: s.v.emotion }
    hist.push(record)
    res.turns.push({ playerText: t.playerText, record, spoken: s.v.line, voice: { model: s.v.model, source: s.v.source, problems: s.v.problems, error: s.v.error, attempts: s.attempts }, ms: { analyze: 0, voice: s.ms }, rub: { analyze: 0, voice: s.rub } })
    console.log(`ход ${record.turn} [${decisionText(sc, r.decision)}] ${s.v.source} ${s.ms} мс ${s.rub.toFixed(2)} ₽`)
    for (const x of s.attempts) if (x.hard.length) console.log(`  попытка ${x.attempt + 1}: «${x.line}» — ${x.hard.join('; ')}`)
    console.log(`  ${sc.opponent.character.name}: ${s.v.line}`)
  }
  writeFileSync(path(out), JSON.stringify(res, null, 1))
}

if (cmd === 'show') {
  const ses: Session = JSON.parse(readFileSync(path(args[1]), 'utf8'))
  const sc = findScenario(ses.scenario)!
  console.log(`${sc.opponent.character.name}: ${sc.opening}`)
  let first = 0, n = 0
  for (const t of ses.turns) {
    const ok = !t.voice.attempts[0]?.hard.length
    n++
    if (ok) first++
    console.log(`\nИгрок: ${t.playerText}`)
    console.log(`  [${decisionText(sc, t.record.decision)} | доверие ${t.record.stateAfter.trust} | ${t.voice.source}${ok ? '' : ' | 1-я попытка: ' + t.voice.attempts[0]?.hard.join('; ')} | ${t.ms.voice} мс]`)
    console.log(`${sc.opponent.character.name}: ${t.spoken}`)
  }
  const ms = ses.turns.map((t) => t.ms.voice).sort((a, b) => a - b)
  const rub = ses.turns.reduce((x, t) => x + t.rub.voice + t.rub.analyze, 0)
  console.log(`\nрамку с первой попытки: ${first} из ${n}; реплика: медиана ${ms[Math.floor(ms.length / 2)]} мс; всего ${rub.toFixed(2)} ₽`)
}
