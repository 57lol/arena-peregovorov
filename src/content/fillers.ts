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
export const ELEVEN_FILLERS = ['sosed', 'gopnik', 'rinat', 'admin', 'olga', 'buyer', 'palych', 'emre', 'china'] as const

/**
 * Лица дел на английском: их фразы-паузы — по-английски, с теми же id, что на «вы» (c1–c3, v1–v3). Звучат только
 * голосом ElevenLabs; у запасного SpeechKit (john) записей нет — на нём собеседник думает молча, а не по-русски.
 */
export const EN_FILLERS = { c1: 'Hmm, one second.', c2: 'Okay, okay.', c3: 'Let me count.', v1: 'So... let me think.', v2: 'Look...', v3: 'One moment.' } as const
export const ENGLISH_FACES: readonly string[] = ['emre']

/** id фраз под обращение собеседника: на «ты» — бытовые главы, на «вы» — деловые. */
export const fillerIds = (informal: boolean): string[] => [...Object.keys(FILLERS.common), ...Object.keys(informal ? FILLERS.ty : FILLERS.vy)]

/** Тексты для будущей записи, ключи совпадают с общими паузами. */
export const CHINA_FILLERS = {
  c1: 'Секунду, друг.', c2: 'Считаем, считаем.', c3: 'Сейчас в телефон посмотрю.',
  v1: 'Так, дайте посчитать.', v2: 'Смотрите, какой вопрос…', v3: 'Минутку, склад проверю.',
  t1: 'Так, дай посчитать.', t2: 'Смотри, сейчас проверим.', t3: 'Погоди, цифры запишу.',
} as const
