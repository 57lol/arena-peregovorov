// Проверки реплики (voice.ts) на готовых репликах прогона sides5-live: что из них вырезала бы проверка «радуется
// невыгодному» и «благодарит ни за что». Бесплатно.
//   npx tsx scripts/sides5-corpus.ts <прогон.json>...
import { readFileSync } from 'node:fs'
const { frameFor, checkPiece } = await import('../src/server/voice')
const { findScenario } = await import('../src/server/library')
const { initialState } = await import('../src/engine/turn')
type Scenario = import('../src/engine/types').Scenario
const generated = JSON.parse(readFileSync(new URL('../src/engine/__fixtures__/generatedScenario.json', import.meta.url), 'utf8')) as Scenario
let n = 0, flagged = 0
for (const f of process.argv.slice(2)) {
  const run = JSON.parse(readFileSync(f, 'utf8'))
  for (const g of run.games) {
    const sc = g.case === 'gen' ? generated : findScenario(g.case)!
    for (const t of g.turns) {
      n++
      const state = { ...initialState(sc), playerStance: t.stance, deal: t.position, tableOffer: t.position, revealed: [] }
      const frame = frameFor(sc, t.decision, state, t.prev, t.stanceBefore)
      const hard = checkPiece(sc, frame, t.line, { said: '', heard: t.text, mine: [] }).hard.filter((h: string) => /радуешься|благодаришь/.test(h))
      if (hard.length) { flagged++; console.log(`[${g.case}/${g.game} ${t.n} ${t.decision.kind}] ${t.line}\n   ${hard.join('; ')}`) }
    }
  }
}
console.log(`\n${flagged} из ${n}`)
