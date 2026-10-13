import type { Point2 } from '@/types/schema'
import type { Door, Window } from '@/types/schema'
import { getWallTotalLength } from '@/lib/plan/wallOpeningGeometry'
import type { VertexMoveResult } from './types'
import type { OpeningOnSegment } from './types'
import {
  getSegmentInfos,
  enforcePointMinSegmentLength,
  segmentLength,
  getWallTotalLengthFromPoints,
} from './segmentGeometry'
import { getOpeningsBySegment, minSegmentLengthForOpenings, fitOpeningsInSegment } from './openings'
import { DISTANCE_EPS } from './constants'
import { clamp } from '@/lib/geometry'

/**
 * Constrain a vertex move so that:
 * - No segment becomes shorter than the sum of its opening widths.
 * - Openings stay at least halfWidth from each segment vertex (push openings if needed).
 * Returns new points and any opening position updates; never invalidates.
 */
export function constrainVertexMove(
  points: Point2[],
  pointIndex: number,
  candidatePos: Point2,
  doors: Door[],
  windows: Window[],
  options?: { initialOpeningsBySegment?: Map<number, OpeningOnSegment[]> }
): VertexMoveResult {
  const doorUpdates: Array<{ id: string; position: number }> = []
  const windowUpdates: Array<{ id: string; position: number }> = []

  if (points.length < 2) {
    return { points: [...points], doorUpdates, windowUpdates, wasClamped: false }
  }

  const bySegment = getOpeningsBySegment(points, doors, windows)
  const totalLength = getWallTotalLengthFromPoints(points)
  if (totalLength < DISTANCE_EPS) {
    return { points: [...points], doorUpdates, windowUpdates, wasClamped: false }
  }

  const isStart = pointIndex === 0
  const isEnd = pointIndex === points.length - 1
  const leftSegmentIndex = pointIndex - 1
  const rightSegmentIndex = pointIndex
  const initialOpenings = options?.initialOpeningsBySegment
  const effectiveBySegment = new Map(bySegment)
  if (initialOpenings) {
    if (!isStart && initialOpenings.has(leftSegmentIndex)) {
      effectiveBySegment.set(leftSegmentIndex, initialOpenings.get(leftSegmentIndex)!)
    }
    if (!isEnd && initialOpenings.has(rightSegmentIndex)) {
      effectiveBySegment.set(rightSegmentIndex, initialOpenings.get(rightSegmentIndex)!)
    }
  }

  let clampedPos = candidatePos
  let wasClamped = false

  if (!isStart) {
    const leftOpenings = effectiveBySegment.get(leftSegmentIndex) ?? []
    const minLeftLen = minSegmentLengthForOpenings(leftOpenings)
    const neighborLeft = points[pointIndex - 1]!
    const candidateLeftLen = segmentLength(neighborLeft, candidatePos)
    if (candidateLeftLen < minLeftLen - DISTANCE_EPS) {
      clampedPos = enforcePointMinSegmentLength(neighborLeft, candidatePos, minLeftLen)
      wasClamped = true
    }
  }

  if (!isEnd) {
    const rightOpenings = effectiveBySegment.get(rightSegmentIndex) ?? []
    const minRightLen = minSegmentLengthForOpenings(rightOpenings)
    const neighborRight = points[pointIndex + 1]!
    const candidateRightLen = segmentLength(clampedPos, neighborRight)
    if (candidateRightLen < minRightLen - DISTANCE_EPS) {
      clampedPos = enforcePointMinSegmentLength(neighborRight, clampedPos, minRightLen)
      wasClamped = true
    }
  }

  const newPoints = points.map((p, i) => (i === pointIndex ? clampedPos : p))
  const newTotalLength = getWallTotalLengthFromPoints(newPoints)
  if (newTotalLength < DISTANCE_EPS) {
    return { points: newPoints, doorUpdates, windowUpdates, wasClamped }
  }

  const newSegmentInfos = getSegmentInfos(newPoints)
  const segmentsToFix = new Set<number>()
  if (!isStart) segmentsToFix.add(pointIndex - 1)
  if (!isEnd) segmentsToFix.add(pointIndex)

  // Use ORIGINAL segment assignment (effectiveBySegment) so openings never "pop" to the other
  // segment when the vertex passes their position. Assigning by new geometry + old
  // normalized position would put them on the next segment when the boundary moves.
  // Always emit position updates for every opening on affected segments (not only when
  // fit was adjusted) so normalized position is rewritten for the new geometry and
  // openings never drift to the next segment. Do not clamp center per-opening (would
  // collapse multiple openings to the same center); fitOpeningsInSegment already keeps
  // them in bounds and non-overlapping.
  for (const segIndex of segmentsToFix) {
    const openings = effectiveBySegment.get(segIndex)
    if (!openings?.length) continue
    const segInfo = newSegmentInfos[segIndex]
    if (!segInfo || segInfo.length < DISTANCE_EPS) continue
    const fit = fitOpeningsInSegment(segInfo.length, openings)
    for (const o of openings) {
      const newCenterAlongSegment = fit.positionsByOpeningId.get(o.id)
      if (newCenterAlongSegment == null) continue
      const newCenterDist = segInfo.startDist + newCenterAlongSegment
      const newPosition = clamp(newCenterDist / newTotalLength, 0, 1)
      if (o.kind === 'door') {
        doorUpdates.push({ id: o.id, position: newPosition })
      } else {
        windowUpdates.push({ id: o.id, position: newPosition })
      }
    }
  }

  return {
    points: newPoints,
    doorUpdates,
    windowUpdates,
    wasClamped,
  }
}

