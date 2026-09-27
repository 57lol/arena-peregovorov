// Реплика оппонента: LLM только озвучивает решение движка в характере персонажа.
// Всё, что противоречит решению (согласие, которого не было, другие цифры), — в корзину, берём шаблон.

import { z } from 'zod'
import { analyzeOffline, parseOffer, templateLine } from '../engine/offline'
import type { Decision, Emotion, OpponentState, Scenario, Tone, TurnRecord } from '../engine/types'
import { formatOffer } from '../engine/utility'
import type { BehaviorDict } from '../engine/dictionary'
import { cached } from './cache'
import type { LLM } from './llm'

export const VOICE_VERSION = 'v3'
const EMOTIONS: Emotion[] = ['neutral', 'pleased', 'happy', 'thinking', 'annoyed', 'angry']

const Raw = z.object({ line: z.string().min(2).max(600), emotion: z.string() })

const TONE: Record<Tone, string> = {
  friendly: 'доброжелательный, тёплый, может пошутить, но своё не отдаёт',
  neutral: 'спокойный, деловой, по делу',
  cold: 'сухой, короткий, без эмоций, отвечает рублеными фразами',
  aggressive: 'напористый, резкий, давит и перебивает, но без мата и оскорблений',
  evasive: 'уклончивый, тянет время, отвечает обтекаемо, но по сути решения',
}

const BANNED = [
  'не представляется возможным', 'в рамках', 'осуществ', 'данный', 'данная', 'данное', 'является', 'вышеуказ',
  'в целях', 'в связи с чем', 'надлежащ', 'уважаемый', 'благодарю за ваше', 'как ии', 'языковая модель', ' очк',
]

function system(sc: Scenario): string {
  const c = sc.opponent.character
  return `Ты играешь роль в тренажёре переговоров. Ты — ${c.name}, ${c.role}${c.company ? `, «${c.company}»` : ''}.
${c.bio ? `Кто ты: ${c.bio}\n` : ''}Характер: ${TONE[c.tone]}. ${c.speech ? `Манера речи: ${c.speech}.` : ''}
Твоя позиция: ${sc.opponent.brief}

Как говорить:
- Живая устная речь делового человека. 1–3 коротких предложения, до 35 слов.
- Никакого канцелярита: не «не представляется возможным», а «не могу»; не «осуществить поставку», а «привезти»; не «данный вопрос», а «это».
- Не извиняйся, не благодари за вопрос, не пересказывай всё сказанное. Без смайликов.
- Деловой тон обязателен: без мата и оскорблений, даже если игрок грубит.
- Ты не знаешь про очки, таблицы и движок. Никогда не упоминай их.

Примеры живых реплик:
«Миллион четыреста — и это я уже подвинулся.»
«Смотрите: срок могу сократить, а вот по деньгам — нет.»
«Слушайте, а зачем вам такая длинная отсрочка?»
«Давайте без этого. Ещё раз — и разговор закончен.»

Главное правило: ты произносишь ТОЛЬКО решение, которое тебе дали. Не соглашайся, если решение не «согласиться». Не называй других цифр, кроме данных.
Ответ — JSON {"line": "...", "emotion": "${EMOTIONS.join('|')}"}.`
}

function instruction(sc: Scenario, d: Decision, state: OpponentState): string {
  const offer = (o: Record<string, number | undefined>) => formatOffer(sc, o)
  switch (d.kind) {
    case 'accept':
      return `Решение: СОГЛАСИТЬСЯ. Подтверди сделку на условиях: ${offer(state.deal ?? state.tableOffer)}.`
    case 'counter':
      return `Решение: ВСТРЕЧНОЕ ПРЕДЛОЖЕНИЕ. Назови ровно эти условия: ${offer(d.offer)}.${d.final ? ' Скажи, что это последнее предложение: время встречи кончается.' : ''} Можно коротко обосновать, не раскрывая внутренних причин.`
    case 'reveal': {
      const it = sc.opponent.profile.interests.find((i) => i.id === d.interestId)
      return `Решение: ЧЕСТНО РАССКАЗАТЬ, что тебе на самом деле важно: «${it?.text}».${d.offer ? ` И предложить: ${offer(d.offer)}.` : ' Своё предложение не меняй.'}`
    }
    case 'hold':
      switch (d.reason) {
        case 'not_ready_to_reveal': return 'Решение: НЕ РАСКРЫВАТЬ причины. Уйди от ответа: пока не доверяешь собеседнику. Предложение не меняй.'
        case 'no_movement': return `Решение: ДЕРЖАТЬ ПОЗИЦИЮ. Двигаться не готов. Твоё предложение прежнее: ${offer(state.lastOpponentOffer ?? {})}.`
        case 'player_left': return 'Решение: собеседник уходит. Коротко попрощайся, без сделки.'
        case 'timeout': return 'Решение: время вышло, сделки нет. Коротко закончи встречу.'
        default: return 'Решение: ЖДАТЬ КОНКРЕТИКИ. Игрок не сделал предложения — попроси назвать условия. Своё предложение не меняй.'
      }
    case 'warn_tone':
      return 'Решение: ОДЁРНУТЬ за тон. Твёрдо, без ответной грубости: ещё раз — и разговор окончен. Про условия ничего не говори.'
    case 'walk_away':
      return 'Решение: УЙТИ. Ты заканчиваешь переговоры, сделки не будет. Одна-две фразы.'
  }
}

