/** Ограниченный LRU: активные плееры сохраняют свои ссылки после вытеснения из кэша. */
export class ResourceCache<K, V> {
  private entries = new Map<K, { value: V; weight: number }>()
  private weight = 0
  private limit: number
  private maxWeight: number
  constructor(limit: number, maxWeight = Infinity) {
    this.limit = limit
    this.maxWeight = maxWeight
  }

  get size() { return this.entries.size }

  get(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  delete(key: K) {
    const entry = this.entries.get(key)
    if (!entry) return
    this.weight -= entry.weight
    this.entries.delete(key)
  }

  set(key: K, value: V, weight = 1) {
    this.delete(key)
    this.entries.set(key, { value, weight })
    this.weight += weight
    while (this.entries.size > this.limit || this.weight > this.maxWeight) {
      this.delete(this.entries.keys().next().value!)
    }
  }
}
