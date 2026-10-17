// Тексты для проверки синтезом: как их получит каждый движок при разных наборах ударений (risky / all / без разметки).
// npx tsx scripts/stress-variants.ts <in.json> — на входе [{id, who, text}], на выходе тот же список с полями variants.
import { readFileSync } from 'node:fs'
import { spellOut } from '../src/server/direct'
import { accent, render, settle } from '../src/server/stress'

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { id: string; who: string; text: string }[]
const out = rows.map((r) => {
  const clean = r.text.replace(/[«»"]/g, '')
  const marked = (set: 'risky' | 'all') => spellOut(settle(accent(r.text, set))).replace(/[«»"]/g, '')
  return {
    ...r,
    variants: {
      none: { speechkit: spellOut(clean), eleven: spellOut(clean) },
      risky: { speechkit: render(marked('risky'), 'speechkit'), eleven: render(marked('risky'), 'eleven') },
      all: { speechkit: render(marked('all'), 'speechkit'), eleven: render(marked('all'), 'eleven') },
    },
  }
})
console.log(JSON.stringify(out, null, 1))
