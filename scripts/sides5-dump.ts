const { allScenarios } = await import('../src/server/library')
const ids = process.argv.slice(2)
for (const sc of allScenarios) {
  if (ids.length && !ids.includes(sc.id)) continue
  console.log(`\n## ${sc.id} «${sc.title}» d=${sc.difficulty} harder=${sc.harder ?? 0} lang=${sc.lang ?? 'ru'} turns=${sc.turnLimit}`)
  console.log(`игрок: ${sc.player.role} | собеседник: ${sc.opponent.character.name}, ${sc.opponent.character.role} | batna P=${sc.player.profile.batna} O=${sc.opponent.profile.batna}`)
  for (const i of sc.issues) {
    console.log(`  ${i.id} «${i.title}» [${i.kind}]`)
    i.options.forEach((o, n) => console.log(`     ${n}. ${o.padEnd(40)} P=${sc.player.profile.points[i.id][n]}  O=${sc.opponent.profile.points[i.id][n]}`))
  }
}
