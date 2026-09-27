// Разбор реплики игрока через LLM: temperature 0, строгий JSON, проверка, кэш. При любой беде — офлайн.

import { z } from 'zod'
import type { BehaviorDict } from '../engine/dictionary'
import { analyzeOffline, isRude } from '../engine/offline'
import type { MoveAnalysis, Offer, Scenario, TurnRecord } from '../engine/types'
import { formatOffer } from '../engine/utility'
import { cached } from './cache'
import type { LLM } from './llm'

export const PROMPT_VERSION = 'a3'

const Raw = z.object({
  behaviors: z.array(z.object({ id: z.string(), quote: z.string() })),
  offer: z.array(z.object({ issue: z.string(), option: z.number().int() })),
  accepts: z.boolean(),
  walksAway: z.boolean(),
  asksAbout: z.array(z.string()),
  toneViolation: z.boolean(),
})

function schemaFor(sc: Scenario, dict: BehaviorDict) {
  const issueIds = sc.issues.map((i) => i.id)
  return {
    name: 'move_analysis',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['behaviors', 'offer', 'accepts', 'walksAway', 'asksAbout', 'toneViolation'],
      properties: {
        behaviors: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'quote'],
            properties: { id: { type: 'string', enum: Object.keys(dict) }, quote: { type: 'string' } },
          },
        },
        offer: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['issue', 'option'],
            properties: { issue: { type: 'string', enum: issueIds }, option: { type: 'integer' } },
          },
        },
        accepts: { type: 'boolean' },
        walksAway: { type: 'boolean' },
        asksAbout: { type: 'array', items: { type: 'string', enum: issueIds } },
        toneViolation: { type: 'boolean' },
      },
    },
  }
}

function systemPrompt(sc: Scenario, dict: BehaviorDict): string {
  const issues = sc.issues
    .map((i) => `- ${i.id} «${i.title}»: ${i.options.map((o, n) => `${n}=«${o}»`).join(', ')}`)
    .join('\n')
  const behaviors = Object.values(dict)
    .map((b) => `- ${b.id}: ${b.label}${b.hint ? ` — ${b.hint}` : ''}`)
    .join('\n')
  return `Ты — разметчик реплик в тренажёре деловых переговоров. Ты не отвечаешь игроку и не оцениваешь его, только размечаешь одну его реплику по правилам.

Переговоры: «${sc.title}». Игрок — ${sc.player.role}. Оппонент — ${sc.opponent.character.name}, ${sc.opponent.character.role}.

Пункты переговоров и варианты (номер=вариант):
${issues}

Поведенческие индикаторы (id: что это):
${behaviors}

Правила разметки:
1. behaviors — только индикаторы, которые явно есть в реплике. quote — точная цитата из реплики (дословный фрагмент, 3–15 слов). Если ничего нет — пустой массив.
2. offer — только то, что игрок предлагает сейчас сам (не то, что он отвергает, и не пересказ слов оппонента). option — номер ближайшего варианта. Пункты, о которых игрок не говорит, не включай.
3. accepts = true, только если игрок явно соглашается на последнее предложение оппонента целиком («договорились», «согласен», «по рукам»). Вопрос или условное согласие — false.
4. walksAway = true, только если игрок явно прекращает переговоры.
5. asksAbout — пункты, про которые игрок спрашивает причины, интересы или важность для оппонента.
6. toneViolation = true при мате, оскорблениях, унижении, угрозах личного характера. Жёсткая позиция, ультиматум или прямота — это НЕ нарушение тона.`
}

function userPrompt(sc: Scenario, history: TurnRecord[], text: string, lastOpponentOffer?: Offer): string {
  const recent = history
    .slice(-3)
    .map((h) => `Игрок: ${h.playerText}\n${sc.opponent.character.name}: ${h.opponentLine}`)
    .join('\n')
  return `${recent ? `Последние реплики:\n${recent}\n\n` : ''}${
    lastOpponentOffer && Object.keys(lastOpponentOffer).length ? `Последнее предложение оппонента: ${formatOffer(sc, lastOpponentOffer)}\n\n` : ''
  }Реплика игрока для разметки:
«${text}»

Верни JSON: {"behaviors":[{"id","quote"}],"offer":[{"issue","option"}],"accepts","walksAway","asksAbout":[],"toneViolation"}`
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\d]+/gu, ' ').trim()

/** Цитата должна реально быть в реплике — иначе это выдумка модели. */
function quoteFits(quote: string, text: string): boolean {
  const q = norm(quote)
  const t = norm(text)
  if (!q) return true
  if (t.includes(q)) return true
  const words = q.split(' ')
  const hits = words.filter((w) => t.includes(w)).length
  return hits / words.length >= 0.7
}

export function validate(sc: Scenario, dict: BehaviorDict, text: string, raw: unknown): MoveAnalysis {
  const r = Raw.parse(raw)
  const out: MoveAnalysis = {
    behaviors: r.behaviors
      .filter((b) => dict[b.id] && quoteFits(b.quote, text))
      .filter((b, n, a) => a.findIndex((x) => x.id === b.id) === n),
  }
  const offer: Offer = {}
  for (const o of r.offer) {
    const issue = sc.issues.find((i) => i.id === o.issue)
    if (issue && o.option >= 0 && o.option < issue.options.length) offer[issue.id] = o.option
  }
  if (Object.keys(offer).length) out.offer = offer
  if (r.accepts) out.accepts = true
  if (r.walksAway) out.walksAway = true
  const asks = r.asksAbout.filter((id) => sc.issues.some((i) => i.id === id))
  if (asks.length) out.asksAbout = [...new Set(asks)]
  // Модерация не доверяется одной модели: стоп-слова проверяются всегда.
  if (r.toneViolation || isRude(text)) out.toneViolation = true
  return out
}

export interface AnalyzeResult {
  analysis: MoveAnalysis
  source: 'llm' | 'cache' | 'offline'
  error?: string
}

export async function analyzeMove(
  llm: LLM,
  sc: Scenario,
  dict: BehaviorDict,
  history: TurnRecord[],
  text: string,
  lastOpponentOffer?: Offer,
): Promise<AnalyzeResult> {
  if (llm.name === 'offline') return { analysis: analyzeOffline(sc, text, dict), source: 'offline' }
  const key = {
    v: PROMPT_VERSION,
    llm: `${llm.name}:${llm.model}`,
    sc,
    dict: Object.keys(dict),
    history: history.map((h) => [h.playerText, h.opponentLine]),
    text,
    lastOpponentOffer,
  }
  try {
    const { value, hit } = await cached('analyze', key, async () =>
      validate(sc, dict, text, await llm.json({
        system: systemPrompt(sc, dict),
        user: userPrompt(sc, history, text, lastOpponentOffer),
        temperature: 0,
        maxTokens: 700,
        schema: schemaFor(sc, dict),
      })),
    )
    return { analysis: value, source: hit ? 'cache' : 'llm' }
  } catch (e) {
    return { analysis: analyzeOffline(sc, text, dict), source: 'offline', error: (e as Error).message }
  }
}
