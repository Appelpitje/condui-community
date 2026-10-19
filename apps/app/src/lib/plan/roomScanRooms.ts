import type { Point2, Wall } from '@/types/schema'

export type ScanRoomKind = 'unidentified' | 'bedroom' | 'bathroom' | 'kitchen' | 'livingRoom' | 'diningRoom' | 'laundry' | 'office'
export type ScanRoom = { id: string; polygon: Point2[]; center: Point2; kind: ScanRoomKind }
export type ScanRoomHint = { center: Point2; kind: string; confidence?: string }
export function scanRoomContains(polygon: Point2[], p: Point2): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
const cross = (a: Point2, b: Point2) => a.x * b.y - a.y * b.x
const delta = (a: Point2, b: Point2) => ({ x: a.x - b.x, y: a.y - b.y })

/** Build bounded planar faces with virtual T/intersection vertices. Persisted walls stay simple. */
export function detectScanRooms(walls: Wall[], pxPerMeter: number, objects: ScanRoomHint[] = [], sections: ScanRoomHint[] = []): ScanRoom[] {
  const edges = walls.flatMap((wall) => wall.points.slice(1).map((b, i) => ({ a: wall.points[i]!, b, cuts: [0, 1] })))
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const a = edges[i]!, b = edges[j]!, r = delta(a.b, a.a), s = delta(b.b, b.a), d = delta(b.a, a.a)
    const c = cross(r, s)
    if (Math.abs(c) < 1e-8) continue
    const t = cross(d, s) / c, u = cross(d, r) / c
    if (t >= -1e-7 && t <= 1 + 1e-7 && u >= -1e-7 && u <= 1 + 1e-7) {
      a.cuts.push(Math.max(0, Math.min(1, t))); b.cuts.push(Math.max(0, Math.min(1, u)))
    }
  }
  const vertices = new Map<string, { p: Point2; outgoing: Array<{ to: string; angle: number; edge: string }> }>()
  const key = (p: Point2) => `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)}`
  function add(a: Point2, b: Point2, edge: string) {
    const ak = key(a), bk = key(b)
    if (ak === bk) return
    if (!vertices.has(ak)) vertices.set(ak, { p: a, outgoing: [] })
    if (!vertices.has(bk)) vertices.set(bk, { p: b, outgoing: [] })
    if (!vertices.get(ak)!.outgoing.some((n) => n.to === bk)) vertices.get(ak)!.outgoing.push({ to: bk, angle: Math.atan2(b.y - a.y, b.x - a.x), edge })
  }
  edges.forEach((edge, index) => {
    const cuts = [...new Set(edge.cuts.map((n) => Math.round(n * 1e8) / 1e8))].sort((a, b) => a - b)
    const at = (t: number) => ({ x: edge.a.x + t * (edge.b.x - edge.a.x), y: edge.a.y + t * (edge.b.y - edge.a.y) })
    cuts.slice(1).forEach((end, i) => { const a = at(cuts[i]!), b = at(end), id = `${index}:${cuts[i]}:${end}`; add(a, b, id); add(b, a, id) })
  })
  for (const vertex of vertices.values()) vertex.outgoing.sort((a, b) => a.angle - b.angle)
  const seen = new Set<string>(), rooms: ScanRoom[] = []
  for (const [start, vertex] of vertices) for (const first of vertex.outgoing) {
    let from = start, to = first.to
    const path: Point2[] = [], boundary: string[] = []
    if (seen.has(`${from}>${to}`)) continue
    let closed = false
    for (let step = 0; step <= edges.length * 8; step++) {
      const directed = `${from}>${to}`
      if (seen.has(directed)) { closed = from === start && to === first.to; break }
      seen.add(directed)
      const a = vertices.get(from)!, b = vertices.get(to)!
      path.push(a.p); boundary.push(a.outgoing.find((n) => n.to === to)!.edge)
      const reverse = b.outgoing.findIndex((n) => n.to === from)
      const next = b.outgoing[(reverse + b.outgoing.length - 1) % b.outgoing.length]!
      from = to; to = next.to
    }
    if (!closed || path.length < 3) continue
    let area2 = 0, cx = 0, cy = 0
    path.forEach((a, i) => { const b = path[(i + 1) % path.length]!, c = cross(a, b); area2 += c; cx += (a.x + b.x) * c; cy += (a.y + b.y) * c })
    if (area2 < pxPerMeter * pxPerMeter) continue // Discard exterior face and spaces below 0.5 m².
    let center = { x: cx / (3 * area2), y: cy / (3 * area2) }
    // Concave rooms need a label inside the polygon. Sample the bounding box deterministically.
    if (!scanRoomContains(path, center)) {
      const xs = path.map((p) => p.x), ys = path.map((p) => p.y)
      let best = -1
      for (let x = 1; x < 20; x++) for (let y = 1; y < 20; y++) {
        const p = { x: Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * x / 20, y: Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * y / 20 }
        if (!scanRoomContains(path, p)) continue
        const distance = Math.min(...path.map((a, i) => { const b = path[(i + 1) % path.length]!, d = delta(b, a), t = Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / (d.x * d.x + d.y * d.y))); return Math.hypot(p.x - a.x - t * d.x, p.y - a.y - t * d.y) }))
        if (distance > best) { center = p; best = distance }
      }
    }
    const hints = new Set<ScanRoomKind>()
    for (const section of sections.filter((hint) => scanRoomContains(path, hint.center)))
      if (['bedroom', 'bathroom', 'kitchen', 'livingRoom', 'diningRoom'].includes(section.kind)) hints.add(section.kind as ScanRoomKind)
    for (const object of objects.filter((hint) => hint.confidence !== 'low' && scanRoomContains(path, hint.center))) {
      if (object.kind === 'bed') hints.add('bedroom')
      if (['bathtub', 'toilet'].includes(object.kind)) hints.add('bathroom')
      if (['stove', 'oven', 'dishwasher', 'refrigerator'].includes(object.kind)) hints.add('kitchen')
      if (object.kind === 'sofa') hints.add('livingRoom')
      if (object.kind === 'washerDryer') hints.add('laundry')
    }
    // A sink or generic table/chair cannot distinguish kitchen/bathroom or office/dining.
    const signature = [...new Set(boundary)].sort().join('|')
    let hash = 2166136261
    for (const c of signature) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619)
    rooms.push({ id: `room-${(hash >>> 0).toString(16)}`, polygon: path, center, kind: hints.size === 1 ? [...hints][0]! : 'unidentified' })
  }
  return rooms.sort((a, b) => a.id.localeCompare(b.id))
}

export function resolveScanRoomNames(rooms: ScanRoom[], overrides: Record<string, string> | undefined, t: (key: string) => string): Record<string, string> {
  const seen = new Map<string, number>()
  return Object.fromEntries(rooms.map((room, index) => {
    const base = t(room.kind === 'unidentified' ? 'nativeRoomScan.roomNameDefault' : `nativeRoomScan.roomTypes.${room.kind}`)
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    const repeated = rooms.filter((other) => other.kind === room.kind).length > 1
    const fallback = room.kind === 'unidentified' ? `${base} ${index + 1}` : `${base}${repeated ? ` ${count}` : ''}`
    return [room.id, overrides?.[room.id]?.trim() || fallback]
  }))
}
