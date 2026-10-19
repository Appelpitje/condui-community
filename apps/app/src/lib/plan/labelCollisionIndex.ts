type Bounds = { left: number; top: number; right: number; bottom: number }

/** Nearby label/symbol candidates, in original placement order for stable scoring. */
export function createLabelCollisionIndex<T>(cellSize: number) {
  const size = Math.max(1, cellSize)
  const entries: T[] = []
  const buckets = new Map<string, number[]>()
  const oversized: number[] = []
  function cells(bounds: Bounds) {
    const x0 = Math.floor(bounds.left / size), x1 = Math.floor(bounds.right / size)
    const y0 = Math.floor(bounds.top / size), y1 = Math.floor(bounds.bottom / size)
    if (![x0, x1, y0, y1].every(Number.isSafeInteger) || x1 < x0 || y1 < y0 ||
        (x1 - x0 + 1) * (y1 - y0 + 1) > 256) return null
    return { x0, x1, y0, y1 }
  }
  return {
    insert(value: T, bounds: Bounds) {
      const id = entries.push(value) - 1
      const range = cells(bounds)
      if (!range) { oversized.push(id); return }
      for (let x = range.x0; x <= range.x1; x++) {
        for (let y = range.y0; y <= range.y1; y++) {
          const key = `${x},${y}`
          const bucket = buckets.get(key)
          if (bucket) bucket.push(id)
          else buckets.set(key, [id])
        }
      }
    },
    query(bounds: Bounds): T[] {
      const range = cells(bounds)
      if (!range) return entries
      const ids = new Set(oversized)
      for (let x = range.x0; x <= range.x1; x++)
        for (let y = range.y0; y <= range.y1; y++)
          for (const id of buckets.get(`${x},${y}`) ?? []) ids.add(id)
      return [...ids].sort((a, b) => a - b).map((id) => entries[id]!)
    },
  }
}
