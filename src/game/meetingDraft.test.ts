import { describe, expect, it } from 'vitest'
import { SCENARIOS } from '../content/scenarios'
import { FACES } from '../content/faces'
import { BUSINESS_SCENES, isFemale, portraitFor, sceneFor } from './cast'
import { customizeMeeting, meetingFaces } from './meetingDraft'

describe('предпросмотр встречи руководителя', () => {
  it.each(SCENARIOS)('$id: ручной выбор становится своим делом без изменения библиотеки и условий', (scenario) => {
    const before = structuredClone(scenario)
    const game = { scenario, fromLibrary: true }
    const face = meetingFaces(game)[0]
    const edited = customizeMeeting(game, { portrait: face.id, scene: 'bytovka' })
    expect(edited.fromLibrary).toBe(false)
    expect(edited.scenario.id).toMatch(/^gen-/)
    expect(edited.scenario.opponent.character.portrait).toBe(face.id)
    expect(edited.scenario.scene).toBe('bytovka')
    expect(portraitFor(edited.scenario)).toBe(face.id)
    expect(sceneFor(edited.scenario)).toBe('bytovka')
    expect(edited.scenario.issues).toEqual(scenario.issues)
    expect(edited.scenario.player).toEqual(scenario.player)
    expect(edited.scenario.opponent.profile).toEqual(scenario.opponent.profile)
    expect(edited.scenario.opponent.character.name).toBe(scenario.opponent.character.name)
    expect(edited.scenario.opponent.character.tone).toBe(scenario.opponent.character.tone)
    expect(edited.scenario.lang).toBe(scenario.lang)
    expect(scenario).toEqual(before)
  })

  it.each(SCENARIOS)('$id: лица из FACES того же пола, подбор не захардкожен', (scenario) => {
    const pool = meetingFaces({ scenario, fromLibrary: true })
    expect(pool.length).toBeGreaterThan(0)
    expect(pool).toEqual(FACES.filter((f) => f.female === isFemale(scenario)))
  })

  it.each(BUSINESS_SCENES)('место %s сохраняется вместе с выбранным лицом при новом серверном id', (scene) => {
    const first = customizeMeeting({ scenario: SCENARIOS[0], fromLibrary: true }, { portrait: 'foreman' })
    const edited = customizeMeeting(first, { scene })
    const saved = { ...edited.scenario, id: 'gen-123456abcdef' }
    expect(portraitFor(saved)).toBe('foreman')
    expect(sceneFor(saved)).toBe(scene)
    expect(edited.scenario.opponent.character.portrait).toBe('foreman')
  })

  it('смена только места закрепляет лицо и делает предпросмотр одинаковым со ссылкой команды', () => {
    const edited = customizeMeeting({ scenario: SCENARIOS[0], fromLibrary: true }, { scene: 'office' })
    const saved = { ...edited.scenario, id: 'gen-ffffffffffff' }
    expect(portraitFor(saved)).toBe(portraitFor(edited.scenario))
    expect(sceneFor(saved)).toBe(sceneFor(edited.scenario))
  })

  it('автоподбор своего дела закрепляется до сохранения с новым id', () => {
    const custom = { ...SCENARIOS[0], id: 'gen-012345abcdef' }
    const edited = customizeMeeting({ scenario: custom, fromLibrary: false }, {})
    expect(portraitFor(edited.scenario)).toBe(portraitFor(custom))
    expect(sceneFor(edited.scenario)).toBe(sceneFor(custom))
    expect(sceneFor({ ...edited.scenario, id: 'gen-ffffffffffff' })).toBe(sceneFor(custom))
  })
})
