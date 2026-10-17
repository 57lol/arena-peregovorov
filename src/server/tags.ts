// Пометки для голоса ElevenLabs v3/v4 прямо в реплике: «[laughs] Ну ты даёшь». Их ставит модель реплики по ситуации.
// На экран реплика идёт без них, голоса OpenAI и SpeechKit их тоже не получают — читать «laughs» вслух им незачем.

/**
 * Что модель может поставить. Правила ElevenLabs v4 (~/Arena-materials/final/ELEVEN_TEXT_GUIDE.md) и жалобы капитана 17.10:
 * пометка держится до конца реплики, поэтому подача (SPEECH) и шёпот — только в самом начале, звуки (смех, вздох) —
 * только между фразами; одна пометка на реплику; шёпот — только в короткой реплике (длинная шёпотом — это бред).
 * Остальное в квадратных скобках вырезаем: незнакомое ElevenLabs иногда читает вслух.
 */
const SOUNDS = ['laughs', 'chuckles', 'sighs', 'exhales']
const SPEECH = ['sarcastic', 'curious', 'thoughtful', 'softly', 'nervously', 'annoyed', 'excited']
export const VOICE_TAGS = [...SOUNDS, ...SPEECH, 'whispers'] as const
/** шёпот — не длиннее стольких слов */
const WHISPER_WORDS = 12

// разметку SpeechKit («sil<[220]>», «<[small]>», «[[…]]») не трогаем — это не пометки модели
const ANY = /\s*(?<![<[])\[[^[\]<>\n]{1,40}\](?!\])\s*/gu

/** Реплика для экрана и для голосов без пометок. */
export function stripTags(text: string): string {
  return text.replace(ANY, ' ').replace(/\s{2,}/g, ' ').replace(/\s+([,.!?…])/g, '$1').trim()
}

/** Оставить одну знакомую пометку (по-английски, строчными) там, где она звучит естественно; остальное убрать. */
export function normalizeTags(text: string, max = 1): string {
  let n = 0
  const words = stripTags(text).split(/\s+/).filter(Boolean).length
  return text
    .replace(/(?<![<[])\[([^[\]<>\n]{1,40})\](?!\])/gu, (_m, raw: string, at: number, all: string) => {
      const tag = raw.trim().toLowerCase()
      const before = all.slice(0, at).replace(/\s*(?<![<[])\[[^[\]<>\n]{1,40}\](?!\])\s*/gu, '').trim()
      const start = before === ''
      const boundary = start || /[.!?…]$/.test(before)
      const fits = SOUNDS.includes(tag) ? boundary : SPEECH.includes(tag) ? start : tag === 'whispers' ? start && words <= WHISPER_WORDS : false
      if (!fits || ++n > max) return ' '
      return `[${tag}]`
    })
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?…])/g, '$1')
    .trim()
}

