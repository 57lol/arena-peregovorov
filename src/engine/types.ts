// Общий контракт между движком, сервером и интерфейсом.
// Движок детерминирован: одинаковый сценарий + одинаковые разобранные ходы = одинаковый результат.

export type IssueId = string

export interface Issue {
  id: IssueId
  title: string            // «Отсрочка платежа»
  options: string[]        // ["0 дней", "30 дней", "60 дней", "90 дней"]
  // Тип пункта известен только движку и разбору, игроку не показывается:
  // distributive — интересы противоположны, integrative — важность разная (можно разменять),
  // compatible — обе стороны хотят одного и того же (ловушка «несовместимости»).
  kind: 'distributive' | 'integrative' | 'compatible'
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
}

// Ключи совпадают с видами решений движка и причинами hold; {offer} — подставить предложение.
export type LineKey = Decision['kind'] | 'final' | HoldReason
export type CharacterLines = Partial<Record<LineKey, string[]>>

export interface Scenario {
  id: string
  title: string
  sphere: string           // закупки, найм, аренда, подряд...
  difficulty: Difficulty
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
  behaviors: BehaviorHit[]
  offer?: Offer            // что игрок предложил в этой реплике
  accepts?: boolean        // игрок принимает то, что лежит на столе
  walksAway?: boolean
  asksAbout?: IssueId[]
  toneViolation?: boolean  // нарушение делового тона
}

export interface OpponentState {
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
  | { kind: 'reveal'; interestId: string; offer?: Offer }
  | { kind: 'hold'; reason?: HoldReason }
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
