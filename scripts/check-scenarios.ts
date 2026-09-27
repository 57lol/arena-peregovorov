// Проверка библиотеки сценариев: npx tsx scripts/check-scenarios.ts
// Печатает зону соглашения, границу Парето и сравнение «всё посередине» против лучшего размена.
// Код выхода 1, если хоть в одном сценарии есть проблемы.

import { SCENARIOS, checkScenario } from '../src/content/scenarios'
import type { Scenario } from '../src/engine/types'
import type { FullOffer } from '../src/engine/utility'

const describe = (sc: Scenario, o: FullOffer) => sc.issues.map((i) => `${i.title.toLowerCase()}: ${i.options[o[i.id]]}`).join('; ')

let failed = false
for (const sc of SCENARIOS) {
  const c = checkScenario(sc)
  const P = sc.player.profile
  const O = sc.opponent.profile
  console.log(`\n== ${sc.title} (${sc.id}) ==`)
  console.log(`сделок всего ${c.deals}, в зоне соглашения ${c.zopa} (${(c.zopaShare * 100).toFixed(0)}%), точек на границе Парето ${c.frontier}`)
  console.log(`BATNA: игрок ${P.batna}, оппонент ${O.batna}; если сразу принять якорь оппонента, игрок получит ${c.openingForPlayer}`)
  console.log(`всё посередине: игрок ${c.middle.player}, оппонент ${c.middle.opponent}, сумма ${c.middle.player + c.middle.opponent}${c.middleOnFrontier ? ' (на границе Парето!)' : ' (не на границе)'}`)
  console.log(`   ${describe(sc, c.middle.offer)}`)
  console.log(`лучший размен: игрок ${c.best.player}, оппонент ${c.best.opponent}, сумма ${c.maxJoint}  → ×${c.logrollGain.toFixed(2)} к середине`)
  console.log(`   ${describe(sc, c.best.offer)}`)
  console.log('пункты (вес для игрока / для оппонента):')
  for (const i of c.issues) console.log(`   ${i.id.padEnd(9)} ${i.kind.padEnd(13)} ${String(i.playerWeight).padStart(3)} / ${String(i.opponentWeight).padEnd(3)}`)
  if (c.problems.length) {
    failed = true
    console.log('ПРОБЛЕМЫ:')
    for (const p of c.problems) console.log(`   - ${p}`)
  } else console.log('проблем нет')
}
process.exit(failed ? 1 : 0)