/** Проверяем, что реплика не противоречит решению движка. */
export function lineFits(sc: Scenario, d: Decision, state: OpponentState, line: string, dict: BehaviorDict): boolean {
  const low = line.toLowerCase()
  if (BANNED.some((b) => low.includes(b))) return false
  if (d.kind !== 'accept' && analyzeOffline(sc, line, dict).accepts) return false
  const expected = d.kind === 'counter' || d.kind === 'reveal' ? ('offer' in d ? d.offer : undefined) : d.kind === 'accept' ? state.deal : undefined
  if (expected) {
    const said = parseOffer(sc, line)
    for (const [k, v] of Object.entries(said)) if (expected[k] !== undefined && expected[k] !== v) return false
  }
  return true
}

export interface VoiceResult {
  line: string
  emotion: Emotion
  source: 'llm' | 'cache' | 'template'
  error?: string
}

export async function voice(
  llm: LLM,
  sc: Scenario,
  dict: BehaviorDict,
  history: TurnRecord[],
  playerText: string,
  d: Decision,
  state: OpponentState,
): Promise<VoiceResult> {
  const fallback = templateLine(sc, d, state)
  if (llm.name === 'offline') return { ...fallback, source: 'template' }
  const recent = history
    .slice(-3)
    .map((h) => `Игрок: ${h.playerText}\nТы: ${h.opponentLine}`)
    .join('\n')
  const user = `${recent ? `Разговор до этого:\n${recent}\n\n` : `Ты начал встречу словами: «${sc.opening}»\n\n`}Игрок сейчас сказал: «${playerText}»

${instruction(sc, d, state)}
Настроение: доверие к игроку ${Math.round(state.trust)}/100, раздражение ${Math.round(state.tension)}/100.`
  const key = { v: VOICE_VERSION, llm: `${llm.name}:${llm.model}`, sc: sc.id, sys: system(sc), user }
  try {
    const { value, hit } = await cached('voice', key, async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = Raw.parse(await llm.json({
          system: system(sc),
          user: attempt ? `${user}\n\nПрошлый вариант не подошёл: он противоречил решению или звучал канцелярски. Строго по решению, живым языком.` : user,
          temperature: attempt ? 0.3 : 0.6,
          maxTokens: 300,
          schema: {
            name: 'opponent_line',
            schema: {
              type: 'object', additionalProperties: false, required: ['line', 'emotion'],
              properties: { line: { type: 'string' }, emotion: { type: 'string', enum: EMOTIONS } },
            },
          },
        }))
        const line = r.line.trim().replace(/^[«"]|[»"]$/g, '')
        if (lineFits(sc, d, state, line, dict)) {
          // Эмоцию для ключевых решений задаёт движок, чтобы спрайт не улыбался при уходе.
          const forced = d.kind === 'accept' || d.kind === 'walk_away' || d.kind === 'warn_tone'
          const emotion = !forced && EMOTIONS.includes(r.emotion as Emotion) ? (r.emotion as Emotion) : fallback.emotion
          return { line, emotion }
        }
      }
      throw new Error('Реплика не прошла проверку')
    })
    return { ...value, source: hit ? 'cache' : 'llm' }
  } catch (e) {
    return { ...fallback, source: 'template', error: (e as Error).message }
  }
}
