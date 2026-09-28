// Лаборатория (/?lab): игра с другими провайдерами. Выбор живёт в sessionStorage этой вкладки —
// закрыл вкладку, и игра снова на основных YandexGPT и SpeechKit.

export type LabTts = 'yandex' | 'openai' | 'elevenlabs' | 'salute'
export type LabLlm = 'yandex' | 'yandex-lite' | 'openai' | 'anthropic' | 'gigachat' | 'offline'

export interface LabConfig {
  llm?: LabLlm
  tts?: LabTts
  /** SpeechKit: какой API — для сравнения v1 и v3 в игре */
  ttsApi?: 'v1' | 'v3'
}

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
    if (!c.llm && !c.tts && !c.ttsApi) sessionStorage.removeItem(KEY)
    else sessionStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    // нет хранилища — лаборатория работает только на своей странице
  }
}

/** Голос по умолчанию у чужого провайдера — по полу собеседника. */
export const LAB_VOICE: Record<Exclude<LabTts, 'yandex'>, { male: string; female: string }> = {
  openai: { male: 'ash', female: 'coral' },
  elevenlabs: { male: 'JBFqnCBsd6RMkjVDRZzb', female: 'EXAVITQu4vr4xnSDxMaL' },
  salute: { male: 'Bys_24000', female: 'Nec_24000' },
}