interface MultiVertexAdjustResult {
  points: Point2[]
  doorUpdates: Array<{ id: string; position: number }>
  windowUpdates: Array<{ id: string; position: number }>
  wasClamped: boolean
}

/**
 * Adjust multiple vertices and openings atomically.
 *
 * This is the unified constraint solver described in the floorplan constraint
 * analysis: given the original wall points, a candidate geometry (typically a
 * rigid delta applied to a subset of vertices), and the set of moved vertex
 * indices, it finds the largest fraction α ∈ [0, 1] of the move that keeps
 * every segment at least as long as the sum of widths of its openings.
 *
 * For segments whose length changes, openings are refitted with the same
 * 1D train-of-carts algorithm used by single-vertex moves. Unaffected
 * segments keep their original opening layout.
 */
export function adjustVerticesAndOpenings(
  oldPoints: Point2[],
  candidatePoints: Point2[],
  doors: Door[],
  windows: Window[],
  movedVertexIndices: number[],
): MultiVertexAdjustResult {
  const doorUpdates: Array<{ id: string; position: number }> = []
  const windowUpdates: Array<{ id: string; position: number }> = []

  if (oldPoints.length < 2 || movedVertexIndices.length === 0) {
    return {
      points: [...oldPoints],
      doorUpdates,
      windowUpdates,
      wasClamped: false,
    }
  }

  const n = oldPoints.length

  // Compute per-vertex deltas from the original geometry to the candidate.
  const deltas: Point2[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const from = oldPoints[i]!
    const to = candidatePoints[i] ?? oldPoints[i]!
    deltas[i] = {
      x: to.x - from.x,
      y: to.y - from.y,
    }
  }

  const bySegment = getOpeningsBySegment(oldPoints, doors, windows)
  const segInfosBefore = getSegmentInfos(oldPoints)

  // Pre-compute minimal required lengths per segment based on openings.
  const minLenBySegment = new Map<number, number>()
  for (const [segIndex, openings] of bySegment) {
    if (!openings.length) continue
    const minLen = minSegmentLengthForOpenings(openings)
    if (minLen > 0) {
      minLenBySegment.set(segIndex, minLen)
    }
  }

  const evaluateSegmentsValid = (alpha: number): boolean => {
    for (let segIndex = 0; segIndex < n - 1; segIndex++) {
      const requiredLen = minLenBySegment.get(segIndex)
      if (requiredLen == null || requiredLen <= 0) continue

      const p0 = oldPoints[segIndex]!
      const p1 = oldPoints[segIndex + 1]!
      const d0 = deltas[segIndex]!
      const d1 = deltas[segIndex + 1]!

      const x0 = p0.x + d0.x * alpha
      const y0 = p0.y + d0.y * alpha
      const x1 = p1.x + d1.x * alpha
      const y1 = p1.y + d1.y * alpha

      const len = Math.hypot(x1 - x0, y1 - y0)
      if (len < requiredLen - DISTANCE_EPS) {
        return false
      }
    }
    return true
  }

  // Find the maximal α ∈ [0,1] that keeps all segments above their
  // minimal required length. Use a robust binary search instead of
  // solving the inequalities analytically to keep the implementation
  // simple and stable.
  let alpha = 1
  let wasClamped = false
  if (!evaluateSegmentsValid(1)) {
    let lo = 0
    let hi = 1
    for (let iter = 0; iter < 24; iter++) {
      const mid = (lo + hi) / 2
      if (evaluateSegmentsValid(mid)) {
        lo = mid
      } else {
        hi = mid
      }
    }
    alpha = lo
    wasClamped = alpha < 1 - 1e-4
  }

  const newPoints: Point2[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const p = oldPoints[i]!
    const d = deltas[i]!
    newPoints[i] = {
      x: p.x + d.x * alpha,
      y: p.y + d.y * alpha,
    }
  }

  const newTotalLength = getWallTotalLengthFromPoints(newPoints)
  if (newTotalLength < DISTANCE_EPS) {
    return { points: newPoints, doorUpdates, windowUpdates, wasClamped }
  }

  const segInfosAfter = getSegmentInfos(newPoints)
  const movedSet = new Set<number>(movedVertexIndices)

  // For each segment whose endpoints changed and that has openings, refit
  // its openings and emit updated normalized positions.
  for (const [segIndex, openings] of bySegment) {
    if (!openings.length) continue
    const segBefore = segInfosBefore[segIndex]
    const segAfter = segInfosAfter[segIndex]
    if (!segAfter || segAfter.length < DISTANCE_EPS) continue

    const endpointMoved =
      movedSet.has(segIndex) || movedSet.has(segIndex + 1)
    const lengthChanged =
      !segBefore || Math.abs(segBefore.length - segAfter.length) > DISTANCE_EPS

    if (!endpointMoved && !lengthChanged) continue

    const fit = fitOpeningsInSegment(segAfter.length, openings)
    for (const o of openings) {
      const newCenterAlongSegment = fit.positionsByOpeningId.get(o.id)
      if (newCenterAlongSegment == null) continue
      const newCenterDist = segAfter.startDist + newCenterAlongSegment
      const newPosition = clamp(newCenterDist / newTotalLength, 0, 1)
      if (o.kind === 'door') {
        doorUpdates.push({ id: o.id, position: newPosition })
      } else {
        windowUpdates.push({ id: o.id, position: newPosition })
      }
    }
  }

  return {
    points: newPoints,
    doorUpdates,
    windowUpdates,
    wasClamped,
  }
}

/**
 * Validate that a wall's openings fit on their segments (no overlap, no over vertex).
 * Returns true if valid.
 */
export function validateWallOpenings(
  points: Point2[],
  doors: Door[],
  windows: Window[]
): boolean {
  const totalLength = getWallTotalLength(points)
  if (totalLength < DISTANCE_EPS) return true
  const bySegment = getOpeningsBySegment(points, doors, windows)
  for (const [segIndex, openings] of bySegment) {
    if (openings.length === 0) continue
    const segInfos = getSegmentInfos(points)
    const seg = segInfos[segIndex]
    if (!seg || seg.length < DISTANCE_EPS) return false
    const minLen = minSegmentLengthForOpenings(openings)
    if (seg.length < minLen - DISTANCE_EPS) return false
    const fit = fitOpeningsInSegment(seg.length, openings)
    if (fit.wasAdjusted) return false
  }
  return true
}
