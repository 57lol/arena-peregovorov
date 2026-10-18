// После vite build: считаем весь синхронный граф титула, а не только entry-чанк.
import { readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'))
const files = new Set()
const css = new Set()
const visit = (key) => {
  const chunk = manifest[key]
  if (!chunk || files.has(chunk.file)) return
  files.add(chunk.file)
  for (const file of chunk.css ?? []) css.add(file)
  for (const dep of chunk.imports ?? []) visit(dep)
}
for (const [key, chunk] of Object.entries(manifest)) if (chunk.isEntry) visit(key)
const size = (list) => [...list].reduce((total, file) => {
  const bytes = readFileSync(`dist/${file}`)
  return { raw: total.raw + bytes.length, gzip: total.gzip + gzipSync(bytes, { level: 9 }).length }
}, { raw: 0, gzip: 0 })
const kb = (n) => `${(n / 1000).toFixed(1)} kB`
for (const [label, list] of [['Титул: JS', files], ['Титул: CSS', css]]) {
  const bytes = size(list)
  console.log(`${label}: ${kb(bytes.raw)} / ${kb(bytes.gzip)} gzip (${list.size} файлов)`)
}
console.log('Отложенные чанки:')
for (const chunk of Object.values(manifest).filter((c) => c.file.endsWith('.js') && /(?:world3d|Play3D|Debrief|Coach|Board|Cutscene|Lab|perfOverlay)-/.test(c.file))) {
  console.log(`  ${chunk.file}: ${kb(statSync(`dist/${chunk.file}`).size)}`)
}
