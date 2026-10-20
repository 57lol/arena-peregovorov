// Настройки руководителя → параметры встречи. Одна таблица на всё: что меняют сложность, тон собеседника и
// навыки из «Что хотите потренировать». Генератор кладёт результат в дело (Scenario.tuning, Scenario.focus),
// движок читает его в policy.ts и turn.ts. У дел из папки и старых сохранённых дел tuning нет — там всё как было.

import type { BehaviorId } from './behaviors'
import { TECHNIQUES } from './books'
import type { Difficulty, Scenario, Tone } from './types'
import { maxScore } from './utility'

export interface MeetingTuning {
  /** запасной вариант собеседника — доля его максимума: чем выше, тем уже зона торга */
  oppBatna: number
  /** запасной вариант игрока — доля его максимума */
  playerBatna: number
  /** скорость уступок: показатель кривой (больше 1 — уступает рано, меньше 1 — держится до конца) */
  concession: number
  /** какую часть запаса над своим запасным вариантом собеседник не отдаёт даже в конце */
  reserve: number
  /** доверие и напряжение на входе */
  trust: number
  tension: number
  /** чувствительность: множитель к росту доверия и к росту напряжения от ходов игрока */
  trustGain: number
  tensionGain: number
  /** сдвиг порога, после которого собеседник рассказывает о скрытых интересах */
  revealShift: number
  /** сколько ходов длится встреча */
  turnLimit: number
  /** при каком напряжении собеседник встаёт и уходит */
  walkAt: number
}

// Сложность — «рынок»: зона торга, упрямство, длина встречи. Цифры те же, что были у дел без настроек.
const BY_DIFFICULTY: Record<Difficulty, Pick<MeetingTuning, 'oppBatna' | 'concession' | 'reserve' | 'revealShift' | 'turnLimit'>> = {
  1: { oppBatna: 0.25, concession: 2.2, reserve: 0, revealShift: -5, turnLimit: 11 },
  2: { oppBatna: 0.32, concession: 1.0, reserve: 0.12, revealShift: 0, turnLimit: 12 },
  3: { oppBatna: 0.4, concession: 0.35, reserve: 0.25, revealShift: 5, turnLimit: 13 },
}

// Тон — «человек»: с чего начинает, как откликается на ходы, как быстро открывается и когда уходит.
const BY_TONE: Record<Tone, { concession: number; reserve: number; oppBatna: number; trust: number; tension: number; trustGain: number; tensionGain: number; revealShift: number; turns: number; walkAt: number }> = {
  friendly: { concession: 1.3, reserve: -0.04, oppBatna: 0, trust: 55, tension: 10, trustGain: 1.3, tensionGain: 0.7, revealShift: -10, turns: 0, walkAt: 95 },
  neutral: { concession: 1, reserve: 0, oppBatna: 0, trust: 45, tension: 20, trustGain: 1, tensionGain: 1, revealShift: 0, turns: 0, walkAt: 90 },
  cold: { concession: 0.8, reserve: 0.03, oppBatna: 0.02, trust: 35, tension: 25, trustGain: 0.7, tensionGain: 1, revealShift: 10, turns: 0, walkAt: 90 },
  aggressive: { concession: 0.7, reserve: 0.05, oppBatna: 0.03, trust: 30, tension: 35, trustGain: 0.9, tensionGain: 1.4, revealShift: 5, turns: 0, walkAt: 82 },
  evasive: { concession: 1, reserve: 0, oppBatna: 0, trust: 40, tension: 20, trustGain: 0.8, tensionGain: 0.9, revealShift: 15, turns: 1, walkAt: 90 },
}

/** Навык, который руководитель хочет потренировать, и ситуация в деле, где он окупается. */
export type Skill = 'interests' | 'package' | 'shared' | 'anchor' | 'batna' | 'deadline' | 'pressure'

