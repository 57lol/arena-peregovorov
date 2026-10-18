import { describe, expect, it } from 'vitest'
import { ResourceCache } from './resourceCache'

describe('память аудио', () => {
  it('сотни встреч не накапливают огибающие, недавно прочитанная остаётся', () => {
    const cache = new ResourceCache<number, Float32Array>(96)
    const first = new Float32Array(10)
    cache.set(0, first)
    for (let n = 1; n < 1000; n++) {
      cache.get(0)
      cache.set(n, new Float32Array(10))
    }
    expect(cache.size).toBe(96)
    expect(cache.get(0)).toBe(first)
    expect(cache.get(1)).toBeUndefined()
  })
  it('лимит байтов учитывает замену, удаление и слишком большой трек', () => {
    const cache = new ResourceCache<string, string>(12, 10)
    cache.set('music', 'old', 8)
    cache.set('music', 'new', 4)
    cache.set('sfx', 'click', 6)
    expect(cache.get('music')).toBe('new')
    cache.set('room', 'office', 4)
    expect(cache.get('sfx')).toBeUndefined()
    cache.delete('music')
    cache.set('huge', 'track', 100)
    expect(cache.size).toBe(0)
  })
})
