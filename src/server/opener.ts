// Первые слова ответа — быстрой моделью, пока игрок ещё в паузе конца реплики, а Sonnet пишет реплику и модели размечают
// ход. Это короткий живой отклик на слова игрока без обязательств: без цифр, согласия и отказа, условий и тайн. Поэтому
// его можно озвучить до разметки: он не противоречит никакому решению движка. Sonnet продолжает реплику с этих слов.

import type { OpponentState, Scenario, TurnRecord } from '../engine/types'
import { isEn } from '../engine/lang'
import { quantities } from '../engine/offline/numbers'
import { peek, put } from './cache'
import type { LLM } from './llm'
import { stripTags } from './tags'

const TONE: Record<string, string> = {
  friendly: 'тёплый, лёгкий, любит пошутить',
  neutral: 'спокойный, деловой',
  cold: 'сухой, короткий, с иронией',
  aggressive: 'напористый, давит',
  evasive: 'осторожный, уходит от прямых ответов',
}
const TONE_EN: Record<string, string> = {
  friendly: 'warm, easy-going, likes a joke',
  neutral: 'calm, businesslike',
  cold: 'dry, brief, ironic',
  aggressive: 'pushy, presses hard',
  evasive: 'careful, avoids straight answers',
}

/** Настроение коротко: от него зависит, каким будет отклик (тепло, сухо, с раздражением). */
function moodOf(s: OpponentState, en: boolean): string {
  if (en) return s.tension >= 70 ? 'You are irritated.' : s.trust >= 65 ? 'You like this person.' : s.tension >= 40 ? 'You are a bit tense.' : ''
  return s.tension >= 70 ? 'Ты на взводе.' : s.trust >= 65 ? 'Он тебе нравится.' : s.tension >= 40 ? 'Ты напряжён.' : ''
}

export function openerPrompt(sc: Scenario, history: TurnRecord[], playerText: string, state: OpponentState, rude = false) {
  const c = sc.opponent.character
  const said = history.length ? history[history.length - 1].opponentLine : sc.opening
  const examples = (c.voiceExamples ?? []).slice(0, 3)
  // прошлые реплики начинались так — заход не повторяет их начало
  const starts = history.slice(-3).map((h) => h.opponentLine.split(/\s+/).slice(0, 3).join(' '))
  if (isEn(sc)) {
    return {
      system: `You are ${c.name}, ${c.role}. Character: ${TONE_EN[c.tone] ?? TONE_EN.neutral}.${c.speech ? ` How you speak: ${c.speech}` : ''}${examples.length ? `\nYou sound like: ${examples.map((e) => `"${e}"`).join(' ')}` : ''}
A negotiation is going on: "${sc.title}". The other side has just finished speaking. Say out loud only the very first words of your answer: 2–5 words, a live reaction to what they said — surprise, a short laugh, thinking aloud, their name, or their word with a question, whatever fits the moment and your character. No position and no answer to their question yet — only the reaction. You will continue the answer yourself right after, separately.
You haven't decided yet whether what they said is good for you, so no judgement: don't be glad, don't praise, don't thank and don't be outraged ("now we're talking", "great", "thanks", "no problem", "interesting proposal", "are you kidding?").
Never: numbers, prices, dates; agreeing or refusing ("yes", "no", "deal", "okay", "fine"); naming terms; a question about the deal; "absolutely", "of course", "great question", "I understand". No quotes, brackets or emojis.
Answer JSON {"say": "words"}; the words end with ".", "!", "?" or "…".`,
      user: `You said before: "${said}"\nThey: "${playerText}"${rude ? '\nThey were rude.' : ''}\n${moodOf(state, true)}${starts.length ? `\nYour earlier lines began: ${starts.map((x) => `"${x}…"`).join(', ')} — start differently.` : ''}`,
    }
  }
  return {
    system: `Ты — ${c.name}, ${c.role}. Характер: ${TONE[c.tone] ?? TONE.neutral}.${c.speech ? ` Как говоришь: ${c.speech}` : ''}${examples.length ? `\nТак ты звучишь: ${examples.map((e) => `«${e}»`).join(' ')}` : ''}
Идут переговоры «${sc.title}». Собеседник только что договорил. Скажи вслух только первые слова своего ответа: 2–5 слов живого отклика на то, что он сказал, — удивление, усмешка, раздумье вслух, обращение по имени или его слово с вопросом: что подходит к моменту и к характеру. Без своей позиции и без ответа на его вопрос — только отклик. Дальше ты договоришь сам, отдельно.
Ты ещё не решил, выгодно ли тебе то, что он сказал: поэтому без оценки — не радуйся, не хвали, не благодари и не возмущайся («вот это разговор», «отлично», «спасибо», «без проблем», «интересное предложение», «издеваешься?»).
Нельзя: цифры, суммы, сроки; соглашаться или отказываться («да», «нет», «ладно», «идёт», «договорились»); называть условия; вопрос по делу; «конечно», «отличный вопрос», «понимаю». Без кавычек, скобок и смайликов.
Ответ — JSON {"say": "слова"}; слова кончаются на «.», «!», «?» или «…».`,
    user: `Ты до этого сказал: «${said}»\nОн: «${playerText}»${rude ? '\nОн нагрубил.' : ''}\n${moodOf(state, false)}${starts.length ? `\nТвои прошлые реплики начинались так: ${starts.map((x) => `«${x}…»`).join(', ')} — начни по-другому.` : ''}`,
  }
}

const SCHEMA = {
  name: 'opener',
  schema: { type: 'object', additionalProperties: false, required: ['say'], properties: { say: { type: 'string' } } },
}

