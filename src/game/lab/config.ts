// Лаборатория (/?lab): игра с другими моделями и голосами. Выбор живёт в sessionStorage этой вкладки —
// закрыл вкладку, и игра снова на основных настройках сервера.

export type LabTts = 'yandex' | 'elevenlabs'
export type LabLlm = 'yandex' | 'yandex-lite' | 'aitunnel' | 'offline'

export interface LabConfig {
  llm?: LabLlm
  tts?: LabTts
  /** SpeechKit: какой API — для сравнения v1 и v3 в игре */
  ttsApi?: 'v1' | 'v3'
  /** естественная речь (режиссёр речи + промпт «для голоса»); не задано — как на сервере (NATURAL_SPEECH) */
  natural?: boolean
  /** голоса livetts вместо обычных SpeechKit: auto — пара по голосу лица, либо свой голос на пол */
  live?: boolean
  liveMale?: string
  liveFemale?: string
}

export const LIVE_MALE = ['denis', 'sergey', 'vasily']
export const LIVE_FEMALE = ['sofia', 'vera', 'irina']

const KEY = 'peregovorka.lab.v1'

export function loadLab(): LabConfig {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as LabConfig
  } catch {
    return {}
  }
}

export function saveLab(c: LabConfig) {
  try {
    if (Object.values(c).every((v) => v === undefined)) sessionStorage.removeItem(KEY)
    else sessionStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    // нет хранилища — лаборатория работает только на своей странице
  }
}

/** Голос ElevenLabs в лаборатории — по полу собеседника (George и Sarah из каталога сервера). */
export const LAB_VOICE = { male: 'JBFqnCBsd6RMkjVDRZzb', female: 'EXAVITQu4vr4xnSDxMaL' }
