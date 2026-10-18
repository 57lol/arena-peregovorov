/// <reference types="vite/client" />
import { existsSync, readFileSync } from 'node:fs'
import { Mesh, Texture, TextureLoader } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ROOM } from '../game/world3d/rooms/lagos'
import { buildAnyRoom, isStoryKind } from '../game/world3d/rooms/index'
import { ATLAS } from '../game/world3d/rooms/lagos.gen'
import { SCENES, PORTRAITS } from '../game/ui/assets'
import { EXITS } from '../game/world3d/exit'

afterEach(() => vi.restoreAllMocks())
const png = (path: string) => {
  const b = readFileSync(`public${path}`)
  expect(b.subarray(1, 4).toString()).toBe('PNG')
  return [b.readUInt32BE(16), b.readUInt32BE(20), b[25]]
}

describe('графика Лагоса без WebGL, браузера и сети', () => {
  it('портрет — 6 эмоций × 3 кадра; оба 2D-слоя и атласы существуют в нужном размере', () => {
    expect(png(PORTRAITS.lagos.sheet)).toEqual([288, 576, 6])
    expect(png(SCENES.lagos.bg)).toEqual([192, 108, 6])
    expect(png(SCENES.lagos.desk)).toEqual([192, 108, 6])
    for (const k of [0, 1, 2]) expect(png(`/assets/world/lagos_atlas${k}.png`)).toEqual([ATLAS.w, ATLAS.h, 6])
    for (const [x, y, w, h] of Object.values(ATLAS.rects)) {
      expect(x + w).toBeLessThanOrEqual(ATLAS.w)
      expect(y + h).toBeLessThanOrEqual(ATLAS.h)
    }
  })
  it('собирается именно своя комната, все текстуры локальны, анимация и освобождение ресурсов работают', () => {
    const textures: Texture[] = []
    const disposal = vi.fn()
    vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((url) => {
      expect(url).toMatch(/^\/assets\/world\/lagos_/)
      expect(existsSync(`public${url}`), url).toBe(true)
      const t = new Texture() as ReturnType<TextureLoader['load']>
      t.addEventListener('dispose', disposal)
      textures.push(t)
      return t
    })
    expect(isStoryKind('lagos')).toBe(true)
    expect(ROOM.kind).toBe('lagos')
    const room = buildAnyRoom('lagos')
    expect(room.group.name).toBe('lagos-room')
    expect(room.exit).toEqual(EXITS.lagos)
    expect(room.group.getObjectByName('lagos-lagoon')).toBeDefined()
    expect(room.clock.hour).toBeDefined()
    room.group.traverse((o) => {
      if (o instanceof Mesh) {
        const a = o.geometry.getAttribute('position')
        expect(a.count).toBeGreaterThan(0)
        expect([...a.array].every(Number.isFinite)).toBe(true)
      }
    })
    const fan = room.group.getObjectByName('lagos-ceiling-fan')!
    room.update!(0, 0)
    const first = fan.rotation.y
    room.update!(2, 2)
    expect(fan.rotation.y).not.toBe(first)
    expect(() => { room.door!(1); room.door!(0) }).not.toThrow()
    room.dispose!()
    expect(disposal).toHaveBeenCalledTimes(textures.length)
    room.dispose!()
    expect(disposal).toHaveBeenCalledTimes(textures.length)
  })
})
