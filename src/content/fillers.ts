// Фразы-паузы: пока нейросеть думает над ответом, собеседник говорит заранее записанное «Хм, секунду».
// Записаны каждым голосом livetts (scripts/voice-fillers.ts) и лежат статикой: /assets/voice-fillers/<голос>/<id>.mp3.

export const FILLERS = {
  // годятся и на «вы», и на «ты»
  common: { c1: 'Хм, секунду.', c2: 'Так-так.', c3: 'Сейчас прикину.' },
  vy: { v1: 'Так... дайте подумать.', v2: 'Ну смотрите...', v3: 'Минутку.' },
  ty: { t1: 'Так... дай подумать.', t2: 'Ну смотри...', t3: 'Погоди, соображу.' },
} as const

export const FILLER_VOICES = ['denis', 'sergey', 'vasily', 'sofia', 'vera', 'irina'] as const

/**
 * Те же фразы голосами ElevenLabs — у лиц из кампании и дел (scripts/eleven-known.ts, eleven_v4):
 * /assets/voice-fillers/eleven/<лицо>/<id>.mp3. Играют, когда сервер говорит ElevenLabs.
 */
export const ELEVEN_FILLERS = ['sosed', 'gopnik', 'rinat', 'admin', 'olga', 'buyer', 'palych'] as const

/** id фраз под обращение собеседника: на «ты» — бытовые главы, на «вы» — деловые. */
export const fillerIds = (informal: boolean): string[] => [...Object.keys(FILLERS.common), ...Object.keys(informal ? FILLERS.ty : FILLERS.vy)]
