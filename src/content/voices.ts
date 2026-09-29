// Каталог голосов SpeechKit: его читают и сервер (роли под эмоцию, проверка голоса), и игра (кто кем говорит).

export interface VoiceInfo {
  id: string
  name: string
  female: boolean
  /** роли (амплуа) SpeechKit, которые голос умеет */
  roles?: string[]
  /** только API v3 */
  v3only?: boolean
  note?: string
  /** модель SpeechKit v3: без поля — general; livetts не знает темпа, амплуа у него свои (casual, formal…) */
  model?: 'livetts'
}

/**
 * Русские голоса SpeechKit (https://aistudio.yandex.ru/docs/ru/speechkit/tts/voices, каждый проверен запросом).
 * Тон в Гц мерили на одной фразе — ~/Arena-materials/VOICES.md.
 */
export const YANDEX_VOICES: VoiceInfo[] = [
  { id: 'filipp', name: 'Филипп', female: false, roles: [], note: '121 Гц, средний, живой' },
  { id: 'ermil', name: 'Ермил', female: false, roles: ['good'], note: '87 Гц, самый низкий, спокойный' },
  { id: 'zahar', name: 'Захар', female: false, roles: ['good'], note: '142 Гц, молодой' },
  { id: 'madirus', name: 'Мадирус', female: false, roles: [], note: '92 Гц, низкий, с хрипотцой' },
  { id: 'anton', name: 'Антон', female: false, roles: ['good'], v3only: true, note: '98 Гц, низкий, ровный' },
  { id: 'kirill', name: 'Кирилл', female: false, roles: ['strict', 'good'], v3only: true, note: '105 Гц, умеет «строго»' },
  { id: 'alexander', name: 'Александр', female: false, roles: ['good'], v3only: true, note: '108 Гц, тёплый, разговорный' },
  { id: 'alena', name: 'Алёна', female: true, roles: ['good'], note: '180 Гц, живой, тёплый' },
  { id: 'jane', name: 'Джейн', female: true, roles: ['good', 'evil'], note: '200 Гц, выразительный' },
  { id: 'omazh', name: 'Омаж', female: true, roles: ['evil'], note: '235 Гц, резкий' },
  { id: 'marina', name: 'Марина', female: true, roles: ['friendly', 'whisper'], note: '232 Гц, мягкий' },
  { id: 'dasha', name: 'Даша', female: true, roles: ['good', 'friendly'], v3only: true, note: '180 Гц, молодой, разговорный' },
  { id: 'lera', name: 'Лера', female: true, roles: ['friendly'], v3only: true, note: '195 Гц, лёгкий' },
  { id: 'masha', name: 'Маша', female: true, roles: ['good', 'strict', 'friendly'], v3only: true, note: '211 Гц, по умолчанию «добрая»' },
  { id: 'julia', name: 'Юлия', female: true, roles: ['strict'], v3only: true, note: '219 Гц, деловой, умеет «строго»' },
  { id: 'saule_ru', name: 'Сауле', female: true, roles: ['strict', 'whisper'], v3only: true, note: 'русский с казахским акцентом' },
  { id: 'zhanar_ru', name: 'Жанар', female: true, roles: ['strict', 'friendly'], v3only: true, note: 'русский с казахским акцентом' },
  { id: 'zamira_ru', name: 'Замира', female: true, roles: ['strict', 'friendly'], v3only: true, note: 'русский с узбекским акцентом' },
  { id: 'yulduz_ru', name: 'Юлдуз', female: true, roles: ['strict', 'friendly', 'whisper'], v3only: true, note: 'русский с узбекским акцентом' },
  // модель livetts (v3): самая «живая» и на треть дороже general; темп не принимает (400), амплуа — свои (проверено 29.09)
  { id: 'denis', name: 'Денис', female: false, v3only: true, model: 'livetts', roles: ['casual', 'formal', 'neutral', 'sales'], note: 'livetts' },
  { id: 'sergey', name: 'Сергей', female: false, v3only: true, model: 'livetts', roles: ['support', 'sales'], note: 'livetts' },
  { id: 'vasily', name: 'Василий', female: false, v3only: true, model: 'livetts', roles: ['support', 'sales'], note: 'livetts' },
  { id: 'sofia', name: 'София', female: true, v3only: true, model: 'livetts', roles: ['casual', 'support'], note: 'livetts' },
  { id: 'vera', name: 'Вера', female: true, v3only: true, model: 'livetts', roles: ['casual', 'support'], note: 'livetts' },
  { id: 'irina', name: 'Ирина', female: true, v3only: true, model: 'livetts', roles: ['formal', 'support', 'narrator', 'sales', 'neutral'], note: 'livetts' },
]

