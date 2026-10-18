import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'arena-emotion-'))
const { voice } = await import('./voice')
const { findScenario } = await import('./library')
const { initialState } = await import('../engine/turn')
type LLM = import('./llm').LLM

// Лицо, как и слова, не радуется своей уступке: Эмре отдаёт восемь недель — не улыбается (SIDES5).
const sc = findScenario('istanbul')!
const prev = { price: 1, payment: 1, delivery: 2, warranty: 1, training: 2 }
const say = (line: string, emotion: string): LLM => ({ name: 'aitunnel', model: `fake-${line.length}-${emotion}`, json: async () => ({ agrees: false, terms: [{ issue: 'delivery', option: 4 }], reveals: [], line, emotion }) })
const state = (stance: Record<string, number>) => ({ ...initialState(sc), trust: 70, tension: 20, playerStance: stance, lastOpponentOffer: prev })
const history = [{ turn: 1, playerText: '…', analysis: { behaviors: [] }, deltas: [], decision: { kind: 'hold' as const, reason: 'no_offer' as const }, opponentLine: '…', emotion: 'neutral', stateAfter: { ...state({}), turn: 1 } }]

describe('эмоция лица по очкам', () => {
  it('только уступает — не pleased, даже если модель так сказала', async () => {
    const r = await voice(say('Eight weeks… okay, that I can give, but it costs me.', 'pleased'), sc, history, 'Eight weeks, please.', { kind: 'counter', offer: { ...prev, delivery: 4 } }, { ...state({ delivery: 4 }), turn: 2 })
    expect(r.emotion).not.toBe('pleased')
    expect(r.emotion).not.toBe('happy')
  })
  it('игрок уступил ему — можно pleased', async () => {
    const r = await voice({ ...say('Full upfront, now that is a step toward me.', 'pleased'), json: async () => ({ agrees: false, terms: [], reveals: [], line: 'Full upfront, now that is a step toward me.', emotion: 'pleased' }) }, sc, history, '100% upfront.', { kind: 'hold', reason: 'no_movement' }, { ...state({ payment: 0 }), turn: 2 })
    expect(r.emotion).toBe('pleased')
  })
})
