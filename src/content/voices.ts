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
]

