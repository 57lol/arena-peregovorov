import type { Case } from '../App'
import { FACES, type FaceId } from '../content/faces'
import { BUSINESS_SCENES, isFemale, portraitFor, sceneFor, type BusinessScene } from './cast'

export const meetingFaces = (game: Case) => FACES.filter((face) => face.female === isFemale(game.scenario))

/** Правка библиотечного дела становится отдельной версией; общую папку не меняем. */
export function customizeMeeting(game: Case, choice: { portrait?: FaceId; scene?: BusinessScene }): Case {
  const original = game.scenario
  const scenario = { ...original, id: original.id.startsWith('gen-') ? original.id : `gen-team-${original.id}`.slice(0, 40) }
  // При сохранении сервер выдаст gen-id. Закрепляем автоподбор сейчас, чтобы после выдачи ссылки
  // лицо и место не пересчитались по новому хэшу. Старые библиотечные лица в своих делах заменяет cast.
  const place = sceneFor(original)
  const scene = choice.scene ?? ((BUSINESS_SCENES as readonly string[]).includes(place) ? place as BusinessScene : 'office')
  return {
    fromLibrary: false,
    scenario: {
      ...scenario,
      scene,
      opponent: {
        ...original.opponent,
        character: { ...original.opponent.character, portrait: choice.portrait ?? portraitFor(scenario) },
      },
    },
  }
}
