// Пометки для голоса ElevenLabs v3/v4 прямо в реплике: «[laughs] Ну ты даёшь». Их ставит модель реплики по ситуации.
// На экран реплика идёт без них, голоса OpenAI и SpeechKit их тоже не получают — читать «laughs» вслух им незачем.

/** Что модель может поставить. Остальное в квадратных скобках вырезаем: незнакомое ElevenLabs иногда читает вслух. */
export const VOICE_TAGS = [
  'laughs', 'chuckles', 'sighs', 'exhales', 'whispers', 'sarcastic', 'annoyed', 'curious', 'excited',
  'thoughtful', 'softly', 'mischievously', 'nervously', 'angry', 'warmly', 'cheerfully', 'pause',
] as const

// разметку SpeechKit («sil<[220]>», «<[small]>», «[[…]]») не трогаем — это не пометки модели
const ANY = /\s*(?<![<[])\[[^[\]<>\n]{1,40}\](?!\])\s*/gu

/** Реплика для экрана и для голосов без пометок. */
export function stripTags(text: string): string {
  return text.replace(ANY, ' ').replace(/\s{2,}/g, ' ').replace(/\s+([,.!?…])/g, '$1').trim()
}

/** Оставить не больше двух знакомых пометок (по-английски, строчными), остальное убрать. */
export function normalizeTags(text: string, max = 2): string {
  let n = 0
  return text
    .replace(/(?<![<[])\[([^[\]<>\n]{1,40})\](?!\])/gu, (_, raw: string) => {
      const tag = raw.trim().toLowerCase()
      if (!(VOICE_TAGS as readonly string[]).includes(tag) || ++n > max) return ' '
      return `[${tag}]`
    })
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?…])/g, '$1')
    .trim()
}

export const hasTags = (text: string) => /\[[a-z][a-z ]{1,30}\]/u.test(text)
