// Темп печати реплики в окне диалога.

/** Паузы после знаков препинания, мс: текст «дышит», как речь. */
export const PAUSE: Record<string, number> = { '.': 260, '!': 260, '?': 260, '…': 380, ',': 110, ';': 140, ':': 140, '—': 160 }

/** Скорость печати, чтобы реплика допечаталась вместе с озвучкой длиной sec секунд (с паузами на знаках). */
export function cpsFor(text: string, sec: number): number {
  let pauses = 0
  for (const ch of text.slice(0, -1)) pauses += PAUSE[ch] ?? 0
  const typing = Math.max(sec * 950 - pauses, sec * 400)
  return Math.max(8, Math.min(60, (text.length * 1000) / typing))
}
