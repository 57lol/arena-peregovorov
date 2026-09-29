import { describe, expect, it } from 'vitest'
import { CHAPTERS } from '../../content/story'
import { RGB_OF } from '../world3d/palette'
import { SPOTS } from './art'
import { lut, nearest } from './mood'
import { pathLength, pointAt, routeBetween } from './render'
import { BRIDGES, chapterCard, CUTSCENES, PROLOGUE } from './scripts'
import { GUIDE_AT, lineAt, locate, phoneAt, sample, starts, total, travelled, walkFrame } from './timeline'

describe('катсцены: одна мысль за раз и не дольше 40 секунд', () => {
  it.each(CUTSCENES.map((c) => [c.id, c] as const))('%s', (_, cs) => {
    const T = total(cs)
    expect(T).toBeGreaterThanOrEqual(12)
    expect(T).toBeLessThanOrEqual(40)
    for (const shot of cs.shots) {
      expect(shot.dur).toBeGreaterThan(0)
      const lines = shot.lines ?? []
      for (const [k, l] of lines.entries()) {
        // субтитр — одна строка на ноутбуке и не больше двух на телефоне
        expect(l.text.length + (l.who?.length ?? 0)).toBeLessThanOrEqual(58)
        expect(l.at).toBeGreaterThanOrEqual(0)
        expect(l.at).toBeLessThan(shot.dur)
        if (k) expect(l.at).toBeGreaterThan(lines[k - 1].at)
      }
      if (shot.guide) expect(shot.set).toBe('phone')
      for (const c of shot.phone ?? []) {
        expect(shot.set).toBe('phone')
        expect(c.at).toBeLessThan(shot.dur)
        if (c.kind === 'memo') {
          expect(c.title.length).toBeLessThanOrEqual(28)
          expect(c.text.length).toBeLessThanOrEqual(48)
        } else expect(c.text.length).toBeLessThanOrEqual(120)
      }
      // на каждую карточку телефона — хотя бы 3,5 секунды
      const at = [...(shot.phone ?? []).map((c) => c.at), shot.dur]
      for (let k = 1; k < at.length; k++) expect(at[k] - at[k - 1]).toBeGreaterThanOrEqual(3.5)
      if (shot.route) expect(shot.set).toBe('map')
      if (shot.card) expect(shot.set).toBe('black')
      // люди не уходят за край улицы
      if (shot.set === 'street' || shot.set === 'oez')
        for (const a of shot.actors ?? []) {
          const xs = typeof a.x === 'number' ? [a.x] : a.x.map((k) => k[1])
          for (const x of xs) {
            expect(x).toBeGreaterThanOrEqual(16)
            expect(x).toBeLessThanOrEqual(SPOTS[shot.set].w - 16)
          }
        }
    }
    // заканчивается титром
    expect(cs.shots[cs.shots.length - 1].set).toBe('black')
  })

  it('пролог ведёт в первую главу, переход — в следующую', () => {
    expect(PROLOGUE.shots.at(-1)!.card).toEqual(chapterCard(CHAPTERS[0].id))
    for (let i = 0; i < CHAPTERS.length - 1; i++) {
      const cs = BRIDGES[CHAPTERS[i].id]
      expect(cs, CHAPTERS[i].id).toBeTruthy()
      expect(cs.shots.at(-1)!.card).toEqual(chapterCard(CHAPTERS[i + 1].id))
    }
    expect(BRIDGES[CHAPTERS.at(-1)!.id].id).toBe('finale')
    expect(new Set(CUTSCENES.map((c) => c.id)).size).toBe(CUTSCENES.length)
  })

  it('маршрут на карте идёт от метки главы к метке следующей', () => {
    for (const cs of CUTSCENES)
      for (const shot of cs.shots) {
        if (!shot.route) continue
        const p = routeBetween(shot.route.from, shot.route.to)
        expect(p.length).toBeGreaterThan(1)
        expect(pathLength(p)).toBeGreaterThan(10)
        const [x, y] = pointAt(p, pathLength(p))
        expect([x, y]).toEqual([...p[p.length - 1]])
      }
  })
})