// обязательства: да/нет по сделке, «ладно», «идёт», «давай», «конечно» — начало звучит до решения движка.
// «…, да?» — переспрос, а не согласие.
const COMMIT = /(?<![\p{L}-])(да(?!\s*[?!]*\?)|нет|неа|ладно|хорошо|идёт|идет|давай|давайте|договорились|по рукам|согласен|согласна|согласны|конечно|ок|окей|норм|нормально|го|лады|годится|принято|ни за что|не пойдёт|не пойдет|не выйдет|не годится|не получится|не могу|не можем|нельзя|невозможно|исключено|отказ\p{L}*|беру|берём|can['’]?t|cannot|won['’]?t|impossible|yes|yeah|yep|no|nope|deal|okay|ok|fine|sure|agreed|of course|absolutely|certainly|never|no way)(?![\p{L}-])/iu
const ASSISTANT = /(отличный вопрос|хороший вопрос|понимаю|great question|good question|i understand|i hear you|i appreciate)/iu
// оценка его слов: заход звучит до решения движка, а выгодно ли это собеседнику, решает движок. «Вот это разговор!» на
// требование игрока в его пользу — радость невыгодному; «издеваешься?» на уступку игрока — наоборот.
const EVAL = /(?<![\p{L}-])(отличн\p{L}*|прекрасн\p{L}*|замечательн\p{L}*|чудесн\p{L}*|супер|класс\p{L}*|кайф|красот\p{L}*|красав\p{L}*|молод(?:ец|цы)|спасибо|благодар\p{L}*|рад|рада|приятно|нравит\p{L}*|по душе|вот это|другое дело|уже лучше|уже кое-что|уже разговор|наконец-то|без проблем|интересн\p{L}* (?:предложени\p{L}*|вариант\p{L}*|иде\p{L}*)|(?:предложени\p{L}*|вариант\p{L}*|иде\p{L}*) интересн\p{L}*|разумно|справедливо|щедро|уважаю|обидно|жаль|ужас\p{L}*|кошмар|бред|наглост\p{L}*|грабёж|грабеж|издева\p{L}*|смешно|glad|thanks?|great|nice|perfect|excellent|wonderful|lovely|love|happy|fair|generous|reasonable|interesting (?:proposal|offer|idea)|now we['’]?re talking|that['’]?s better|finally|no problem|terrible|awful|ridiculous|insult\p{L}*|robbery|crazy|joking|kidding)(?![\p{L}-])/iu

/**
 * Отклик годится, если он короткий и в нём нет обязательств; цифры — только те, что сказал сам игрок («Сорок восемь
 * часов?..» — переспрос). Иначе undefined: реплика начнётся как раньше, с первой фразы Sonnet.
 */
export function checkOpener(raw: string, playerText = ''): string | undefined {
  let t = stripTags(raw).replace(/[«»"“”„()[\]*_]/g, '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim()
  if (!/\p{L}/u.test(t)) return undefined
  const words = t.split(' ').filter((w) => /\p{L}/u.test(w))
  if (words.length < 1 || words.length > 8) return undefined
  if (COMMIT.test(t) || ASSISTANT.test(t) || EVAL.test(t)) return undefined
  const his = quantities(playerText).map((q) => `${q.dim}:${q.value}`)
  if (quantities(t).some((q) => !his.includes(`${q.dim}:${q.value}`))) return undefined
  if (/\d/.test(t) && !quantities(t).length) return undefined
  if (!/[.!?…]$/u.test(t)) t = `${t.replace(/[,;:—–-]+$/u, '')}…`
  return t
}

const OPENER_VERSION = 'o8'

/**
 * Отклик быстрой моделью (до двух попыток в отведённое время); не вышло или не прошёл проверку — undefined. Удачный
 * отклик — в кэше: повтор хода даёт тот же заход, а значит, и ту же реплику из кэша реплик.
 */
export async function writeOpener(m: LLM, sc: Scenario, history: TurnRecord[], playerText: string, state: OpponentState, rude: boolean, timeoutMs: number): Promise<string | undefined> {
  const { system, user } = openerPrompt(sc, history, playerText, state, rude)
  const until = Date.now() + timeoutMs
  const key = { v: OPENER_VERSION, m: m.model, system, user }
  const hit = await peek<{ say: string }>('opener', key)
  if (hit) return hit.say
  for (const temperature of [0.7, 0.9]) {
    const left = until - Date.now()
    if (left < 150) break
    const r = (await m.json({ system, user, temperature, maxTokens: 40, timeoutMs: left, schema: SCHEMA }).catch(() => undefined)) as { say?: unknown } | undefined
    const say = typeof r?.say === 'string' ? checkOpener(r.say, playerText) : undefined
    if (say) {
      await put('opener', key, { say })
      return say
    }
  }
  return undefined
}

/**
 * Запасной заход, когда быстрая модель не успела или её отклик не прошёл проверку: короткое «думаю» без обязательств.
 * Без него ход ждал первых слов Sonnet (2,5–3,5 с тишины, живой прогон china 18.10). Звук таких заходов быстро оседает
 * в кэше голоса лица. Не повторяем начало прошлой реплики собеседника.
 */
const SPARE = { ru: ['Так…', 'Хм…', 'Секунду…', 'Так-так…'], en: ['Well…', 'Hmm…', 'Let me see…', 'Right…'] }
export function spareOpener(sc: Scenario, history: TurnRecord[]): string {
  const all = SPARE[isEn(sc) ? 'en' : 'ru']
  const last = (history.at(-1)?.opponentLine ?? '').toLowerCase()
  const fresh = all.filter((x) => !last.startsWith(x.replace('…', '').toLowerCase()))
  return fresh[history.length % fresh.length]
}

