// Общий контракт между движком, сервером и интерфейсом.
// Движок детерминирован: одинаковый сценарий + одинаковые разобранные ходы = одинаковый результат.

export type IssueId = string

export interface Issue {
  id: IssueId
  title: string            // «Отсрочка платежа»
  aliases?: string[][]
  options: string[]        // ["0 дней", "30 дней", "60 дней", "90 дней"]
  // Тип пункта известен только движку и разбору, игроку не показывается:
  // distributive — интересы противоположны, integrative — важность разная (можно разменять),
  // compatible — обе стороны хотят одного и того же (ловушка «несовместимости»).
  kind: 'distributive' | 'integrative' | 'compatible'
  /** Явно названные генератором лучшие варианты сторон (индексы в options). */
  preferences?: { player: number; opponent: number }
}

export interface Interest {
  id: string
  text: string             // что сторона на самом деле хочет и почему
  issue?: IssueId
  trustToReveal: number    // сколько доверия нужно, чтобы оппонент это рассказал
}

export interface SideProfile {
  // Очки за каждый вариант каждого пункта (индекс = индекс в issue.options)
  points: Record<IssueId, number[]>
  batna: number            // очки при срыве сделки
  batnaText: string        // словами: «у меня есть другой поставщик за 1,2 млн»
  interests: Interest[]
}

export type Tone = 'friendly' | 'neutral' | 'cold' | 'aggressive' | 'evasive'
export type Difficulty = 1 | 2 | 3

export interface Character {
  name: string
  role: string             // «директор по закупкам»
  company: string
  tone: Tone
  portrait: string         // id набора спрайтов
  speech: string           // манера речи для LLM
  bio: string
  lines?: CharacterLines   // свои реплики для офлайн-режима (если нет — берутся общие по тону)
  /** как он звучит: 3–5 коротких живых реплик для модели (настрой и ритм, без скрытых причин и условий сделки) */
  voiceExamples?: string[]
}

// Ключи совпадают с видами решений движка и причинами hold; {offer} — подставить предложение.
export type LineKey = Decision['kind'] | 'final' | HoldReason
export type CharacterLines = Partial<Record<LineKey, string[]>>

export interface Upsell {
  id: string
  title: string
  keywords: string[]
  cost: string
  penalty: number
  pitch: string
  accepted: string
  refused: string
}
export interface UpsellChoice { id: string; choice: 'accepted' | 'refused'; polite?: boolean }

export interface Scenario {
  upsells?: Upsell[]
  id: string
  /** язык разговора: 'en' — дело на английском (реплики, бриф, голос); интерфейс и разбор остаются русскими */
  lang?: 'ru' | 'en'
  title: string
  sphere: string           // закупки, найм, аренда, подряд...
  difficulty: Difficulty
  /** «Сыграть жёстче»: та же история, но собеседник на ступень упрямее (см. tierOf в policy.ts). */
  harder?: 0 | 1
  turnLimit: number
  issues: Issue[]
  player: { role: string; brief: string; profile: SideProfile }
  opponent: { character: Character; brief: string; profile: SideProfile }
  opening: string          // первая реплика оппонента
  blurb?: string           // одна строка для карточки выбора сценария
  goals?: string[]         // чему учит сценарий — навыки без ответов (бриф)
  lessons?: string[]       // то же с ответами — для разбора после встречи; нет — берём goals
}

export type Offer = Partial<Record<IssueId, number>>  // issueId -> индекс варианта

// Поведенческие индикаторы (словарь в behaviors.ts)
export interface BehaviorHit { id: string; quote: string }

export interface MoveAnalysis {
  upsells?: UpsellChoice[]
  behaviors: BehaviorHit[]
  offer?: Offer            // что игрок предложил в этой реплике
  accepts?: boolean        // игрок принимает то, что лежит на столе
  rest?: boolean           // «остальное как у вас»: недостающие пункты — с листка собеседника
  walksAway?: boolean
  asksAbout?: IssueId[]
  toneViolation?: boolean  // нарушение делового тона
  /** что в реплике есть, кроме сделки: на это собеседник отвечает по-человечески, сделка от этого не двигается */
  talk?: TalkAct[]
}

/**
 * Человеческая часть реплики: apology — извинился; joke — пошутил; personal — личное (имя, вопрос о собеседнике
 * как о человеке, сочувствие); question — вопрос по делу, но не о причинах (про продукт, факты, планы); offtopic — не по теме.
 */
export type TalkAct = 'apology' | 'joke' | 'personal' | 'question' | 'offtopic'
export const TALK_ACTS: TalkAct[] = ['apology', 'joke', 'personal', 'question', 'offtopic']

export interface OpponentState {
  upsells?: Record<string, 'accepted' | 'refused'>
  upsellChanges?: UpsellChoice[]
  trust: number            // 0..100
  tension: number          // 0..100
  revealed: string[]       // id раскрытых интересов
  tableOffer: Offer        // текущее предложение на столе
  lastOpponentOffer?: Offer
  turn: number
  status: 'open' | 'deal' | 'walked_away' | 'timeout'
  // Расширения движка (необязательные, чтобы не ломать старый код):
  playerStance?: Offer     // последняя названная игроком позиция по каждому пункту
  toneStrikes?: number     // сколько раз нарушен деловой тон
  endedBy?: 'player' | 'opponent'
  deal?: Offer             // итоговая сделка, если status === 'deal'
  lastCall?: boolean       // оппонент сделал последнее предложение, дальше только принять
}

export type Decision =
  | { kind: 'accept' }
  | { kind: 'counter'; offer: Offer; final?: boolean; feigned?: IssueId[] } // feigned: совместимые пункты, выданные за уступку
  // again: про этот пункт уже всё рассказано, собеседник напоминает сказанное, а не выдаёт постороннее;
  // general: спросили «зачем тебе всё это» в общем; offTopic: про спрошенный пункт рассказать нечего
  | { kind: 'reveal'; interestId: string; offer?: Offer; again?: true; general?: true; offTopic?: IssueId[] }
  | { kind: 'hold'; reason?: HoldReason }
  // ответить человеку: на шутку, вопрос, извинение, личное — сделка не двигается; back: потом вернуть разговор к делу
  | { kind: 'respond'; to: TalkAct[]; back?: true }
  | { kind: 'warn_tone' }
  | { kind: 'walk_away' }

export type HoldReason = 'no_offer' | 'no_movement' | 'not_ready_to_reveal' | 'player_left' | 'timeout'

// Эмоция оппонента для спрайта
export type Emotion = 'neutral' | 'pleased' | 'happy' | 'thinking' | 'annoyed' | 'angry'

export interface Delta { field: 'trust' | 'tension'; by: number; because: string }

export interface TurnRecord {
  turn: number
  playerText: string
  analysis: MoveAnalysis
  deltas: Delta[]
  decision: Decision
  opponentLine: string
  emotion: string
  stateAfter: OpponentState
}

export interface Outcome {
  status: OpponentState['status']
  playerPoints: number
  opponentPoints: number
  maxPlayerPoints: number
  paretoEfficiency: number // 0..1: насколько сделка близка к границе Парето
  relationship: number     // итоговое доверие
  behaviorCounts: Record<string, number>
}
