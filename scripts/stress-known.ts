// Разметка ударений всех заранее известных текстов (stress-known.ts) — для разбора и снимка в __fixtures__.
// npx tsx scripts/stress-known.ts [--write]  — без --write печатает, с --write пишет src/server/__fixtures__/stress-known.json
import { writeFileSync } from 'node:fs'
import { CUTSCENES, WELCOME } from '../src/game/cutscene/scripts'
import { accent, settle } from '../src/server/stress'
import { cutsceneTexts, knownTexts } from '../src/server/stress-known'

const rows = knownTexts(cutsceneTexts([...CUTSCENES, WELCOME])).map((k) => {
  const a = accent(k.text, 'all')
  return { ...k, marked: settle(a), ...(a.open.length ? { open: a.open.map((o) => o.word) } : {}) }
})
if (process.argv.includes('--write')) writeFileSync('src/server/__fixtures__/stress-known.json', JSON.stringify(rows, null, 1) + '\n')
else console.log(JSON.stringify(rows, null, 1))
console.error(`${rows.length} текстов, ${rows.reduce((n, r) => n + r.text.length, 0)} символов, нерешённых омографов: ${rows.filter((r) => r.open).length}`)
