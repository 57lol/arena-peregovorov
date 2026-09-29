import { describe, expect, it } from 'vitest'
import { PROLOGUE } from '../cutscene/scripts'
import { starts } from '../cutscene/timeline'
import { defaults, loadSettings } from './engine'
import { ambFor, cutsceneCue, sceneSound } from './scene'

describe('звук: настройки', () => {
  it('без хранилища — значения по умолчанию', () => {
    expect(loadSettings()).toEqual(defaults())
  })
})

describe('звук: экраны', () => {
  it('титул — своя тема, встреча — без музыки, с фоном комнаты', () => {
    expect(sceneSound('title')).toEqual({ music: 'menu', amb: null })
    expect(sceneSound('map').music).toBe('map')
    expect(sceneSound('play', 'bytovka')).toEqual({ music: null, amb: 'factory' })
    expect(sceneSound('play', 'inei').amb).toBe('office')
  })
  it('у каждого места есть фон', () => {
    for (const k of ['office', 'factory', 'shop', 'street', 'dorm', 'bytovka', 'inei']) expect(ambFor(k)).not.toBeNull()
  })
})

describe('звук: катсцена', () => {
  const at = (shot: number) => starts(PROLOGUE)[shot]
  it('трасса — мотор автобуса', () => {
    expect(cutsceneCue(PROLOGUE, 1, 1.02).amb).toBe('bus')
  })
  it('новенький идёт — шаги; прыжок кликом — без шагов', () => {
    const walk = PROLOGUE.shots.findIndex((s) => s.set === 'street' && s.actors?.length === 1)
    let steps = 0
    for (let T = at(walk); T < at(walk) + 4; T += 1 / 60) steps += cutsceneCue(PROLOGUE, T, T + 1 / 60).steps
    expect(steps).toBeGreaterThan(4)
    expect(cutsceneCue(PROLOGUE, at(walk), at(walk) + 3).steps).toBe(0)
  })
})
