import type { Point2 } from '@/types/schema'
import { clamp, distance, lerp, projectPointToSegment } from '@/lib/geometry'

function interpolate(a: Point2, b: Point2, t: number): Point2 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
  }
}

function cumulativeLengths(points: Point2[]): number[] {
  const out = new Array<number>(points.length).fill(0)
  for (let i = 1; i < points.length; i++) {
    out[i] = (out[i - 1] ?? 0) + distance(points[i - 1]!, points[i]!)
  }
  return out
}

function pointAtDistance(points: Point2[], lengths: number[], targetDistance: number): Point2 {
  const totalLength = lengths[lengths.length - 1] ?? 0
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1 || totalLength < 1e-10) return points[0]!

  const d = clamp(targetDistance, 0, totalLength)
  for (let i = 0; i < points.length - 1; i++) {
    const startDist = lengths[i] ?? 0
    const endDist = lengths[i + 1] ?? 0
    const segLen = endDist - startDist
    if (d <= endDist + 1e-8) {
      if (segLen < 1e-10) return points[i]!
      const t = (d - startDist) / segLen
      return interpolate(points[i]!, points[i + 1]!, clamp(t, 0, 1))
    }
  }
  return points[points.length - 1]!
}

export function projectPointToWall(
  points: Point2[],
  point: Point2
): { t: number; distanceSq: number } {
  if (points.length < 2) return { t: 0, distanceSq: Infinity }
  const lengths = cumulativeLengths(points)
  const totalLength = lengths[lengths.length - 1] ?? 0
  if (totalLength < 1e-10) return { t: 0, distanceSq: Infinity }

  let bestDistSq = Infinity
  let bestDistanceAlong = 0
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const segLengthSq = dx * dx + dy * dy
    if (segLengthSq < 1e-10) continue
    const proj = projectPointToSegment(point, p1, p2)
    const segT = proj.t
    const dSq = proj.distanceSq
    if (dSq < bestDistSq) {
      bestDistSq = dSq
      const segLength = Math.sqrt(segLengthSq)
      bestDistanceAlong = (lengths[i] ?? 0) + segLength * segT
    }
  }

  return { t: bestDistanceAlong / totalLength, distanceSq: bestDistSq }
}

export interface WallOpeningGeometry {
  center: Point2
  tangent: Point2
  totalLength: number
  segmentIndex: number
  segmentStartDist: number
  segmentEndDist: number
  centerDist: number
}

export function computeOpeningGeometry(
  points: Point2[],
  position: number
): WallOpeningGeometry | null {
  if (points.length < 2) return null
  const lengths = cumulativeLengths(points)
  const totalLength = lengths[lengths.length - 1] ?? 0
  if (totalLength < 1e-10) return null

  const clampedPos = Number.isFinite(position) ? clamp(position, 0, 1) : 0
  const targetDist = clampedPos * totalLength

  // Find segment that contains targetDist. Use strict upper bound so openings at the
  // segment boundary stay in the lower segment (avoid float assigning them to the next).
  // Skip zero-length segments (duplicate consecutive points): they cannot host an opening.
  let segmentIndex = 0
  let lastValid = -1
  let found = false
  for (let i = 0; i < points.length - 1; i++) {
    const start = lengths[i] ?? 0
    const end = lengths[i + 1] ?? 0
    if (end - start < 1e-10) continue
    lastValid = i
    if (targetDist < end + 1e-10) {
      segmentIndex = i
      found = true
      break
    }
  }
  if (!found && lastValid >= 0) segmentIndex = lastValid

  const segmentStartDist = lengths[segmentIndex] ?? 0
  const segmentEndDist = lengths[segmentIndex + 1] ?? totalLength
  const center = pointAtDistance(points, lengths, targetDist)
  const p1 = points[segmentIndex]!
  const p2 = points[segmentIndex + 1]!
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const tangent = { x: dx / len, y: dy / len }

  return {
    center,
    tangent,
    totalLength,
    segmentIndex,
    segmentStartDist,
    segmentEndDist,
    centerDist: targetDist,
  }
}

function pathBetweenDistancesOpen(
  points: Point2[],
  lengths: number[],
  startDistance: number,
  endDistance: number
): Point2[] {
  const totalLength = lengths[lengths.length - 1] ?? 0
  if (points.length < 2 || totalLength < 1e-10) return []
  const start = clamp(startDistance, 0, totalLength)
  const end = clamp(endDistance, 0, totalLength)
  if (end - start < 1e-8) return []

  const out: Point2[] = [pointAtDistance(points, lengths, start)]
  for (let i = 1; i < points.length; i++) {
    const d = lengths[i] ?? 0
    if (d > start + 1e-8 && d < end - 1e-8) out.push(points[i]!)
  }
  const endPoint = pointAtDistance(points, lengths, end)
  if (distance(out[out.length - 1]!, endPoint) > 1e-6) out.push(endPoint)
  return out
}

/**
 * Total length of the wall polyline (user control vertices only).
 * Used to build gap intervals and solid segments for visual wall rendering.
 */
export function getWallTotalLength(points: Point2[]): number {
  if (points.length < 2) return 0
  const lengths = cumulativeLengths(points)
  return lengths[lengths.length - 1] ?? 0
}

/**
 * Returns the polyline from startDist to endDist along the wall (distance in same units as getWallTotalLength).
 * Used to draw "solid" wall segments between openings; terminator positions are on the line between user vertices.
 */
export function getWallPathBetweenDistances(
  points: Point2[],
  startDist: number,
  endDist: number
): Point2[] {
  if (points.length < 2) return []
  const lengths = cumulativeLengths(points)
  return pathBetweenDistancesOpen(points, lengths, startDist, endDist)
}
