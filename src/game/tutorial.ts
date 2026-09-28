// Первая встреча — обучающая: интерфейс открывается по шагам, у каждого шага одна фраза наставника и подсветка.
// Шаг выводим из того, что уже случилось во встрече (ходы, предложение, «что чувствует») и где игрок нажал «Понятно».
// Чистые функции: одинаково работают в 3D и классическом виде и проверяются тестами. Принципы — docs/ux-onboarding.md.

import { useEffect, useState } from 'react'
import type { Scenario, TurnRecord } from '../engine/types'
import { chapterOf } from '../content/story'
import { firstName, g } from './cast'
import { markTutorialDone } from './progress'

export type TutorStep = 'talk' | 'notebook' | 'offer' | 'slip' | 'feel' | 'leave' | 'done'
const ORDER: TutorStep[] = ['talk', 'notebook', 'offer', 'slip', 'feel', 'leave', 'done']

/** Части встречи, которые открываются по ходу обучения. Остальное (собеседник, поле ответа, меню) видно сразу. */
export type Part = 'desk' | 'notebook' | 'offer' | 'slip' | 'card' | 'feel' | 'leave' | 'extras'

const OPENS: Record<Part, TutorStep> = {
  desk: 'notebook', // часы и кнопка «Стол»
  notebook: 'notebook',
  offer: 'offer',
  slip: 'slip',
  card: 'feel',
  feel: 'feel',
  leave: 'leave',
  extras: 'done', // голос, подсказки, запись разговора, плашки разбора хода
}

export const shows = (step: TutorStep, part: Part) => ORDER.indexOf(step) >= ORDER.indexOf(OPENS[part])

export interface TutorFacts {
  turns: number
  /** игрок хоть раз что-то предложил — блокнотом или словами */
  offered: boolean
  /** крутил стрелки в блокноте */
  picked: boolean
  /** открывал «что чувствует» */
  felt: boolean
  ended: boolean
  /** шаги, где нажали «Понятно» */
  acked: TutorStep[]
}

/** На каком шаге обучения игрок. Действие засчитывает шаг так же, как «Понятно». */
export function tutorStep(f: TutorFacts): TutorStep {
  const ok = (s: TutorStep) => f.acked.includes(s)
  if (f.ended) return 'done'
  if (f.turns === 0) return 'talk'
  if (!ok('notebook') && !f.picked && !f.offered) return 'notebook'
  // не хочет предлагать — не держим: через пару ходов идём дальше
  if (!f.offered && !ok('offer') && f.turns < 4) return 'offer'
  if (!ok('slip')) return 'slip'
  if (!ok('feel') && !f.felt) return 'feel'
  if (!ok('leave')) return 'leave'
  return 'done'
}

/**
 * Обучение показываем людям. Прогоны из scripts/ (Playwright, navigator.webdriver) идут без него, чтобы не спотыкаться
 * о спрятанные кнопки; проверить само обучение в прогоне — ?tutorial=1 в адресе.
 */
export const tutorialAllowed = () => typeof navigator === 'undefined' || !navigator.webdriver || forced
// адрес читаем при загрузке: дальше его чистят ссылки на дело
const forced = /[?&]tutorial=1\b/.test(globalThis.location?.search ?? '')

export const offered = (h: TurnRecord[]) => h.some((x) => !!x.analysis.offer && Object.keys(x.analysis.offer).length > 0)

export interface MentorLine {
  text: string
  /** что подсветить */
  target?: Part | 'look' | 'hold'
  /** можно идти дальше кнопкой «Понятно» */
  ack?: boolean
  /** фраза, которую можно вставить в поле ответа */
  example?: string
}

export interface MentorCtx {
  sc: Scenario
  /** смотрим на собеседника или на стол */
  pose: 'face' | 'desk'
  /** телефон: листы берут в руки */
  phone: boolean
  /** какой лист в руках (телефон) */
  held: string | null
  /** на листке условия собеседника, а не наши */
  theirs: boolean
  batna: number
}

