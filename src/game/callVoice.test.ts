import { afterEach, describe, expect, it, vi } from 'vitest'
import { SCENARIOS } from '../content/scenarios'
import { isVideoCall, sceneFor } from './cast'
import { callVoice, callVoiceActive } from './callVoice'
import { SCENES } from './ui/assets'

describe('видеозвонок', () => {
  it('только «Поставщик из Иу» идёт по видеосвязи — из кофейни', () => {
    const calls = SCENARIOS.filter(isVideoCall).map((s) => s.id)
    expect(calls).toEqual(['china'])
    const china = SCENARIOS.find((s) => s.id === 'china')!
    expect(sceneFor(china)).toBe('cafe')
    expect(SCENES.cafe.bg).toBe('/assets/scenes/cafe.png')
  })

  describe('голос «через связь»', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('без Web Audio ничего не ломает', () => {
      vi.stubGlobal('window', {})
      expect(() => callVoice({} as HTMLAudioElement, true)).not.toThrow()
      expect(callVoiceActive()).toBe(false)
    })

    it('пока контекст спит, <audio> в граф не заводится; проснулся — голос идёт через полосу телефона', () => {
      const made: string[] = []
      const node = () => {
        const n = { connect: (x: unknown) => x, gain: { value: 1, setTargetAtTime: vi.fn() }, frequency: { value: 0 }, Q: { value: 0 } } as Record<string, unknown>
        return n
      }
      class Ctx {
        state = 'suspended'
        onstatechange: (() => void) | null = null
        currentTime = 0
        sampleRate = 8000
        destination = node()
        resume = vi.fn(async () => {
          this.state = 'running'
          this.onstatechange?.()
        })
        createMediaElementSource = () => (made.push('source'), node())
        createGain = () => node()
        createBiquadFilter = () => (made.push('filter'), { ...node(), type: '', gain: { value: 0 } })
        createDynamicsCompressor = () => ({ ...node(), threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 } })
        createBufferSource = () => ({ ...node(), start: vi.fn(), loop: false, buffer: null })
        createBuffer = (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) })
      }
      vi.stubGlobal('window', { AudioContext: Ctx })
      const el = { paused: true, ended: false, addEventListener: vi.fn() } as unknown as HTMLAudioElement
      callVoice(el, true)
      expect(made).not.toContain('source')
      expect(callVoiceActive()).toBe(false)
      return import('./callVoice').then(async ({ resumeCallVoice }) => {
        resumeCallVoice()
        await Promise.resolve()
        expect(made.filter((m) => m === 'source')).toHaveLength(1)
        expect(made.filter((m) => m === 'filter').length).toBeGreaterThanOrEqual(5)
        expect(callVoiceActive()).toBe(true)
        callVoice(el, false)
        expect(callVoiceActive()).toBe(false)
      })
    })
  })
})
