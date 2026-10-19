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

/**
 * Части встречи, которые открываются по ходу обучения. Остальное (собеседник, поле ответа, меню) видно сразу.
 * Блокнот с «Предложить» и кнопка «Стол» тоже видны с первой секунды: без них игрок не знает, о чём торгуется,
 * а обучение только подсвечивает их, когда до них доходит очередь.
 */
export type Part = 'desk' | 'notebook' | 'offer' | 'slip' | 'card' | 'feel' | 'leave' | 'extras'

const OPENS: Record<Part, TutorStep> = {
  desk: 'talk', // часы и кнопка «Стол»
  notebook: 'talk',
  offer: 'talk',
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

const offered = (h: TurnRecord[]) => h.some((x) => !!x.analysis.offer && Object.keys(x.analysis.offer).length > 0)

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
  /** отвечает голосом: подсказку говорить вслух, а не писать */
  voice?: boolean
}

/** Что говорит наставник на шаге. Одна-две короткие фразы, на «ты»: он свой. */
export function mentorLine(step: TutorStep, c: MentorCtx): MentorLine | null {
  const n = firstName(c.sc)
  const him = g(c.sc, 'ему', 'ей')
  const his = g(c.sc, 'него', 'неё')
  // нужная бумага лежит на столе, а мы смотрим на собеседника или (телефон) ещё не взяли лист в руки
  const reach = (paper: 'notebook' | 'slip' | 'card', what: string): MentorLine | null => {
    if (c.pose === 'face') return { text: `${what} Опусти взгляд на стол: кнопка «Стол» внизу${c.phone ? '' : ' или стрелка ↓'}.`, target: 'look' }
    if (c.phone && c.held && c.held !== paper) return { text: `${what} Положи листок — кнопка «На стол» внизу.`, target: 'look' }
    if (c.phone && c.held !== paper) return { text: `${what} Нажми на ${PAPER_RU[paper]}, чтобы взять в руки.`, target: 'hold' }
    return null
  }
  switch (step) {
    case 'talk':
      return {
        text: c.voice
          ? `Напротив — ${n}. Просто ответь ${him} вслух, как в жизни: когда ${n} замолчит, запись включится сама. Для начала спроси, что для ${his} главное.`
          : `Напротив — ${n}. Просто ответь ${him}, как в жизни. Для начала спроси, что для ${his} главное.`,
        // в бытовых главах кампании на «ты», в деловых делах — на «вы»
        example:
          chapterOf(c.sc.id)?.kind === 'life'
            ? 'Привет! Давай сначала разберёмся: что для тебя тут самое важное и почему?'
            : 'Здравствуйте! Прежде чем обсуждать детали, расскажите: что для вас в этом главное и почему?',
      }
    case 'notebook':
      return (
        reach('notebook', 'Разговор пошёл! Теперь загляни в блокнот.') ?? {
          text: 'Это твой блокнот с условиями договора. Число справа — насколько тебе выгоден вариант. Меняй варианты стрелками.',
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
            : `Когда ${n} ответит своими условиями, они появятся на этом листке, а с ними — кнопка «Согласиться».`,
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

// ---------- «Как играть»: короткое знакомство с экраном встречи ----------
// Пять шагов с подсветкой настоящих кнопок: перед первой встречей и по кнопке «Как играть». Пошаговый наставник
// (выше) учит действиями уже во время разговора, а знакомство за полминуты отвечает на «а что тут вообще делать».

export interface IntroStep {
  title: string
  text: string
  /** что подсветить: первый видимый элемент из списка; нет такого — карточка посередине без подсветки */
  target?: string[]
}

/** Шаги знакомства. 3D и классический вид отличаются кнопками, телефон и ноутбук — тем, как осматриваться. */
export function introSteps(c: { sc: Scenario; view: '3d' | 'classic'; phone: boolean; voice: boolean; mic: boolean }): IntroStep[] {
  const n = firstName(c.sc)
  const her = g(c.sc, 'его', 'её')
  const d3 = c.view === '3d'
  const steps: (IntroStep | false)[] = [
    {
      title: 'Переговоры',
      text: `Напротив — ${n}. Вы договариваетесь, и у каждого свои интересы. Ищи сделку, где выигрываете оба.`,
      target: d3 ? ['.w3-them'] : ['.g-stage .px-dialog', '.g-stage'],
    },
    {
      title: 'Говори или пиши',
      text: c.voice
        ? `Отвечай вслух: когда ${n} замолчит, запись включится сама. Удобнее текстом — кнопка «Написать».`
        : `Пиши ответ в поле и отправляй кнопкой со стрелкой.${c.mic ? ' Можно и вслух — кнопка «Говорить».' : ''}`,
      target: d3 ? ['.w3-tray'] : ['.g-say', '.g-say-row'],
    },
    {
      title: 'Листок и блокнот',
      text: d3
        ? `На столе два листа. На листке — условия, которые предлагает ${n}. Блокнот — твоё предложение: крути стрелки и жми «Предложить». Кнопка «Стол» — посмотреть на них.`
        : `Блокнот — твоё предложение: крути стрелки и жми «Предложить». Когда ${n} назовёт свои условия, они лягут листком рядом.`,
      target: d3 ? ['.w3-look'] : ['#g-notebook', '[aria-controls="g-notebook"]'],
    },
    d3 && {
      title: 'Осмотрись',
      text: c.phone
        ? 'Комнату можно осматривать: проведи пальцем по экрану. Стол — кнопка «Стол» внизу.'
        : 'Комнату можно осматривать: потяни мышью или жми стрелки ← →. Стрелка ↓ — взгляд на стол.',
    },
    {
      title: 'Сделка и разбор',
      text: d3
        ? `«Сделка» — согласиться на ${her} условия, предложить свои или встать и уйти. В конце — разбор: что получилось и что попробовать.`
        : `Устраивают ${her} условия — жми «Согласиться» на листке, нет — торгуйся или уйди. В конце — разбор: что получилось и что попробовать.`,
      target: d3 ? ['.w3-deal-btn'] : undefined,
    },
  ]
  return steps.filter((s): s is IntroStep => !!s)
}

const INTRO = 'peregovorka.intro.v1'
/** Знакомство уже прошли или пропустили — само больше не открывается, только по «Как играть». */
export function introSeen(): boolean {
  try {
    return localStorage.getItem(INTRO) === '1'
  } catch {
    return true // без хранилища не показываем при каждой встрече
  }
}
export function markIntroSeen() {
  try {
    localStorage.setItem(INTRO, '1')
  } catch {
    // нет хранилища — покажем ещё раз в следующий раз
  }
}
