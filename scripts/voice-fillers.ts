// Записать фразы-паузы (src/content/fillers.ts) каждым голосом livetts в public/assets/voice-fillers/<голос>/<id>.mp3,
// с ударениями по словарю (stress.ts). Уже записанные не трогает, кроме --force=v2,t3.
// Запуск: npx tsx scripts/voice-fillers.ts [--force=id,id] (нужен YANDEX_API_KEY в .env).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FILLERS, FILLER_VOICES } from '../src/content/fillers'
import { liveRole } from '../src/server/direct'
import { render, stress } from '../src/server/stress'
import { yandexV3 } from '../src/server/tts'

process.loadEnvFile('.env')
const key = process.env.YANDEX_API_KEY!
const phrases = Object.assign({}, ...Object.values(FILLERS)) as Record<string, string>
const force = new Set((process.argv.find((a) => a.startsWith('--force='))?.slice(8) ?? '').split(',').filter(Boolean))
const jobs = FILLER_VOICES.flatMap((voice) => Object.entries(phrases).map(([id, text]) => ({ voice, id, text })))
let made = 0
for (let i = 0; i < jobs.length; i += 6) {
  await Promise.all(
    jobs.slice(i, i + 6).map(async ({ voice, id, text }) => {
      const dir = join('public/assets/voice-fillers', voice)
      const file = join(dir, `${id}.mp3`)
      if (existsSync(file) && !force.has(id)) return
      mkdirSync(dir, { recursive: true })
      const r = await yandexV3(key, { text: render(stress(text), 'speechkit'), voice, liveRole: liveRole(voice, 'neutral') })
      writeFileSync(file, r.audio)
      made++
      console.log(`${voice}/${id} ${r.ms} мс «${text}»`)
    }),
  )
}
console.log(`записано ${made} из ${jobs.length}`)
