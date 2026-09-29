// Записать фразы-паузы (src/content/fillers.ts) каждым голосом livetts в public/assets/voice-fillers/<голос>/<id>.mp3.
// Уже записанные не трогает. Запуск: npx tsx scripts/voice-fillers.ts (нужен YANDEX_API_KEY в .env).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FILLERS, FILLER_VOICES } from '../src/content/fillers'
import { liveRole } from '../src/server/direct'
import { yandexV3 } from '../src/server/tts'

process.loadEnvFile('.env')
const key = process.env.YANDEX_API_KEY!
const phrases = Object.assign({}, ...Object.values(FILLERS)) as Record<string, string>
const jobs = FILLER_VOICES.flatMap((voice) => Object.entries(phrases).map(([id, text]) => ({ voice, id, text })))
let made = 0
for (let i = 0; i < jobs.length; i += 6) {
  await Promise.all(
    jobs.slice(i, i + 6).map(async ({ voice, id, text }) => {
      const dir = join('public/assets/voice-fillers', voice)
      const file = join(dir, `${id}.mp3`)
      if (existsSync(file)) return
      mkdirSync(dir, { recursive: true })
      const r = await yandexV3(key, { text, voice, liveRole: liveRole(voice, 'neutral') })
      writeFileSync(file, r.audio)
      made++
      console.log(`${voice}/${id} ${r.ms} мс «${text}»`)
    }),
  )
}
console.log(`записано ${made} из ${jobs.length}`)
