import { describe, expect, it } from 'vitest'
import { micAudio } from './recording'

const ZEN = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:158.0) Gecko/20100101 Firefox/158.0'
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const FIREFOX_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:158.0) Gecko/20100101 Firefox/158.0'

describe('micAudio — что просим у микрофона', () => {
  it('Firefox и Zen на маке: без обработки, иначе VoiceProcessingIO глушит голос собеседника на всю встречу', () => {
    expect(micAudio(ZEN)).toEqual({ channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false })
  })
  it('эхоподавление выключено везде (Safari приглушает им звук страницы)', () => {
    for (const ua of [ZEN, CHROME, SAFARI, FIREFOX_WIN]) expect(micAudio(ua).echoCancellation).toBe(false)
  })
  it('остальные браузеры — как раньше: шумоподавление включено', () => {
    for (const ua of [CHROME, SAFARI, FIREFOX_WIN]) expect(micAudio(ua)).toEqual({ channelCount: 1, echoCancellation: false, noiseSuppression: true })
  })
})
