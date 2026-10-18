// Какие комнаты бывают: две переговорные из room.ts и места кампании «Новенький» — каждое в своём файле.
// Пока у места нет своей комнаты, встреча идёт в ближайшей по духу переговорной.

import { buildRoom, type RoomBuild, type RoomKind } from '../room'
import { EXITS, type ExitPlan } from '../exit'

/** Места кампании: комната в общаге, остановка у ларька, магазин у дома, бытовка цеха, кабинет закупок «Инея»,
 * переговорная «Кама» с экраном видеосвязи (звонок поставщику из Иу); офис продаж в Стамбуле — у английского дела, не главы кампании (sceneFor). */
export const STORY_KINDS = ['dorm', 'street', 'shop', 'bytovka', 'inei', 'istanbul', 'meet'] as const
export type StoryKind = (typeof STORY_KINDS)[number]
export type WorldKind = RoomKind | StoryKind

type Builder = () => RoomBuild
/** Комната места — файл rooms/<место>.ts с `export const ROOM = { kind: 'shop', build: buildShop }`. Находятся сами. */
export interface StoryRoom {
  kind: StoryKind
  build: Builder
}
const found = import.meta.glob<{ ROOM?: StoryRoom }>(['./*.ts', '!./index.ts', '!./*.gen.ts', '!./*.test.ts'], { eager: true })
const BUILDERS: Partial<Record<StoryKind, Builder>> = {}
for (const m of Object.values(found)) if (m.ROOM) BUILDERS[m.ROOM.kind] = m.ROOM.build

/** Запасная переговорная для места, у которого ещё нет своей комнаты. */
const FALLBACK: Record<StoryKind, RoomKind> = { dorm: 'office', street: 'office', shop: 'office', bytovka: 'factory', inei: 'office', istanbul: 'office', meet: 'office' }

export const isStoryKind = (k: string): k is StoryKind => (STORY_KINDS as readonly string[]).includes(k)

/** Комната и путь, которым из неё уходит собеседник (у запасной переговорной — её путь). */
export function buildAnyRoom(kind: WorldKind): RoomBuild & { exit: ExitPlan } {
  if (!isStoryKind(kind)) return { ...buildRoom(kind), exit: EXITS[kind] }
  const b = BUILDERS[kind]
  return b ? { ...b(), exit: EXITS[kind] } : { ...buildRoom(FALLBACK[kind]), exit: EXITS[FALLBACK[kind]] }
}
