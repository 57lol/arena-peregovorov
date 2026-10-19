import { describe, expect, it } from 'vitest'
import sides from '../server/__fixtures__/sides5-corpus.json'
import { NEW_CASES } from './__fixtures__/goodModelCorpus'
import { SIDES_MODELS } from './__fixtures__/sidesModelCorpus'
import { corpus, dealFields } from './__fixtures__/modelPreservation'
import { groundAnalysis } from './offerEvidence'
import type { MoveAnalysis } from './types'

describe('правильная модель: разметка сделки сохраняется', () => {
  it('все исходные строки и минимум 100 новых; все дела, включая сгенерированное', async () => {
    expect(SIDES_MODELS).toHaveLength(sides.length)
    expect(sides).toHaveLength(125)
    // Порядок ручных аннотаций привязан к исходным текстам, а не только к длине массива.
    const bytes = new TextEncoder().encode(sides.map((e) => `${e.case}|${e.game}|${e.n}|${e.line}`).join('\n'))
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    expect(Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join(''))
      .toBe('2837e9cb5a7e297e62c9e4bcab6a21b5474de5f6f11e737437dfdc6be5d9862c')
    expect(new Set(NEW_CASES.flatMap(([, samples]) => samples.map(([text]) => text))).size).toBeGreaterThanOrEqual(100)
    expect(new Set(NEW_CASES.map(([id]) => id)).size).toBe(11)
  })
  it.each(corpus)('$source/$sc.id: $text', ({ sc, text, model, said }) => {
    const input: MoveAnalysis = { behaviors: [], ...structuredClone(model) }
    const saved = structuredClone(input)
    const actual = groundAnalysis(sc, text, input, said)
    expect(dealFields(actual)).toEqual(dealFields(model))
    expect(input).toEqual(saved)
    if (model.asksAbout) expect(actual.asksAbout).toEqual(model.asksAbout)
    for (const hit of model.behaviors ?? []) expect(actual.behaviors.map((b) => b.id)).toContain(hit.id)
    for (const act of model.talk ?? []) expect(actual.talk).toContain(act)
  })
})
