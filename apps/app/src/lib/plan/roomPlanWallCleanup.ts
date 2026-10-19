import type { Point2 } from '@/types/schema'

/** Geometry is in meters. Membership keeps native opening ownership after wall merging. */
export type RoomPlanWallRun = {
  sourceIndices: number[]
  points: [Point2, Point2]
  thicknessCm?: number
  thicknessEstimated?: boolean
  centered?: boolean
}

const distance = (a: Point2, b: Point2) => Math.hypot(b.x - a.x, b.y - a.y)
const length = (wall: RoomPlanWallRun) => distance(...wall.points)
function frame(wall: RoomPlanWallRun) {
  const [a, b] = wall.points
  const size = length(wall)
  const ux = (b.x - a.x) / size, uy = (b.y - a.y) / size
  return {
    along: (p: Point2) => (p.x - a.x) * ux + (p.y - a.y) * uy,
    across: (p: Point2) => (p.x - a.x) * uy - (p.y - a.y) * ux,
    at: (t: number): Point2 => ({ x: a.x + t * ux, y: a.y + t * uy }),
    ux, uy, size,
  }
}

/** A T stem ends on the run; it never adds a vertex to the continuous wall. */
export function mergeRoomPlanWallRuns(points: ReadonlyArray<readonly [Point2, Point2]>): RoomPlanWallRun[] {
  const input: RoomPlanWallRun[] = points.map(([a, b], index) => ({
    sourceIndices: [index], points: [{ ...a }, { ...b }],
  }))
  const remaining = new Set(input)
  const runs: RoomPlanWallRun[] = []
  const movedCorners = new Map<string, Point2>()
  const key = (p: Point2) => `${p.x},${p.y}`
  for (const base of [...input].sort((a, b) => length(b) - length(a))) {
    if (!remaining.has(base)) continue
    const axis = frame(base)
    const candidates = [...remaining].filter((wall) => {
      const other = frame(wall)
      return Math.abs(axis.ux * other.ux + axis.uy * other.uy) >= Math.cos(Math.PI / 360)
        && wall.points.every((p) => Math.abs(axis.across(p)) <= 0.005)
    }).map((wall) => {
      const values = wall.points.map(axis.along)
      return { wall, start: Math.min(...values), end: Math.max(...values) }
    }).sort((a, b) => a.start - b.start)
    const groups: Array<typeof candidates> = []
    let end = -Infinity
    for (const candidate of candidates) {
      if (!groups.length || candidate.start > end + 0.05) {
        groups.push([candidate])
        end = candidate.end
      } else {
        groups[groups.length - 1]!.push(candidate)
        end = Math.max(end, candidate.end)
      }
    }
    for (const group of groups) {
      const sources = group.flatMap(({ wall }) => wall.sourceIndices).sort((a, b) => a - b)
      for (const { wall } of group) remaining.delete(wall)
      if (group.length === 1) { runs.push(group[0]!.wall); continue }
      const start = Math.min(...group.map((item) => item.start))
      const finish = Math.max(...group.map((item) => item.end))
      const first = input[sources[0]!]!
      const reversed = axis.along(first.points[1]) < axis.along(first.points[0])
      runs.push({ sourceIndices: sources, points: reversed ? [axis.at(finish), axis.at(start)] : [axis.at(start), axis.at(finish)] })
      for (const { wall } of group) {
        for (const point of wall.points) movedCorners.set(key(point), axis.at(axis.along(point)))
      }
    }
  }
  // Branch tips at removed vertices follow any millimetric projection onto the merged line.
  for (const run of runs) run.points = run.points.map((p) => movedCorners.get(key(p)) ?? p) as [Point2, Point2]
  return runs.sort((a, b) => a.sourceIndices[0]! - b.sourceIndices[0]!)
}

export function roundRoomPlanThickness(cm: number): number {
  const preferred = [10, 20].find((value) => Math.abs(value - cm) <= 2 + 1e-6)
  return preferred ?? Math.max(2, Math.round(cm))
}

