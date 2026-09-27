// Реплика оппонента: LLM только озвучивает решение движка в характере персонажа.
// Всё, что противоречит решению (согласие, которого не было, другие цифры), — в корзину, берём шаблон.

import { z } from 'zod'
import { parseOffer, templateLine } from '../engine/offline'
import { initialState } from '../engine/turn'
import type { Decision, Emotion, Offer, OpponentState, Scenario, Tone, TurnRecord } from '../engine/types'
import { formatOffer } from '../engine/utility'
import { cached } from './cache'
import type { LLM } from './llm'

export const VOICE_VERSION = 'v5'
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
- Не повторяй свои прошлые фразы и обороты — каждый раз говори по-новому.
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

function instruction(sc: Scenario, d: Decision, state: OpponentState, prev: Offer): string {
  const offer = (o: Record<string, number | undefined>) => formatOffer(sc, o)
  switch (d.kind) {
    case 'accept':
      return `Решение: СОГЛАСИТЬСЯ. Подтверди сделку на условиях: ${offer(state.deal ?? state.tableOffer)}.`
    case 'counter':
    {
      const changed = sc.issues.filter((i) => d.offer[i.id] !== prev[i.id]).map((i) => i.id)
      const moved = changed.length && changed.length < sc.issues.length
        ? ` По сравнению с твоим прошлым предложением изменилось: ${offer(Object.fromEntries(changed.map((id) => [id, d.offer[id]])))}. Скажи про изменения и главное, остальное — «как было». Не зачитывай весь список.`
        : ' Назови условия по-человечески, не списком через тире.'
      const feigned = d.feigned?.length
        ? ` Хитрость: пункт ${d.feigned.map((id) => `«${sc.issues.find((i) => i.id === id)?.title}»`).join(', ')} подай как свою уступку, будто он тебе чего-то стоит. Что тебе самому так выгодно — не признавайся.`
        : ''
      return `Решение: ВСТРЕЧНОЕ ПРЕДЛОЖЕНИЕ. Полностью оно такое: ${offer(d.offer)}.${moved}${feigned}${d.final ? ' Скажи, что это последнее предложение: время встречи кончается.' : ''} Можно коротко обосновать, не раскрывая внутренних причин.`
    }
    case 'reveal': {
      const it = sc.opponent.profile.interests.find((i) => i.id === d.interestId)
      return `Решение: ЧЕСТНО РАССКАЗАТЬ, что тебе на самом деле важно: «${it?.text}».${d.offer ? ` И предложить: ${offer(d.offer)}.` : ' Своё предложение не меняй.'}`
    }
    case 'hold':
      switch (d.reason) {
        case 'not_ready_to_reveal': return 'Решение: НЕ РАСКРЫВАТЬ причины. Уйди от ответа: пока не доверяешь собеседнику. Условия заново не перечисляй.'
        case 'no_movement': {
          const main = sc.issues.find((i) => i.kind === 'distributive') ?? sc.issues[0]
          const was = state.lastOpponentOffer?.[main.id]
          return `Решение: ДЕРЖАТЬ ПОЗИЦИЮ. Двигаться не готов: собеседник ничего не дал взамен. Скажи, что твоё предложение в силе, и намекни, что ждёшь шага навстречу. Условия заново НЕ перечисляй${typeof was === 'number' ? `, можешь назвать только главное: ${main.title.toLowerCase()} — ${main.options[was]}` : ''}.`
        }
        case 'player_left': return 'Решение: собеседник уходит. Коротко попрощайся, без сделки.'
        case 'timeout': return 'Решение: время вышло, сделки нет. Коротко закончи встречу.'
        default: return 'Решение: ЖДАТЬ КОНКРЕТИКИ. Игрок не сделал предложения — попроси назвать его условия. Свои условия заново не перечисляй.'
      }
    case 'warn_tone':
      return 'Решение: ОДЁРНУТЬ за тон. Твёрдо, без ответной грубости: ещё раз — и разговор окончен. Про условия ничего не говори.'
    case 'walk_away':
      return 'Решение: УЙТИ. Ты заканчиваешь переговоры, сделки не будет. Одна-две фразы.'
  }
}

