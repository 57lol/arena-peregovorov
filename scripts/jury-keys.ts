import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parseJuryKeys } from '../src/server/pass'

export function generateJuryKeys(n: number, names?: string[]) {
  if (!Number.isInteger(n) || n < 1 || n > 1000 || (names && names.length !== n))
    throw new Error('Нужно N от 1 до 1000; число имён должно совпадать с N')
  const judges = Array.from({ length: n }, (_, i) => ({ name: names?.[i] ?? `Судья${i + 1}`, key: randomBytes(24).toString('base64url') }))
  const raw = judges.map((j) => `${j.name}:${j.key}`).join(',')
  parseJuryKeys(raw)
  return `JURY_KEYS=${JSON.stringify(raw)}\n\n${judges.map((j) => `# ${j.name}: https://arena-peregovorov.ru/?key=${encodeURIComponent(j.key)}`).join('\n')}\n`
}

async function main(args: string[]) {
  const n = Number(args.shift())
  let out: string | undefined, names: string[] | undefined
  while (args.length) {
    const flag = args.shift(), value = args.shift()
    if (!value) throw new Error('После флага нужно значение')
    if (flag === '--out') out = value
    else if (flag === '--names') names = value.split(',').map((s) => s.trim())
    else throw new Error(`Неизвестный флаг ${flag}`)
  }
  const text = generateJuryKeys(n, names)
  // Только явный флаг; существующий файл не перезаписываем.
  if (out) await writeFile(out, text, { mode: 0o600, flag: 'wx' })
  console.log(text)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e: Error) => { console.error(e.message); process.exitCode = 1 })
}
