// Аудит сторон по всем делам: npx tsx scripts/sides-audit.ts [дело] [--all]
// Печатает по каждому делу (и его жёсткой версии), где разметка, проверка разметки модели или движок путают,
// что выгодно игроку, а что собеседнику. Без --all — только серьёзные и средние. Код выхода 1, если есть серьёзные.

import { ALL_SCENARIOS, harder } from '../src/content/scenarios'
import { auditSides, type SideProblem } from '../src/content/scenarios/sides'

const args = process.argv.slice(2)
const all = args.includes('--all')
const only = args.find((a) => !a.startsWith('--'))
const RANK = { high: 0, medium: 1, low: 2 }
const MARK = { high: '!!', medium: ' !', low: '  ' }

let high = 0
for (const base of ALL_SCENARIOS.filter((s) => !only || s.id === only)) {
  for (const sc of [base, harder(base)]) {
    const found = auditSides(sc).sort((a, b) => RANK[a.severity] - RANK[b.severity])
    const shown = found.filter((p) => all || p.severity !== 'low')
    const n = (s: SideProblem['severity']) => found.filter((p) => p.severity === s).length
    high += n('high')
    console.log(`\n== ${sc.title} (${sc.id}): серьёзных ${n('high')}, средних ${n('medium')}, мелких ${n('low')}`)
    for (const p of shown) console.log(`${MARK[p.severity]} [${p.area}] ${p.text}`)
  }
}
process.exit(high ? 1 : 0)
