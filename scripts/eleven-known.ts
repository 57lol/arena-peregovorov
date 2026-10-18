// Заранее озвученные голосом ElevenLabs тексты: вступления собеседников (src/server/eleven-known.ts) и фразы-паузы
// (/assets/voice-fillers/eleven/<лицо>/<id>.mp3).
//   npx tsx scripts/eleven-known.ts list               — JSON: что озвучить и готовое тело запроса ElevenLabs (eleven_v4)
//   npx tsx scripts/eleven-known.ts write picks.json    — разложить выбранные дубли в public/assets и записать список
// Синтез дублей и выбор лучшего (whisper + судья) — ~/Arena-materials/final/voice-fix/scripts/known.py.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { FILLERS, ELEVEN_FILLERS, EN_FILLERS, ENGLISH_FACES, CHINA_FILLERS } from '../src/content/fillers'
import { looksEnglish } from '../src/engine/lang'
import { ELEVEN_KNOWN } from '../src/server/eleven-known.data'
import { ALL_SCENARIOS } from '../src/content/scenarios'
import { forEleven, forEnglish, spellOut } from '../src/server/direct'
import { accent, render, settle } from '../src/server/stress'
import { CAST, elevenBody } from '../src/server/tts'

const MODEL = 'eleven_v4'
/**
 * Подача в начале вступления — только где судья и слух подтвердили, что без неё звучит хуже (17.10, voice-fix/hello):
 * «О-о, сосед!» без пометки выходит сухим «О, сасед» (радость 2–3 из 5), с [excited] — живое «О-о, сосе-ед!» (5 из 5).
 */
const LEAD: Record<string, string> = { 'opening-dorm': '[excited] ' }
/** Текст для синтеза — так же, как его готовит сервер (speech.ts: external), только омографы без нейросети; английский — как есть. */
const spoken = (text: string) => (looksEnglish(text) ? forEnglish(text, 'eleven') : render(spellOut(settle(accent(forEleven(text)))), 'eleven')).replace(/[«»"]/g, '')

interface Item { who: string; voice: string; id: string; text: string; file: string; body: ReturnType<typeof elevenBody> }
function items(): Item[] {
  const out: Item[] = []
  const add = (who: string, id: string, text: string, file: string) => {
    const voice = CAST[who]
    if (!voice) return
    out.push({ who, voice, id, text, file, body: elevenBody({ text: (LEAD[id] ?? '') + spoken(text), voice, who }, { ...process.env, ELEVENLABS_MODEL: MODEL }) })
  }
  for (const sc of ALL_SCENARIOS) add(sc.opponent.character.portrait, `opening-${sc.id}`, sc.opening, `assets/voice-eleven/${sc.opponent.character.portrait}/opening-${sc.id}.mp3`)
  const phrases = { ...FILLERS.common, ...FILLERS.vy, ...FILLERS.ty }
  for (const who of ELEVEN_FILLERS)
    for (const [id, text] of Object.entries(who === 'china' ? CHINA_FILLERS : ENGLISH_FACES.includes(who) ? EN_FILLERS : phrases)) add(who, `filler-${id}`, text, `assets/voice-fillers/eleven/${who}/${id}.mp3`)
  return out
}

/** строка TS в одинарных кавычках: в английских текстах есть апострофы («let's») */
const q = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'list') console.log(JSON.stringify(items(), null, 1))
else if (cmd === 'write') {
  // picks: [{ id, who, src }] — путь к выбранному дублю
  const picks = JSON.parse(readFileSync(arg, 'utf8')) as { id: string; who: string; src: string }[]
  const all = items()
  // вступления, которые уже записаны и не устарели (тот же голос и текст), остаются; выбранные дубли их дополняют или заменяют
  const known = new Map(ELEVEN_KNOWN.filter((k) => all.some((i) => i.file === k.file && i.voice === k.voice && i.text === k.text)).map((k) => [k.file, k]))
  for (const k of ELEVEN_KNOWN) if (!known.has(k.file)) console.error(`устарело, убрано из списка: ${k.file}`)
  for (const p of picks) {
    const it = all.find((i) => i.id === p.id && i.who === p.who)
    if (!it) throw new Error(`нет такого текста: ${p.who}/${p.id}`)
    mkdirSync(dirname(`public/${it.file}`), { recursive: true })
    copyFileSync(p.src, `public/${it.file}`)
    if (it.id.startsWith('opening-')) known.set(it.file, { who: it.who, voice: it.voice, text: it.text, file: it.file })
  }
  writeFileSync(
    'src/server/eleven-known.data.ts',
    `// Сгенерировано scripts/eleven-known.ts — руками не править.
export interface KnownLine {
  who: string
  voice: string
  text: string
  file: string
}
export const ELEVEN_KNOWN: KnownLine[] = [
${[...known.values()].map((k) => `  {\n    who: ${q(k.who)},\n    voice: ${q(k.voice)},\n    text: ${q(k.text)},\n    file: ${q(k.file)}\n  }`).join(',\n')}
]
`,
  )
  console.error(`${picks.length} файлов, вступлений в списке: ${known.size}`)
} else console.error('list | write picks.json')
