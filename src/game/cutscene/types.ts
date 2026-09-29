// Катсцена — список планов (shot). План — одна сцена с камерой, людьми, субтитрами и, может быть, телефоном в руках.
// Всё задано временем от начала плана в секундах, поэтому кадр — чистая функция времени: перемотка, пропуск
// и снимки для проверок работают без состояния.

import type { PortraitId } from '../ui/assets'

/** Время суток: движок перекрашивает дневные слои в ближайшие цвета Apollo (см. mood.ts). */
export type Mood = 'day' | 'dusk' | 'morning' | 'night'

/**
 * Сцены: трасса вдоль Камы, салон автобуса, телефон в руках, улица к общаге, ОЭЗ, карта недели, чёрный экран.
 * Слои каждой — в sets.ts.
 */
export type SetId = 'road' | 'bus' | 'phone' | 'street' | 'oez' | 'map' | 'black'

/** Ключ анимации: [секунда от начала плана, значение]. Между ключами — плавно (smoothstep). */
export type Key = readonly [number, number]
export type Track = number | readonly Key[]

/** Кто ходит по кадру. newbie — налегке, case — с чемоданом, box — с коробкой, timur — сосед, bus — автобус. */
export type ActorId = 'newbie' | 'case' | 'box' | 'timur' | 'bus'

export interface Actor {
  who: ActorId
  /** x якоря (ноги по центру) в точках сцены */
  x: Track
  /** y ног; нет — земля сцены */
  y?: number
  /** куда смотрит, когда стоит; идёт — смотрит куда идёт */
  face?: 'left' | 'right'
  /** поза, когда стоит: обычная, телефон у уха, смотрит в телефон, поднял кружку */
  pose?: 'stand' | 'ear' | 'look' | 'cheers'
}

/** Одна строка субтитров. Держится до следующей строки или конца плана. */
export interface Line {
  at: number
  text: string
  /** кто говорит — подпись перед репликой; нет — голос рассказчика */
  who?: string
}

/**
 * Экран телефона: памятка (одна мысль — заголовок и строка) или сообщение в мессенджере.
 * Держится до следующей карточки.
 */
export type PhoneCard =
  | { at: number; kind: 'memo'; title: string; text: string; n?: string }
  | { at: number; kind: 'chat'; from: string; face: PortraitId; text: string }

/**
 * Телефон, который игрок листает сам: сначала приветствие в чате, потом приёмы по одному на экран.
 * Пока он не дочитал (или не нажал «Пропустить»), катсцена стоит на этом плане.
 */
export interface Guide {
  /** кто пишет — имя в шапке чата */
  from: string
  /** кто это — строка под именем */
  role: string
  face: PortraitId
  /** первый экран: два-три коротких сообщения — кто пишет и зачем */
  hello: string[]
  /** надпись на кнопке первого экрана */
  open: string
  tips: { title: string; text: string; /** где пригодится на неделе */ when: string }[]
  /** надпись на кнопке последнего приёма */
  done: string
}

/** Титр главы: чёрный экран, день и место. */
export interface Card {
  kicker: string
  title: string
  sub?: string
  /** кто ждёт в главе — лицо на титре */
  face?: PortraitId
}

export interface Shot {
  set: SetId
  dur: number
  mood?: Mood
  /** центр камеры по x; нет — камера идёт за первым человеком */
  cam?: Track
  /** скорость автобуса, точек в секунду: трасса и вид из окна едут мимо */
  drive?: number
  actors?: Actor[]
  lines?: Line[]
  phone?: PhoneCard[]
  /** салон автобуса: новенький в кресле смотрит в телефон, в окно или дремлет */
  sit?: 'look' | 'window' | 'doze'
  /** телефон в руках на фоне этой сцены (по умолчанию — салон автобуса) */
  behind?: 'bus' | 'street' | 'oez'
  /** карта недели: маршрут от главы к главе */
  route?: { from: string; to: string }
  card?: Card
  /** телефон в руках листает игрок; только на плане с set: 'phone', катсцена ждёт на секунде GUIDE_AT (timeline.ts) */
  guide?: Guide
  /** плавный вход из чёрного, секунды (по умолчанию 0.35, у первого плана 0.6) */
  fadeIn?: number
}

export interface Cutscene {
  id: string
  /** подпись в списке катсцен у жюри */
  title: string
  shots: Shot[]
}
