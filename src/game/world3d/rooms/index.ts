// Какие комнаты бывают: две переговорные из room.ts и места кампании «Новенький» — каждое в своём файле.
// Пока у места нет своей комнаты, встреча идёт в ближайшей по духу переговорной.

import { buildRoom, type RoomBuild, type RoomKind } from '../room'

/** Места кампании: комната в общаге, остановка у ларька, магазин у дома, бытовка цеха. */
export const STORY_KINDS = ['dorm', 'street', 'shop', 'bytovka'] as const
export type StoryKind = (typeof STORY_KINDS)[number]
export type WorldKind = RoomKind | StoryKind

type Builder = () => RoomBuild
/** Сюда регистрируются комнаты кампании: `rooms/dorm.ts` → BUILDERS.dorm и т. д. */
const BUILDERS: Partial<Record<StoryKind, Builder>> = {}

/** Запасная переговорная для места, у которого ещё нет своей комнаты. */
const FALLBACK: Record<StoryKind, RoomKind> = { dorm: 'office', street: 'office', shop: 'office', bytovka: 'factory' }

export const isStoryKind = (k: string): k is StoryKind => (STORY_KINDS as readonly string[]).includes(k)

export function hasRoom(k: WorldKind): boolean {
  return !isStoryKind(k) || !!BUILDERS[k]
}

export function buildAnyRoom(kind: WorldKind): RoomBuild {
  if (!isStoryKind(kind)) return buildRoom(kind)
  const b = BUILDERS[kind]
  return b ? b() : buildRoom(FALLBACK[kind])
}
