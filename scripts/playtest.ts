// Живой прогон переговоров через API тремя стилями игрока.
// Запуск: npx tsx scripts/playtest.ts [--api http://localhost:8787] [--scenario tara] [--out dir] [--styles rude,splitter,explorer,patient]
// Сервер должен быть поднят (npm run server).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Scenario, TurnRecord } from '../src/engine/types'
import type { Report } from '../src/engine/report'
import { formatOffer } from '../src/engine/utility'
import { explorer, patient, rude, splitter, type Player } from './players'

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

const PLAYERS: Record<string, Player> = { rude, splitter, explorer, patient }

async function run(style: string, sc: Scenario) {
  const history: TurnRecord[] = []
  const log: string[] = [`# ${style} · «${sc.title}» · ${new Date().toLocaleString('ru-RU')}`, '', `**${sc.opponent.character.name}:** ${sc.opening}`, '']
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
      `  решение: ${d.kind}${'reason' in d && d.reason ? ':' + d.reason : ''}${'offer' in d && d.offer ? ' → ' + formatOffer(sc, d.offer) : ''}${'interestId' in d ? ' [' + d.interestId + ']' : ''}`,
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
const stamp = new Date().toLocaleString('sv-SE').slice(0, 16).replace(/[: ]/g, '-')
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
