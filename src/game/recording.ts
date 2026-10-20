// Контракт записи и ошибки — без браузерной озвучки.

export interface Recording {
  /** закончить и получить запись */
  stop: () => Promise<Blob>
  transcript?: () => Promise<string | null>
  /** бросить без распознавания */
  cancel: () => void
}

export class SttError extends Error {
  /** распознавание на сервере выключено — кнопку прячем */
  off: boolean
  /** сбой сети или сервера: запись стоит отправить ещё раз */
  retry: boolean
  constructor(message: string, { off = false, retry = false } = {}) {
    super(message)
    this.off = off
    this.retry = retry
  }
}

/** Понятное сообщение об ошибке микрофона. */
export function micError(e: unknown): string {
  const { name, message } = (e ?? {}) as { name?: string; message?: string }
  // «Permission denied by system»: браузер разрешил, а macOS не даёт ему микрофон
  if (name === 'NotAllowedError' && /system/i.test(message ?? ''))
    return 'Система не даёт браузеру микрофон: Системные настройки → Конфиденциальность и безопасность → Микрофон. Или напишите реплику текстом.'
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Нет доступа к микрофону. Разрешите его для этого сайта в настройках браузера — или напишите реплику текстом.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Микрофон не найден. Подключите его или напишите реплику текстом.'
  if (name === 'NotReadableError') return 'Микрофон занят другой программой.'
  if (e instanceof SttError) return e.message
  return 'Не получилось записать звук. Напишите реплику текстом.'
}

/**
 * Что просим у микрофона. Эхоподавление выключено нарочно: в Safari и на iPhone оно приглушает весь звук страницы,
 * эхо отсекает listen.ts по времени. Firefox на маке (и Zen) любую обработку — даже одно шумоподавление — включает
 * через системный VoiceProcessingIO (лог cubeb: «prefs VOICE, voice processing true»), а тот приглушает остальной звук
 * устройства: голосовой режим держит микрофон всю встречу, и собеседника не слышно (партия капитана 18.10, Zen, «Семёрочка»).
 * Поэтому в Firefox на маке микрофон без обработки — шумоподавление ему всё равно не удаётся (cubeb: «AEC != NS»).
 */
export function micAudio(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent, device = loadMicId()): MediaTrackConstraints {
  const raw = /Macintosh/.test(ua) && /\bFirefox\//.test(ua)
  const c: MediaTrackConstraints = raw ? { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : { channelCount: 1, echoCancellation: false, noiseSuppression: true }
  // выбранный в меню микрофон (наушники распознаются хуже встроенного): ideal — пропал, берём любой
  return device ? { ...c, deviceId: { ideal: device } } : c
}

const MIC_KEY = 'peregovorka.mic.v1'
export function loadMicId(): string | undefined {
  try {
    return localStorage.getItem(MIC_KEY) ?? undefined
  } catch {
    return undefined
  }
}
export function saveMicId(id: string) {
  try {
    if (id) localStorage.setItem(MIC_KEY, id)
    else localStorage.removeItem(MIC_KEY)
  } catch {
    // нет хранилища — микрофон по умолчанию
  }
}
