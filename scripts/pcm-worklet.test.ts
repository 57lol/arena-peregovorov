import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
describe('pcm-worklet', () => {
  it('без каналов на входе шлёт тишину блоком, а не молчит: иначе пауза в речи не наступает (Firefox)', async () => {
    const sent: Float32Array[] = []
    let Proc: new () => { port: { postMessage: (m: Float32Array) => void }; process: (i: Float32Array[][]) => boolean } = undefined!
    const g = globalThis as Record<string, unknown>
    g.AudioWorkletProcessor = class { port = { postMessage: (m: Float32Array) => sent.push(m) } }
    g.registerProcessor = (_: string, c: typeof Proc) => { Proc = c }
    new Function(readFileSync('public/pcm-worklet.js', 'utf8'))()
    const p = new Proc()
    p.process([[]])
    p.process([[new Float32Array([0.5, 0.5]), new Float32Array([0.1, 0.1])]])
    expect(sent[0]).toHaveLength(128)
    expect(sent[0].every((x) => x === 0)).toBe(true)
    expect([...sent[1]].map((x) => +x.toFixed(2))).toEqual([0.3, 0.3])
    delete g.AudioWorkletProcessor
    delete g.registerProcessor
  })
})