/** RoomPlan surfaces have no guaranteed physical depth. Infer only with a visible
 * short return spanning two overlapping parallel faces, never from room size alone.
 */
export type RoomPlanThicknessPair = { first: number; second: number; returns: number[] }

export function estimateRoomPlanThickness(runs: RoomPlanWallRun[], cameraPositions: Point2[] = []): RoomPlanThicknessPair[] {
  const frames = runs.map(frame)
  const estimates = runs.map(() => [] as Array<{ cm: number; weight: number }>)
  const tolerance = 0.03
  const pairs = new Map<string, RoomPlanThicknessPair>()
  for (let capIndex = 0; capIndex < runs.length; capIndex++) {
    const cap = runs[capIndex]!, capFrame = frames[capIndex]!
    if (capFrame.size < 0.05 || capFrame.size > 0.6) continue
    const candidates = cap.points.map((point) => runs.flatMap((_, index) => {
      const axis = frames[index]!
      if (index === capIndex || axis.size < Math.max(0.6, 4 * capFrame.size)) return []
      if (Math.abs(axis.ux * capFrame.ux + axis.uy * capFrame.uy) > Math.sin(5 * Math.PI / 180)) return []
      const along = axis.along(point)
      return Math.abs(axis.across(point)) <= tolerance && along >= -tolerance && along <= axis.size + tolerance ? [index] : []
    }))
    for (const a of candidates[0]!) for (const b of candidates[1]!) {
      if (a === b) continue
      const first = frames[a]!, second = frames[b]!
      if (Math.abs(first.ux * second.ux + first.uy * second.uy) < Math.cos(Math.PI / 180)) continue
      const offsets = runs[b]!.points.map((p) => Math.abs(first.across(p)))
      if (Math.abs(offsets[0]! - offsets[1]!) > 0.02) continue
      const width = (offsets[0]! + offsets[1]!) / 2
      if (width < 0.05 || width > 0.6 || Math.abs(width - capFrame.size) > tolerance) continue
      const ts = runs[b]!.points.map(first.along)
      const overlap = Math.min(first.size, Math.max(...ts)) - Math.max(0, Math.min(...ts))
      if (overlap < Math.max(0.5, 0.5 * Math.min(first.size, second.size))) continue
      const side = Math.sign(first.across(runs[b]!.points[0]))
      if (cameraPositions.some((point) => {
        const along = first.along(point), across = first.across(point) * side
        return across > 0.03 && across < width - 0.03 && along >= Math.max(0, Math.min(...ts)) && along <= Math.min(first.size, Math.max(...ts))
      })) continue // A camera inside the strip proves it is space, not solid wall material.
      const estimate = { cm: width * 100, weight: overlap }
      estimates[a]!.push(estimate); estimates[b]!.push(estimate)
      const key = `${Math.min(a, b)},${Math.max(a, b)}`
      const pair = pairs.get(key) ?? { first: a, second: b, returns: [] }
      if (!pair.returns.includes(capIndex)) pair.returns.push(capIndex)
      pairs.set(key, pair)
    }
  }
  estimates.forEach((samples, index) => {
    if (!samples.length) return
    const weight = samples.reduce((sum, item) => sum + item.weight, 0)
    const mean = samples.reduce((sum, item) => sum + item.cm * item.weight, 0) / weight
    // Conflicting parallel faces are not enough evidence to choose a construction width.
    if (samples.some((item) => Math.abs(item.cm - mean) > Math.max(2, mean * 0.2))) return
    runs[index]!.thicknessCm = roundRoomPlanThickness(mean)
    runs[index]!.thicknessEstimated = true
  })
  return [...pairs.values()].filter(({ first, second }) => runs[first]!.thicknessCm !== undefined
    && runs[first]!.thicknessCm === runs[second]!.thicknessCm)
}
