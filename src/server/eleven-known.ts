// Заранее озвученные голосом ElevenLabs тексты: вступления собеседников. Их знают до игры, поэтому они записаны
// заранее на полной модели eleven_v4 (лучше качество, чем у v4 Turbo для живых реплик), из 2–3 дублей выбран лучший
// (whisper + судья + на слух), и звучат сразу, без задержки. Пересборка: scripts/eleven-known.ts.
// Ключ — голос и текст реплики, как его шлёт игра: сменили голос лица или текст — файл не подойдёт, будет живой синтез.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ELEVEN_KNOWN } from './eleven-known.data'

const byKey = new Map(ELEVEN_KNOWN.map((k) => [`${k.voice}|${k.text}`, k.file]))

/** Готовый mp3 для этой реплики этим голосом: в проде из dist/, в разработке из public/. */
export async function knownAudio(voice: string, text: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const file = byKey.get(`${voice}|${text.trim()}`)
  if (!file) return undefined
  for (const root of ['dist', 'public'])
    try {
      return new Uint8Array(await readFile(join(root, file)))
    } catch {
      // нет в этой папке
    }
  return undefined
}
