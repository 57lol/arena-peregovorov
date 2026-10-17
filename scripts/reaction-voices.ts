// Тела запросов ElevenLabs для предзаписанных реакций (src/content/reactions.ts): как фразы-паузы — eleven_v4,
// Серый — eleven_v4_turbo с его настройками (говорок держится только так).
//   npx tsx scripts/reaction-voices.ts > list.jsonl
import { REACTION_RECORDINGS } from '../src/content/reactions'
import { forEleven, spellOut } from '../src/server/direct'
import { accent, render, settle } from '../src/server/stress'
import { CAST, elevenBody } from '../src/server/tts'

const spoken = (text: string) => render(spellOut(settle(accent(forEleven(text)))), 'eleven').replace(/[«»"]/g, '')
for (const r of REACTION_RECORDINGS) {
  const voice = CAST[r.face]
  const model = r.face === 'gopnik' ? 'eleven_v4_turbo' : 'eleven_v4'
  const body = elevenBody({ text: spoken(r.text), voice, who: r.face }, { ...process.env, ELEVENLABS_MODEL: model })
  console.log(JSON.stringify({ file: `public${r.path}`, body: { ...body, voice_id: voice } }))
}
