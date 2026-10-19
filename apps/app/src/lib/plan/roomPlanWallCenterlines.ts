import type { Point2 } from '@/types/schema'
import type { RoomPlanThicknessPair, RoomPlanWallRun } from './roomPlanWallCleanup'

const distance = (a: Point2, b: Point2) => Math.hypot(b.x - a.x, b.y - a.y)
function line(points: [Point2, Point2]) {
  const [a, b] = points, size = distance(a, b)
  const ux = (b.x - a.x) / size, uy = (b.y - a.y) / size
  return {
    a, b, size, ux, uy, nx: -uy, ny: ux,
    along: (p: Point2) => (p.x - a.x) * ux + (p.y - a.y) * uy,
    signed: (p: Point2) => -(p.x - a.x) * uy + (p.y - a.y) * ux,
    at: (along: number, across = 0): Point2 => ({ x: a.x + along * ux - across * uy, y: a.y + along * uy + across * ux }),
  }
}

/** Older bridge results can establish the inside from a closed room boundary. */
function closedRoomSamples(runs: RoomPlanWallRun[]): Point2[] {
  const key = (p: Point2) => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`
  const neighbors = new Map<string, number[]>()
  runs.forEach((wall, index) => wall.points.forEach((p) => {
    const members = neighbors.get(key(p)) ?? []
    members.push(index); neighbors.set(key(p), members)
  }))
  const visited = new Set<number>(), samples: Point2[] = []
  runs.forEach((wall, index) => {
    if (visited.has(index)) return
    const polygon = [wall.points[0]]
    const start = key(wall.points[0])
    let edge = index, current = wall.points[1]
    while (!visited.has(edge)) {
      visited.add(edge)
      polygon.push(current)
      if (key(current) === start) break
      const next = neighbors.get(key(current))
      if (next?.length !== 2) return
      edge = next.find((candidate) => candidate !== edge)!
      const points = runs[edge]!.points
      current = key(points[0]) === key(current) ? points[1] : points[0]
    }
    if (key(current) !== start || polygon.length < 4) return
    const twiceArea = polygon.slice(0, -1).reduce((sum, p, i) => {
      const next = polygon[i + 1]!
      return sum + p.x * next.y - next.x * p.y
    }, 0)
    if (Math.abs(twiceArea) < 1) return // Thin strips are not evidence of a room interior.
    function inside(p: Point2): boolean {
      let result = false
      for (let i = 0, j = polygon.length - 2; i < polygon.length - 1; j = i++) {
        const a = polygon[i]!, b = polygon[j]!
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result
      }
      return result
    }
    for (let i = 0; i < polygon.length - 1; i++) {
      const axis = line([polygon[i]!, polygon[i + 1]!])
      const point = axis.at(axis.size / 2, Math.sign(twiceArea) * 0.15)
      if (inside(point)) samples.push(point)
    }
  })
  return samples
}

function observedSide(axis: ReturnType<typeof line>, samples: Point2[]): -1 | 1 | undefined {
  let positive = 0, negative = 0
  for (const p of samples) {
    const along = axis.along(p), signed = axis.signed(p), across = Math.abs(signed)
    if (along < -0.5 || along > axis.size + 0.5 || across < 0.08 || across > 8) continue
    const weight = 1 / (0.1 + across * across)
    if (signed > 0) positive += weight
    else negative += weight
  }
  if (Math.max(positive, negative) === 0 || Math.min(positive, negative) > Math.max(positive, negative) * 0.35) return undefined
  return positive > negative ? 1 : -1
}

/** Lines represent wall centers, not observed room-facing surfaces. Unknown depth uses
 * 20 cm. A side is inferred only from camera observations or a closed room boundary.
 */
export function centerRoomPlanWalls(input: RoomPlanWallRun[], pairs: RoomPlanThicknessPair[], cameraPositions: Point2[]): RoomPlanWallRun[] {
  const parents = input.map((_, index) => index)
  function root(index: number): number {
    while (parents[index] !== index) index = parents[index]!
    return index
  }
  for (const pair of pairs) parents[root(pair.second)] = root(pair.first)
  const groups = new Map<number, number[]>()
  pairs.forEach(({ first, second }) => {
    const id = root(first), members = groups.get(id) ?? []
    for (const index of [first, second]) if (!members.includes(index)) members.push(index)
    groups.set(id, members)
  })
  const output: RoomPlanWallRun[] = [], targetByRun = new Map<number, number>()
  for (const [id, members] of groups) {
    const base = line(input[[...members].sort((a, b) => distance(...input[b]!.points) - distance(...input[a]!.points))[0]!]!.points)
    const others = members.filter((i) => Math.abs(base.signed(input[i]!.points[0])) > 0.01)
    const total = others.reduce((sum, i) => sum + distance(...input[i]!.points), 0)
    const offset = others.reduce((sum, i) => sum + base.signed(input[i]!.points[0]) * distance(...input[i]!.points), 0) / total / 2
    const ends = members.flatMap((i) => input[i]!.points.map(base.along))
    const first = input[Math.min(...members)]!
    const reversed = base.along(first.points[1]) < base.along(first.points[0])
    const points: [Point2, Point2] = [base.at(Math.min(...ends), offset), base.at(Math.max(...ends), offset)]
    if (reversed) points.reverse()
    const caps = pairs.filter((pair) => root(pair.first) === id).flatMap((pair) => pair.returns)
    const sources = [...new Set([...members, ...caps])]
    sources.forEach((i) => targetByRun.set(i, output.length))
    output.push({ points, sourceIndices: [...new Set(sources.flatMap((i) => input[i]!.sourceIndices))].sort((a, b) => a - b),
      thicknessCm: first.thicknessCm!, thicknessEstimated: true, centered: true })
  }
  const fallbackSamples = closedRoomSamples(input)
  input.forEach((wall, index) => {
    if (targetByRun.has(index)) return
    const axis = line(wall.points)
    const side = observedSide(axis, cameraPositions.length ? cameraPositions : fallbackSamples)
    const thicknessCm = wall.thicknessCm ?? 20
    const offset = side === undefined ? 0 : -side * thicknessCm / 200
    targetByRun.set(index, output.length)
    output.push({ ...wall, thicknessCm, centered: side !== undefined,
      points: [axis.at(0, offset), axis.at(axis.size, offset)] })
  })
  // Offset lines intersect at the new L/T corners. Only the terminating wall gets a
  // point at a T; the through wall remains a two-endpoint segment.
  const targetLines = output.map((wall) => line(wall.points))
  const candidates = output.map(() => [null, null] as [null | { point: Point2; move: number }, null | { point: Point2; move: number }])
  input.forEach((wall, source) => {
    const target = targetByRun.get(source)!, axis = targetLines[target]!
    for (const end of [0, 1] as const) {
      const original = wall.points[end]
      const targetEnd = axis.along(original) <= axis.size / 2 ? 0 : 1
      // A removed seam is not an endpoint of its merged physical wall.
      if (Math.abs(axis.along(original) - (targetEnd === 0 ? 0 : axis.size)) > 0.35) continue
      input.forEach((other, otherSource) => {
        const otherTarget = targetByRun.get(otherSource)!
        if (otherTarget === target) return
        const originalOther = line(other.points)
        const along = originalOther.along(original)
        if (Math.abs(originalOther.signed(original)) > 0.03 || along < -0.03 || along > originalOther.size + 0.03) return
        const next = targetLines[otherTarget]!
        const cross = axis.ux * next.uy - axis.uy * next.ux
        if (Math.abs(cross) < 0.25) return
        const dx = next.a.x - axis.a.x, dy = next.a.y - axis.a.y
        const point = axis.at((dx * next.uy - dy * next.ux) / cross)
        const move = distance(point, axis[targetEnd === 0 ? 'a' : 'b'])
        const limit = Math.max(output[target]!.thicknessCm!, output[otherTarget]!.thicknessCm!) / 100 + 0.05
        if (move > limit) return
        const prior = candidates[target]![targetEnd]
        if (!prior || move < prior.move) candidates[target]![targetEnd] = { point, move }
      })
    }
  })
  output.forEach((wall, index) => {
    for (const end of [0, 1] as const) {
      const candidate = candidates[index]![end]
      if (candidate) wall.points[end] = candidate.point
    }
    // Independent intersection calculations must yield the same shared coordinates.
    wall.points = wall.points.map((point) => ({
      x: Math.round(point.x * 1e9) / 1e9, y: Math.round(point.y * 1e9) / 1e9,
    })) as [Point2, Point2]
  })
  return output.sort((a, b) => a.sourceIndices[0]! - b.sourceIndices[0]!)
}