export const SKILLS: Record<Skill, {
  /** как узнать навык в свободном тексте */
  re: RegExp
  /** приёмы из пяти книг, которые разбор проверит после встречи */
  focus: BehaviorId[]
  /** что дописать в задание генератору */
  prompt: string
  /** строка для разбора: чему учит дело */
  lesson: string
}> = {
  interests: {
    re: /интерес|почему|вопрос|выясн|потребност|слуша|скрыт|мотив|спин/iu,
    focus: ['ask_interest', 'calibrated', 'label'],
    prompt: 'Тренируют вопросы об интересах: дай оппоненту скрытый интерес, который сильно меняет картину, но он скажет о нём только тому, кто спросит «почему» или «что для вас важно».',
    lesson: 'Спросить, зачем собеседнику его условие: за ответом — размен',
  },
  package: {
    re: /разм[еэ]н|пакет|обмен|меня(ть|ться|ем)|уступ|торг|несколько пункт|если.*то/iu,
    focus: ['package', 'meso', 'priority'],
    prompt: 'Тренируют размен: пункт mine должен быть очень дорог игроку и дёшев оппоненту, theirs — наоборот, чтобы обмен «если вы…, то мы…» давал обоим заметно больше.',
    lesson: 'Меняться пунктами: отдать дешёвое себе за дорогое себе',
  },
  shared: {
    re: /общ(ий|ая|ее|ие|его|ую|их|ей|ем)(?!\p{L})|совмест|оба |обе сторон|выигрыш|win|партн[её]р/iu,
    focus: ['joint_frame', 'ask_interest', 'check'],
    prompt: 'Тренируют поиск общего: сделай shared заметным и правдоподобным — оба хотят одного, но игрок уверен в обратном и может уступить его зря.',
    lesson: 'Найти пункт, где хотите одного и того же, и не платить за него',
  },
  anchor: {
    re: /якор|перв\p{L}* (цифр|предлож|цен)|(^|[^\p{L}])цен[аыуеой]|ставк|бюджет|деньг|скидк/iu,
    focus: ['anchor', 'criteria', 'split'],
    prompt: 'Тренируют первую цифру: у делимого пункта (split) дай 5 вариантов с широким разбросом, а в opening оппонент называет крайний — игроку есть что сдвинуть точной обоснованной цифрой.',
    lesson: 'Назвать точную обоснованную цифру первым и не делить пополам',
  },
  batna: {
    re: /альтернатив|запасн|наос|batna|уйти|отказ|без сделки/iu,
    focus: ['alternative', 'criteria', 'golden_bridge'],
    prompt: 'Тренируют запасной вариант: у игрока есть конкретная сильная альтернатива (назови её в playerBatnaText с цифрой), и о ней можно спокойно сказать.',
    lesson: 'Знать свой запасной вариант и спокойно на него опираться',
  },
  deadline: {
    re: /срок|дедлайн|время|спеш|быстр|успеть/iu,
    focus: ['signpost', 'summarize', 'deadline'],
    prompt: 'Тренируют работу со временем: у оппонента есть свой срок (решить до конца недели), это один из его скрытых интересов; встреча короткая.',
    lesson: 'Держать время: сверять итог и не сдаваться под «надо сегодня»',
  },
  pressure: {
    re: /давлен|агресс|трудн|жёстк|жестк|манипул|эмоци|конфликт|грубо|ультиматум/iu,
    focus: ['balcony', 'i_message', 'golden_bridge'],
    prompt: 'Тренируют разговор под давлением: в opening оппонент сразу давит — сроком, конкурентом или ультиматумом, но за давлением есть понятная причина.',
    lesson: 'Не отвечать ударом на удар: пауза, я-сообщение, золотой мост',
  },
}
const SKILL_ORDER = Object.keys(SKILLS) as Skill[]

/** Навыки из «Что хотите потренировать» — до трёх, в порядке таблицы. */
export function skillsOf(goals: string | undefined): Skill[] {
  const text = goals?.trim() ?? ''
  return text ? SKILL_ORDER.filter((s) => SKILLS[s].re.test(text)).slice(0, 3) : []
}

/**
 * Главная таблица: сложность × тон × навыки → параметры встречи.
 * Сложность задаёт рынок, тон — характер, навыки — ситуацию, где приём окупается
 * (запасной вариант сильнее, встреча короче, давление на входе, интересы открываются вопросом).
 */
