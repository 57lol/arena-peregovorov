import { getScenario, harder } from '../../content/scenarios'
import generated from './generatedScenario.json'
import sides from '../../server/__fixtures__/sides5-corpus.json'
import { COMMON as RU_COMMON, CASES as RU_CASES } from './russianModelCorpus'
import { COMMON as EN_COMMON, CASES as EN_CASES } from './foreignModelCorpus'
import { NEW_CASES } from './goodModelCorpus'
import { SIDES_MODELS } from './sidesModelCorpus'
import type { MoveAnalysis, Scenario } from '../types'


const scenario = (id: string) => id === 'gen' ? generated as Scenario : getScenario(id === 'inei' ? 'client' : id)!
// Проверяем полный набор полей, меняющих сделку, включая лишние условия.
// Добавление разговорных индикаторов/модерации — отдельная описанная защита groundAnalysis.
// Не используем analyzeOffline/parseOffer/groundAnalysis для получения эталона.
export function dealFields(a: Partial<MoveAnalysis>) {
  return { offer: a.offer ?? {}, accepts: !!a.accepts, walksAway: !!a.walksAway, rest: !!a.rest }
}

export const corpus: { source: string; sc: Scenario; text: string; model: Partial<MoveAnalysis>; said?: string }[] = []
for (const [id, samples] of RU_CASES) for (const sc of [scenario(id), harder(scenario(id))]) {
  for (const [text, expected, said] of [...RU_COMMON, ...samples]) {
    const { behaviors, ...model } = expected
    if (id === 'stop' && text === 'Простите, погорячился') model.offer = { sorry: 2 }
    corpus.push({ source: 'russian', sc, text, said, model: { ...model, behaviors: (behaviors ?? []).map((id) => ({ id, quote: text })) } })
  }
}
for (const [base, samples] of EN_CASES) for (const sc of [base, harder(base)]) {
  for (const [text, model, behavior] of [...EN_COMMON, ...samples]) corpus.push({
    source: 'foreign', sc, text, model: { ...model, behaviors: behavior ? [{ id: behavior, quote: text }] : [] },
  })
}
for (const [n, e] of sides.entries()) corpus.push({ source: `sides#${n}`, sc: scenario(e.case), text: e.line, model: SIDES_MODELS[n] })
for (const [id, samples] of NEW_CASES) for (const [text, model, said] of samples) corpus.push({ source: 'new', sc: scenario(id), text, model, said })