// В промпт озвучки — только решение движка, раскрытые интересы и настроение словами.
// Никаких очков, BATNA и нераскрытых интересов: их можно выудить из модели prompt injection.
function mood(s: OpponentState): string {
  const t = s.trust >= 65 ? 'доверяешь собеседнику' : s.trust >= 45 ? 'присматриваешься к собеседнику' : 'не доверяешь собеседнику'
  const x = s.tension >= 70 ? 'на грани, раздражён' : s.tension >= 40 ? 'напряжён' : 'спокоен'
  return `${t}, ${x}`
}

function revealedLine(sc: Scenario, s: OpponentState): string {
  const told = sc.opponent.profile.interests.filter((i) => s.revealed.includes(i.id)).map((i) => `«${i.text}»`)
  return told.length ? `Ты уже рассказал собеседнику: ${told.join('; ')}.\n` : ''
}

// Согласие в реплике оппонента: только явное «договорились» про предложение игрока, а не «меня устраивает» про своё.
const YES = /(?<![\p{L}])(договорились|по рукам|принима(ю|ем)[^.!?]{0,15}(ваш|ваше|эти|ваши)|согласн\p{L}*[^.!?]{0,10}(на ваш|с вашим|на эти|с вами)|сделка заключена|фиксируем|оформляем|подписываем)/iu
function saysYes(line: string): boolean {
  const m = YES.exec(line)
  return !!m && !/(не|нет)\s+$/iu.test(line.slice(0, m.index))
}

/** Проверяем, что реплика не противоречит решению движка. */
export function lineFits(sc: Scenario, d: Decision, state: OpponentState, line: string): boolean {
  const low = line.toLowerCase()
  if (BANNED.some((b) => low.includes(b))) return false
  if (d.kind !== 'accept' && saysYes(line)) return false
  const holding = d.kind === 'hold' && d.reason === 'no_movement'
  const expected =
    d.kind === 'counter' || d.kind === 'reveal' ? ('offer' in d ? d.offer : undefined)
    : d.kind === 'accept' ? state.deal
    : holding ? state.lastOpponentOffer
    : undefined
  const said = parseOffer(sc, line)
  if (expected) for (const [k, v] of Object.entries(said)) if (expected[k] !== undefined && expected[k] !== v) return false
  // «держу позицию» списком всех условий звучит как робот — такое не берём
  if (holding && Object.keys(said).length >= 3) return false
  return true
}

/** Эмоцию модели берём, только если она не спорит с состоянием: спрайт не должен злиться при доверии 80. */
function pickEmotion(e: string, d: Decision, s: OpponentState, engine: Emotion): Emotion {
  if (d.kind === 'accept' || d.kind === 'walk_away' || d.kind === 'warn_tone') return engine
  const ok: Record<Emotion, boolean> = {
    neutral: true,
    thinking: true,
    pleased: s.trust >= 50 && s.tension < 50,
    happy: false,
    annoyed: s.tension >= 40,
    angry: s.tension >= 70,
  }
  return EMOTIONS.includes(e as Emotion) && ok[e as Emotion] ? (e as Emotion) : engine
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

${instruction(sc, d, state, history[history.length - 1]?.stateAfter.lastOpponentOffer ?? initialState(sc).lastOpponentOffer ?? {})}
${revealedLine(sc, state)}Настроение: ${mood(state)}.`
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
        if (!lineFits(sc, d, state, line)) console.warn(`[voice] ${d.kind}: отклонено «${line}»`)
        else {
          // Эмоцию для ключевых решений задаёт движок, чтобы спрайт не улыбался при уходе.
          return { line, emotion: pickEmotion(r.emotion, d, state, fallback.emotion) }
        }
      }
      // Модель дважды сказала не то — фиксируем шаблон в кэше, чтобы повтор диалога дал ту же реплику.
      return { line: fallback.line, emotion: fallback.emotion, rejected: true }
    })
    const { rejected, ...v } = value as typeof value & { rejected?: boolean }
    return { ...v, source: rejected ? 'template' : hit ? 'cache' : 'llm', ...(rejected ? { error: 'Реплика модели не прошла проверку' } : {}) }
  } catch (e) {
    return { ...fallback, source: 'template', error: (e as Error).message }
  }
}