export function meetingTuning(difficulty: Difficulty, tone: Tone, skills: Skill[] = []): MeetingTuning {
  const d = BY_DIFFICULTY[difficulty]
  const t = BY_TONE[tone] ?? BY_TONE.neutral
  const has = (s: Skill) => skills.includes(s)
  const r2 = (x: number) => Math.round(x * 100) / 100
  return {
    oppBatna: r2(d.oppBatna + t.oppBatna - (has('anchor') ? 0.05 : 0)),
    playerBatna: has('batna') ? 0.36 : 0.28,
    concession: r2(d.concession * t.concession),
    reserve: r2(Math.max(0, d.reserve + t.reserve)),
    trust: t.trust,
    tension: t.tension + (has('pressure') ? 10 : 0),
    trustGain: t.trustGain,
    tensionGain: t.tensionGain,
    revealShift: d.revealShift + t.revealShift - (has('interests') ? 10 : 0),
    turnLimit: d.turnLimit + t.turns - (has('deadline') ? 2 : 0),
    walkAt: t.walkAt,
  }
}

/** Приёмы, которые разбор проверит под цели руководителя. */
export function focusOf(skills: Skill[]): BehaviorId[] {
  return [...new Set(skills.flatMap((s) => SKILLS[s].focus))].slice(0, 5)
}

/** Кривая уступок дела: из настроек, а в режиме «жёстче» — на ступень упрямее. Нет настроек — undefined. */
export function tunedCurve(sc: Scenario): { e: number; reserve: number } | undefined {
  const t = sc.tuning
  if (!t) return undefined
  const harder = sc.harder ?? 0
  return { e: t.concession * (harder ? 0.7 : 1), reserve: Math.min(0.4, t.reserve + 0.07 * harder) }
}

const TONE_WORD: Record<Tone, string> = {
  friendly: 'дружелюбный', neutral: 'нейтральный', cold: 'холодный', aggressive: 'напористый', evasive: 'уклончивый',
}

/**
 * Сводка для руководителя: как его настройки отразились в деле. Несколько коротких строк, по цифрам из самого дела,
 * а не из запроса: если дело подобрано из папки, сводка честно описывает его.
 */
export function settingsEffect(sc: Scenario): string[] {
  const O = sc.opponent.profile, P = sc.player.profile
  const oMax = maxScore(O, sc.issues), pMax = maxScore(P, sc.issues)
  const t = sc.tuning
  const lines: string[] = []
  const zone = Math.round(100 * (1 - O.batna / Math.max(1, oMax)))
  lines.push(`Зона торга: собеседник может уступить до ${zone}% своего максимума — ${zone >= 72 ? 'широкая' : zone >= 64 ? 'средняя' : 'узкая'}.`)
  const tone = sc.opponent.character.tone
  const e = t?.concession
  const speed = e === undefined
    ? (sc.difficulty === 1 ? 'уступает охотно' : sc.difficulty === 2 ? 'уступает ровно' : 'держится до конца')
    : e >= 1.5 ? 'уступает рано и охотно' : e >= 0.8 ? 'уступает ровно, шаг за шагом' : e >= 0.4 ? 'уступает медленно' : 'почти не двигается до последних ходов'
  lines.push(`Собеседник ${TONE_WORD[tone] ?? tone}: ${speed}${t ? `, доверие на входе ${t.trust} из 100` : ''}.`)
  if (t) {
    const reacts = t.tensionGain > 1.1 ? 'на резкость взрывается быстро' : t.tensionGain < 0.9 ? 'резкость переносит спокойно' : 'на резкость реагирует обычно'
    const opens = t.revealShift >= 10 ? 'о своих причинах молчит дольше обычного' : t.revealShift <= -10 ? 'о своих причинах рассказывает охотно' : 'о причинах расскажет, если спросить'
    lines.push(`${cap(reacts)}, ${opens}.`)
  }
  const hidden = O.interests.filter((i) => i.issue && sc.issues.find((x) => x.id === i.issue)?.kind === 'integrative').length
  const shared = sc.issues.filter((i) => i.kind === 'compatible').length
  lines.push(`${hidden ? `Скрытых интересов, которые окупает вопрос «почему», — ${hidden}` : 'Скрытых интересов по спорным пунктам нет'}; ${shared ? `общий пункт есть (${shared})` : 'общего пункта нет'}.`)
  lines.push(`Ходов на встречу — ${sc.turnLimit}; запасной вариант у вас — ${Math.round((100 * P.batna) / Math.max(1, pMax))}% от максимума.`)
  for (const id of sc.focus ?? []) {
    const tech = TECHNIQUES[id as BehaviorId]
    const ref = tech?.refs[0]
    if (ref) lines.push(`Окупается приём «${ref.name}»: ${lower(tech.idea.split(/(?<=\.)\s/u)[0])}`)
  }
  return lines.slice(0, 9)
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
