// Живой прогон переговоров через API тремя стилями игрока.
// Запуск: npx tsx scripts/playtest.ts [--api http://localhost:8787] [--scenario tara] [--out dir] [--styles rude,splitter,explorer]
// Сервер должен быть поднят (npm run server).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Offer, Scenario, TurnRecord } from '../src/engine/types'
import type { Report } from '../src/engine/report'
import { bestOption, formatOffer, isComplete, score, type FullOffer } from '../src/engine/utility'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : def
}
const API = arg('api', 'http://localhost:8787')
const SCENARIO = arg('scenario', 'tara')
const OUT = arg('out', join(homedir(), 'Arena-materials', 'playtests'))
const STYLES = arg('styles', 'rude,splitter,explorer').split(',')
const TAG = arg('tag', '')

interface TurnResponse {
  record: TurnRecord
  report?: Report
  sources: { analysis: string; voice: string; errors?: string[] }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(j)}`)
  return j as T
}

type Player = (sc: Scenario, h: TurnRecord[]) => string

const say = (sc: Scenario, o: Offer) => formatOffer(sc, o)
const myBest = (sc: Scenario): FullOffer => Object.fromEntries(sc.issues.map((i) => [i.id, bestOption(sc.player.profile, i.id)]))
const theirLast = (h: TurnRecord[]) => h[h.length - 1]?.stateAfter.lastOpponentOffer

// 1. Грубиян: требует всё и хамит.
const rude: Player = (sc, h) => {
  const lines = [
    `Значит так. ${say(sc, myBest(sc))}. Не нравится — идите лесом.`,
    'Вы что, издеваетесь? Это бред, а не предложение. Я жду нормальных цифр.',
    `Слушайте, вы идиот или притворяетесь? ${say(sc, myBest(sc))}, я сказал.`,
    'Хватит ерунду нести. Последний раз повторяю.',
    'Ну и тупой же разговор.',
  ]
  return lines[Math.min(h.length, lines.length - 1)]
}

// 2. Торгаш «давайте посередине»: не спрашивает, делит разницу пополам, соглашается, когда устал.
const splitter: Player = (sc, h) => {
  const theirs = theirLast(h)
  if (!h.length || !isComplete(sc, theirs)) return `Начнём с нашей позиции: ${say(sc, myBest(sc))}.`
  const mine = h[h.length - 1].stateAfter.playerStance ?? myBest(sc)
  const mid: Offer = {}
  for (const i of sc.issues) {
    const a = mine[i.id] ?? bestOption(sc.player.profile, i.id)
    const b = theirs[i.id]!
    mid[i.id] = Math.round((a + b) / 2)
  }
  const mp = score(sc.player.profile, theirs)
  if (h.length >= 6 && mp >= sc.player.profile.batna) return 'Ладно, устал торговаться. Согласен на ваше предложение.'
  return `Давайте по-честному, посередине: ${say(sc, mid)}.`
}

// 3. Исследователь: сначала спрашивает об интересах и пересказывает услышанное, потом собирает размен
//    из того, что узнал, и своих приоритетов. Делимый пункт двигает по шагу за ход.
const explorer: Player = (sc, h) => {
  const P = sc.player.profile
  const O = sc.opponent.profile
  const asks = sc.issues
    .filter((i) => i.kind !== 'distributive')
    .map((i) => `А почему для вас так важен пункт «${i.title.toLowerCase()}»? Что за этим стоит?`)
  const n = h.length
  if (n === 0) return 'Добрый день! Прежде чем торговаться, хочу понять вашу ситуацию. Что для вас в этой сделке главное и почему?'
  const last = h[n - 1]
  const heard =
    last.decision.kind === 'reveal'
      ? `Правильно понимаю: ${O.interests.find((i) => i.id === (last.decision as { interestId: string }).interestId)?.text.split(/[.,:]/)[0]}? Это важно, спасибо. `
      : 'Понимаю. '
  if (n <= asks.length) return heard + asks[n - 1]

  const revealed = new Set(last.stateAfter.revealed)
  const known = new Set(O.interests.filter((i) => revealed.has(i.id) && i.issue).map((i) => i.issue!))
  const w = (p: typeof P, id: string) => Math.max(...p.points[id]) - Math.min(...p.points[id])
  const weights = sc.issues.map((i) => w(P, i.id))
  const median = [...weights].sort((a, b) => a - b)[Math.floor(weights.length / 2)]
  const pkg: Offer = {}
  for (const i of sc.issues) {
    const mine = bestOption(P, i.id)
    const mid = Math.floor((i.options.length - 1) / 2)
    if (known.has(i.id)) {
      // человек понял из объяснения, насколько пункт важен собеседнику
      const theirs = bestOption(O, i.id)
      pkg[i.id] = theirs === mine || w(P, i.id) >= w(O, i.id) ? mine : theirs
    } else pkg[i.id] = w(P, i.id) >= median ? mine : mid
  }
  const tries = n - asks.length - 1
  const price = sc.issues.find((i) => i.kind === 'distributive')
  if (price && tries > 0) {
    const their = bestOption(O, price.id)
    const shift = Math.sign(their - pkg[price.id]!) * Math.min(tries, Math.abs(their - pkg[price.id]!))
    pkg[price.id] = pkg[price.id]! + shift
  }
  const theirs = last.stateAfter.lastOpponentOffer
  if (tries > 0 && isComplete(sc, theirs) && score(P, theirs) >= score(P, pkg as FullOffer) - 5)
    return 'Отлично, так нам обоим хорошо. Договорились.'
  return tries === 0
    ? `Смотрите, что предлагаю с учётом того, что вы рассказали: ${say(sc, pkg)}. Вы получаете то, что важно вам, мы — то, что важно нам.`
    : `Хорошо, иду навстречу по деньгам: ${say(sc, pkg)}.`
}

const PLAYERS: Record<string, Player> = { rude, splitter, explorer }

async function run(style: string, sc: Scenario) {
  const history: TurnRecord[] = []
  const log: string[] = [`# ${style} · «${sc.title}» · ${new Date().toISOString()}`, '', `**${sc.opponent.character.name}:** ${sc.opening}`, '']
  let report: Report | undefined
  const sources: string[] = []
  for (let n = 0; n < sc.turnLimit + 2; n++) {
    const text = PLAYERS[style](sc, history)
    const t0 = Date.now()
    const r = await post<TurnResponse>('/api/turn', { scenarioId: sc.id, history, playerText: text })
    const rec = r.record
    history.push(rec)
    sources.push(`${r.sources.analysis}/${r.sources.voice}`)
    const d = rec.decision
    const deltas = rec.deltas.map((x) => `${x.field === 'trust' ? 'доверие' : 'напряжение'} ${x.by > 0 ? '+' : ''}${x.by} (${x.because})`).join('; ')
    log.push(
      `**Игрок (${rec.turn}):** ${text}`,
      `  разбор: ${JSON.stringify({ b: rec.analysis.behaviors.map((b) => b.id), offer: rec.analysis.offer, acc: rec.analysis.accepts, ask: rec.analysis.asksAbout, tone: rec.analysis.toneViolation })}`,
      `  сдвиги: ${deltas || '—'}`,
      `  решение: ${d.kind}${'reason' in d && d.reason ? ':' + d.reason : ''}${'offer' in d && d.offer ? ' → ' + say(sc, d.offer) : ''}${'interestId' in d ? ' [' + d.interestId + ']' : ''}`,
      `  состояние: доверие ${rec.stateAfter.trust}, напряжение ${rec.stateAfter.tension}, статус ${rec.stateAfter.status}; источники ${r.sources.analysis}/${r.sources.voice}${r.sources.errors ? ' ошибки: ' + r.sources.errors.join(' | ') : ''}; ${Date.now() - t0} мс`,
      `**${sc.opponent.character.name} (${rec.emotion}):** ${rec.opponentLine}`,
      '',
    )
    if (r.report) {
      report = r.report
      break
    }
  }
  report ??= await post<Report>('/api/report', { scenarioId: sc.id, history })
  const o = report.outcome
  log.push(
    '## Итог',
    `статус ${o.status}; игрок ${o.playerPoints}/${o.maxPlayerPoints}; оппонент ${o.opponentPoints}; эффективность ${o.paretoEfficiency}; на столе ${report.leftOnTable}; доверие ${o.relationship}`,
    `ключевые моменты: ${report.keyMoments.map((m) => `ход ${m.turn} — ${m.why}`).join('; ')}`,
    '',
    ...report.explanation.map((x) => `- ${x}`),
    '',
  )
  return { style, history, report, log: log.join('\n') }
}

const sc = await (await fetch(`${API}/api/scenarios/${SCENARIO}`)).json() as Scenario
const health = (await (await fetch(`${API}/api/health`)).json()) as { provider: string; model: string }
mkdirSync(OUT, { recursive: true })
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
const results = []
for (const style of STYLES) {
  const r = await run(style, sc)
  results.push(r)
  console.log(r.log)
}
const name = `${stamp}_${SCENARIO}_${health.provider}${TAG ? '_' + TAG : ''}`
writeFileSync(join(OUT, `${name}.md`), `Провайдер: ${health.provider} (${health.model})\n\n` + results.map((r) => r.log).join('\n\n---\n\n'))
writeFileSync(join(OUT, `${name}.json`), JSON.stringify(results.map(({ style, history, report }) => ({ style, history, report })), null, 1))
console.log(`\nЛог: ${join(OUT, name)}.md`)