/** Что говорит наставник на шаге. Одна-две короткие фразы, на «ты»: он свой. */
export function mentorLine(step: TutorStep, c: MentorCtx): MentorLine | null {
  const n = firstName(c.sc)
  const him = g(c.sc, 'ему', 'ей')
  const his = g(c.sc, 'него', 'неё')
  // нужная бумага лежит на столе, а мы смотрим на собеседника или (телефон) ещё не взяли лист в руки
  const reach = (paper: 'notebook' | 'slip' | 'card', what: string): MentorLine | null => {
    if (c.pose === 'face') return { text: `${what} Опусти взгляд на стол: кнопка «Стол» внизу${c.phone ? '' : ' или стрелка ↓'}.`, target: 'look' }
    if (c.phone && c.held && c.held !== paper) return { text: `${what} Положи лист — кнопка «На стол» внизу.`, target: 'look' }
    if (c.phone && c.held !== paper) return { text: `${what} Нажми на ${PAPER_RU[paper]}, чтобы взять в руки.`, target: 'hold' }
    return null
  }
  switch (step) {
    case 'talk':
      return {
        text: `Напротив — ${n}. Просто ответь ${him}, как в жизни. Для начала спроси, что для ${his} главное.`,
        // в бытовых главах кампании на «ты», в деловых делах — на «вы»
        example:
          chapterOf(c.sc.id)?.kind === 'life'
            ? 'Привет! Давай сначала разберёмся: что для тебя тут самое важное и почему?'
            : 'Здравствуйте! Прежде чем обсуждать детали, расскажите: что для вас в этом главное и почему?',
      }
    case 'notebook':
      return (
        reach('notebook', 'Разговор пошёл! Теперь загляни в блокнот.') ?? {
          text: 'Это твой блокнот — условия договора. Число справа — насколько тебе выгоден вариант. Покрути стрелки.',
          target: 'notebook',
          ack: true,
        }
      )
    case 'offer':
      return (
        reach('notebook', 'Пора предложить свои условия.') ?? {
          text: `Выбери стрелками, чего хочешь, и нажми «Предложить». Без сделки у тебя будет выгода ${c.batna}, так что меньше не бери.`,
          target: 'offer',
        }
      )
    case 'slip':
      return (
        reach('slip', c.theirs ? `${n} ${g(c.sc, 'ответил', 'ответила')} своими условиями.` : 'Твоё предложение лежит на столе.') ?? {
          text: c.theirs
            ? `На листке — что предлагает ${n}. Внизу — сколько это даёт тебе. Устраивает — жми «Согласиться», нет — торгуйся дальше.`
            : `Когда ${n} ответит своими условиями, они появятся на этом листке, а с ними кнопка «Согласиться».`,
          target: 'slip',
          ack: true,
        }
      )
    case 'feel':
      return (
        reach('card', `Хочешь знать, что ${n} сейчас чувствует?`) ?? {
          text: `Нажми «Что чувствует» на карточке. В жизни так нельзя, а здесь можно подсмотреть, как на ${his} действуют твои слова.`,
          target: 'feel',
          ack: true,
        }
      )
    case 'leave':
      return {
        // кнопку не подсвечиваем: новичок жмёт то, что мигает, а уходить со встречи ему незачем
        text: 'Последнее: если условия хуже, чем без сделки, можно встать и уйти — кнопка на той же карточке. Дальше сам, удачи!',
        ack: true,
      }
    case 'done':
      return null
  }
}

const PAPER_RU = { notebook: 'блокнот', slip: 'листок посередине', card: 'карточку «Под рукой»' }

// что отмечено в этой встрече: переживает переход из 3D в классический вид (слабое устройство) посреди обучения
const memo: { acked: TutorStep[]; picked: boolean } = { acked: [], picked: false }

/** Шаг обучения во встрече: что показывать, что подсвечивать, «Понятно» и «Я уже умею». */
export function useTutorial(on: boolean, onOff: () => void, m: { history: TurnRecord[]; done: boolean; xrayUsed: boolean }) {
  // новая встреча начинается с чистого листа, продолжение той же — с того, что уже прошли
  const [acked, setAcked] = useState<TutorStep[]>(() => (m.history.length ? memo.acked : []))
  const [picked, setPicked] = useState(() => (m.history.length ? memo.picked : false))
  useEffect(() => {
    memo.acked = acked
    memo.picked = picked
  }, [acked, picked])
  const step: TutorStep = on
    ? tutorStep({ turns: m.history.length, offered: offered(m.history), picked, felt: m.xrayUsed, ended: m.done, acked })
    : 'done'
  // прошли всё до конца — обучение больше не показываем; встреча кончилась раньше — отметит разбор
  const finished = on && step === 'done' && !m.done
  useEffect(() => {
    if (finished) markTutorialDone()
  }, [finished])
  return {
    on: on && step !== 'done',
    step,
    shows: (p: Part) => shows(step, p),
    ack: () => setAcked((a) => [...a, step]),
    picked: () => setPicked(true),
    skip: () => {
      markTutorialDone()
      onOff()
    },
  }
}

export type Tutorial = ReturnType<typeof useTutorial>
