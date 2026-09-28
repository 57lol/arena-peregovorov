// Сколько весят промпты: разбор реплики, реплика собеседника, генерация дела. Без сети, считает символы
// и токены (токены — через бесплатный tokenize Яндекса, если в .env есть ключ и передан --tokens).
// Запуск: npx tsx scripts/prompt-size.ts [--tokens] [--dump]

import { BEHAVIOR_DICT } from '../src/engine/behaviors'
import { initialState } from '../src/engine/turn'
import type { TurnRecord } from '../src/engine/types'
import { findScenario } from '../src/server/library'
import { systemPrompt, userPrompt, schemaFor } from '../src/server/analyze'
import { system as voiceSystem, instruction } from '../src/server/voice'
import { SYSTEM as GEN_SYSTEM, userPrompt as genUser, SCHEMA as GEN_SCHEMA } from '../src/server/generate'

try {
  process.loadEnvFile('.env')
} catch {
  // без ключа — только символы
}

const sc = findScenario('tara')!
const st = initialState(sc)
const hist: TurnRecord[] = [1, 2, 3].map((n) => ({
  turn: n,
  playerText: 'Давайте так: цена 14 рублей за штуку, отсрочка 30 дней, а по объёму готовы взять больше.',
  analysis: { behaviors: [] },
  deltas: [],
  decision: { kind: 'hold' } as never,
  opponentLine: 'Четырнадцать — это мало. Могу подвинуться по сроку, но цена остаётся.',
  emotion: 'neutral',
  stateAfter: st,
}))
const text = 'Скажите, а почему для вас так важна оплата по факту? Если дело в кассовом разрыве, можем обсудить аванс.'

const parts: Record<string, string> = {
  'разбор: system': systemPrompt(sc, BEHAVIOR_DICT),
  'разбор: user': userPrompt(sc, hist, text, st.lastOpponentOffer),
  'разбор: schema': JSON.stringify(schemaFor(sc, BEHAVIOR_DICT)),
  'реплика: system': voiceSystem(sc),
  'реплика: user': `Разговор до этого:\n${hist.slice(-2).map((h) => `Игрок: ${h.playerText}\nТы: ${h.opponentLine}`).join('\n')}\n\nИгрок сейчас сказал: «${text}»\n\n${instruction(sc, { kind: 'hold', reason: 'no_movement' } as never, st, st.lastOpponentOffer ?? {})}\nНастроение: присматриваешься.`,
  'генерация: system': GEN_SYSTEM,
  'генерация: user': genUser({} as never, []),
  'генерация: schema': JSON.stringify(GEN_SCHEMA),
}

async function tokens(s: string): Promise<number | undefined> {
  const key = process.env.YANDEX_API_KEY, folder = process.env.YANDEX_FOLDER_ID
  if (!process.argv.includes('--tokens') || !key || !folder) return undefined
  const r = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/tokenize', {
    method: 'POST',
    headers: { authorization: `Api-Key ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ modelUri: `gpt://${folder}/${process.env.YANDEX_MODEL ?? 'yandexgpt-5.1'}`, text: s }),
  })
  if (!r.ok) return undefined
  return ((await r.json()) as { tokens: unknown[] }).tokens.length
}

for (const [name, s] of Object.entries(parts)) {
  const t = await tokens(s)
  console.log(`${name.padEnd(20)} ${String(s.length).padStart(6)} симв.${t ? ` ${String(t).padStart(6)} ток.` : ''}`)
  if (process.argv.includes('--dump')) console.log(s + '\n---')
}