describe('памятка в автобусе: что это, зачем и как листать', () => {
  const shot = PROLOGUE.shots.find((s) => s.guide)!
  const g = shot.guide!
  it('телефон в руках в автобусе, листает игрок', () => {
    expect(shot.set).toBe('phone')
    expect(shot.behind).toBe('bus')
    expect(shot.dur).toBeGreaterThan(GUIDE_AT)
    // во всех катсценах памятка одна — в прологе
    expect(CUTSCENES.flatMap((c) => c.shots).filter((s) => s.guide)).toHaveLength(1)
  })
  it('кто пишет и зачем — коротко, без простыней', () => {
    expect(g.from.length).toBeGreaterThan(0)
    expect(g.role).toMatch(/HR|кадр/)
    expect(g.hello.join(' ')).toMatch(/Добро пожаловать в Алабугу/)
    expect(g.hello.length).toBeLessThanOrEqual(3)
    for (const m of g.hello) expect(m.length).toBeLessThanOrEqual(72)
  })
  it('четыре приёма: заголовок, одна мысль, где пригодится', () => {
    expect(g.tips).toHaveLength(4)
    for (const t of g.tips) {
      expect(t.title.length).toBeLessThanOrEqual(28)
      expect(t.text.length).toBeLessThanOrEqual(72)
      expect(t.when.length).toBeLessThanOrEqual(40)
    }
    expect(g.open.length).toBeLessThanOrEqual(20)
    expect(g.done.length).toBeLessThanOrEqual(20)
  })
})

describe('время катсцены', () => {
  const cs = PROLOGUE
  it('план и секунда', () => {
    const st = starts(cs)
    expect(st[0]).toBe(0)
    expect(locate(cs, 0)).toEqual({ i: 0, t: 0 })
    expect(locate(cs, st[2] + 1).i).toBe(2)
    expect(locate(cs, st[2] + 1).t).toBeCloseTo(1)
    expect(locate(cs, 999).i).toBe(cs.shots.length - 1)
  })
  it('дорожка: до, между и после ключей', () => {
    const tr = [
      [1, 10],
      [3, 30],
    ] as const
    expect(sample(tr, 0)).toBe(10)
    expect(sample(tr, 2)).toBeCloseTo(20)
    expect(sample(tr, 9)).toBe(30)
    expect(sample(7, 5)).toBe(7)
    expect(sample(undefined, 5, 3)).toBe(3)
  })
  it('шаг по пройденному пути: ноги не скользят', () => {
    const tr = [
      [0, 100],
      [4, 20],
    ] as const
    const end = travelled(tr, 4)
    expect(end.dist).toBeCloseTo(80, 0)
    expect(travelled(tr, 2).dir).toBe(-1)
    expect(travelled(tr, 2).moving).toBe(true)
    expect(travelled(tr, 4.5).moving).toBe(false)
    expect(walkFrame(0, 32, 8)).toBe(0)
    expect(walkFrame(4, 32, 8)).toBe(1)
    expect(walkFrame(33, 32, 8)).toBe(0)
  })
  it('строка и карточка телефона держатся до следующей', () => {
    const phone = BRIDGES.stop.shots.find((s) => s.set === 'phone')!
    expect(lineAt(phone, 0)).toBeNull()
    expect(lineAt(phone, 5)!.text).toBe(phone.lines![1].text)
    expect(phoneAt(phone, 3)!.index).toBe(0)
    expect(phoneAt(phone, 5)!.index).toBe(1)
  })
})

describe('время суток', () => {
  it('день — тождество, остальное — только цвета палитры', () => {
    expect(lut('day')).toEqual(RGB_OF.map((_, i) => i))
    for (const m of ['dusk', 'morning', 'night'] as const) {
      const l = lut(m)
      expect(l).toHaveLength(RGB_OF.length)
      for (const i of l) expect(i).toBeGreaterThanOrEqual(0)
    }
    // ночь темнее дня
    const lum = (i: number) => RGB_OF[i][0] * 0.3 + RGB_OF[i][1] * 0.55 + RGB_OF[i][2] * 0.15
    const day = RGB_OF.reduce((s, _, i) => s + lum(i), 0)
    const night = lut('night').reduce((s, i) => s + lum(i), 0)
    expect(night).toBeLessThan(day * 0.6)
    expect(nearest(RGB_OF[7] as unknown as number[])).toBe(7)
  })
})
