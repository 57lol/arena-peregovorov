import { describe, expect, it } from 'vitest'
import { wipeGame, withoutReset } from './reset'

/** Хранилище в памяти с тем же интерфейсом, что у браузера. */
function mem(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init))
  return {
    get length() {
      return m.size
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  }
}

describe('?reset', () => {
  it('стирает все ключи игры и сессию вкладки, чужое не трогает', () => {
    const local = mem({
      'peregovorka.progress.v2': '{"cases":{"dorm":{}}}',
      'peregovorka.progress.v1': '{}',
      'peregovorka.cutscenes.v1': '["prologue"]',
      'peregovorka.player.v1': '{}',
      'peregovorka.view.v1': '3d',
      'other.app': 'x',
    })
    const session = mem({ 'peregovorka.session.v1': '{"screen":"brief"}', 'peregovorka.lab.v1': '{}' })
    const gone = wipeGame(local, session)
    expect(gone).toHaveLength(5)
    expect(local.length).toBe(1)
    expect(local.getItem('other.app')).toBe('x')
    expect(session.length).toBe(0)
  })
  it('адрес после сброса — без reset, остальные параметры на месте', () => {
    expect(withoutReset('https://a.ru/?reset')).toBe('/')
    expect(withoutReset('https://a.ru/?cutscenes=1&reset')).toBe('/?cutscenes=1')
    expect(withoutReset('https://a.ru/?reset=1&jury#x')).toBe('/?jury=#x')
  })
})
