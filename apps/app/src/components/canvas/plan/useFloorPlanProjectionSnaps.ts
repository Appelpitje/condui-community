import { useCallback } from 'react'
import type { Point2, Wall } from '@/types/schema'
import { getWallPathPoints, isCurvedWall } from '@/lib/plan/wallCurve'
import {
  DRAW_TOOL_PROJECTION_SNAP_ZONE_PX,
  DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MAX,
  DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MIN,
  DRAW_TOOL_LINE_SNAP_ZONE_PX,
  DRAW_TOOL_LINE_SNAP_ZONE_PX_MAX,
  DRAW_TOOL_LINE_SNAP_ZONE_PX_MIN,
  screenPxToCanvasUnits,
} from '@/constants/canvasConstants'
import {
  snapNearbyLineToGrid,
  snapPointToNearbyLine,
  type LineSnapSegment,
} from '@/lib/plan/lineSnap'

interface FloorPlanProjectionSnapsOptions {
  pointsMatch: (
    a: import('@/types/schema').Point2,
    b: import('@/types/schema').Point2,
    epsilon?: number
  ) => boolean
  planView: import('@/types/ui').ViewState
  activeFloor: import('@/types/schema').Floor | null | undefined
  wallDrawingState: {
    currentPoints: import('@/types/schema').Point2[]
    isDrawing: boolean
    startPoint: import('@/types/schema').Point2 | null
    rectStartPoint: import('@/types/schema').Point2 | null
    pendingCurve?: boolean | undefined
  }
  stairDrawingPoints: import('@/types/schema').Point2[]
  gridSize: number
}

export function useFloorPlanProjectionSnaps({
  pointsMatch,
  planView,
  activeFloor,
  wallDrawingState,
  stairDrawingPoints,
  gridSize,
}: FloorPlanProjectionSnapsOptions) {
  const segmentIntersectionPoint = useCallback(
    (a: Point2, b: Point2, c: Point2, d: Point2): Point2 | null => {
      const r = { x: b.x - a.x, y: b.y - a.y }
      const s = { x: d.x - c.x, y: d.y - c.y }
      const rxs = r.x * s.y - r.y * s.x
      const cma = { x: c.x - a.x, y: c.y - a.y }
      const qpxr = cma.x * r.y - cma.y * r.x
      const epsilon = 1e-8
      if (Math.abs(rxs) <= epsilon) return null
      const t = (cma.x * s.y - cma.y * s.x) / rxs
      const u = qpxr / rxs
      if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) return null
      return {
        x: a.x + t * r.x,
        y: a.y + t * r.y,
      }
    },
    []
  )

  const isProjectionPathObstructed = useCallback(
    (from: Point2, to: Point2, segments: Array<{ a: Point2; b: Point2 }>) => {
      for (const seg of segments) {
        const hit = segmentIntersectionPoint(from, to, seg.a, seg.b)
        if (!hit) continue
        // Endpoint touches are allowed: snapping exactly onto anchors / current point.
        if (pointsMatch(hit, from) || pointsMatch(hit, to)) continue
        return true
      }
      return false
    },
    [segmentIntersectionPoint, pointsMatch]
  )

  const resolveNearbyLineSnap = useCallback(
    (
      point: Point2,
      options?: {
        excludeCurrentTail?: 'drawWall' | 'drawStair'
        excludeDraftPoint?: { tool: 'drawWall' | 'drawStair'; index: number }
      }
    ) => {
      const radius = screenPxToCanvasUnits(
        planView.zoom,
        DRAW_TOOL_LINE_SNAP_ZONE_PX,
        DRAW_TOOL_LINE_SNAP_ZONE_PX_MIN,
        DRAW_TOOL_LINE_SNAP_ZONE_PX_MAX
      )
      const segments: LineSnapSegment[] = []
      const appendSegments = (points: Point2[], tool?: 'drawWall' | 'drawStair') => {
        for (let index = 0; index < points.length - 1; index += 1) {
          if (tool && options?.excludeCurrentTail === tool && index === points.length - 2) {
            continue
          }
          const excludedDraftPoint = options?.excludeDraftPoint
          if (
            tool &&
            excludedDraftPoint?.tool === tool &&
            (index === excludedDraftPoint.index || index + 1 === excludedDraftPoint.index)
          ) {
            continue
          }
          const a = points[index]
          const b = points[index + 1]
          if (a && b) segments.push({ a, b })
        }
      }

      for (const wall of activeFloor?.floorPlan?.walls ?? [])
        appendSegments(getWallPathPoints(wall))
      for (const stair of activeFloor?.floorPlan?.stairs ?? []) appendSegments(stair.points)
      appendSegments(wallDrawingState.currentPoints, 'drawWall')
      appendSegments(stairDrawingPoints, 'drawStair')

      const nearbyLine = snapPointToNearbyLine(point, segments, radius)
      return nearbyLine ? snapNearbyLineToGrid(nearbyLine, gridSize, planView.snapToGrid) : null
    },
    [
      activeFloor?.floorPlan?.walls,
      activeFloor?.floorPlan?.stairs,
      gridSize,
      planView.snapToGrid,
      planView.zoom,
      stairDrawingPoints,
      wallDrawingState.currentPoints,
    ]
  )

  const resolveProjectedPenSnap = useCallback(
    (point: Point2, walls: Wall[]) => {
      const projectionSnapZone = screenPxToCanvasUnits(
        planView.zoom,
        DRAW_TOOL_PROJECTION_SNAP_ZONE_PX,
        DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MIN,
        DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MAX
      )
      const anchors: Point2[] = []
      for (const p of wallDrawingState.currentPoints) anchors.push(p)
      for (const wall of walls) {
        wall.points.forEach((p, index) => {
          if (!isCurvedWall(wall) || index !== 1) anchors.push(p)
        })
      }

      const segments: Array<{ a: Point2; b: Point2 }> = []
      for (const wall of walls) {
        const pathPoints = getWallPathPoints(wall)
        for (let i = 0; i < pathPoints.length - 1; i++) {
          const a = pathPoints[i]
          const b = pathPoints[i + 1]
          if (!a || !b) continue
          segments.push({ a, b })
        }
      }
      for (let i = 0; i < wallDrawingState.currentPoints.length - 1; i++) {
        const a = wallDrawingState.currentPoints[i]
        const b = wallDrawingState.currentPoints[i + 1]
        if (!a || !b) continue
        segments.push({ a, b })
      }

      let bestVertical: {
        offset: number
        distanceToAnchor: number
        anchor: Point2
      } | null = null
      let bestHorizontal: {
        offset: number
        distanceToAnchor: number
        anchor: Point2
      } | null = null

      for (const anchor of anchors) {
        if (pointsMatch(anchor, point)) continue
        const dx = Math.abs(point.x - anchor.x)
        const dy = Math.abs(point.y - anchor.y)
        if (dx <= projectionSnapZone) {
          const snapped = { x: anchor.x, y: point.y }
          if (!isProjectionPathObstructed(snapped, anchor, segments)) {
            const distanceToAnchor = Math.hypot(snapped.x - anchor.x, snapped.y - anchor.y)
            const isBetter =
              !bestVertical ||
              dx < bestVertical.offset ||
              (Math.abs(dx - bestVertical.offset) <= 1e-6 &&
                distanceToAnchor < bestVertical.distanceToAnchor)
            if (isBetter) {
              bestVertical = { offset: dx, distanceToAnchor, anchor }
            }
          }
        }
        if (dy <= projectionSnapZone) {
          const snapped = { x: point.x, y: anchor.y }
          if (!isProjectionPathObstructed(snapped, anchor, segments)) {
            const distanceToAnchor = Math.hypot(snapped.x - anchor.x, snapped.y - anchor.y)
            const isBetter =
              !bestHorizontal ||
              dy < bestHorizontal.offset ||
              (Math.abs(dy - bestHorizontal.offset) <= 1e-6 &&
                distanceToAnchor < bestHorizontal.distanceToAnchor)
            if (isBetter) {
              bestHorizontal = { offset: dy, distanceToAnchor, anchor }
            }
          }
        }
      }
      if (!bestVertical && !bestHorizontal) return null

      const snappedPoint: Point2 = {
        x: bestVertical ? bestVertical.anchor.x : point.x,
        y: bestHorizontal ? bestHorizontal.anchor.y : point.y,
      }

      const results: Array<{ snappedPoint: Point2; guideFrom: Point2; guideTo: Point2 }> = []
      if (bestVertical) {
        results.push({
          snappedPoint,
          guideFrom: bestVertical.anchor,
          guideTo: { x: bestVertical.anchor.x, y: snappedPoint.y },
        })
      }
      if (bestHorizontal) {
        results.push({
          snappedPoint,
          guideFrom: bestHorizontal.anchor,
          guideTo: { x: snappedPoint.x, y: bestHorizontal.anchor.y },
        })
      }
      return results.slice(0, 2)
    },
    [wallDrawingState.currentPoints, planView.zoom, pointsMatch, isProjectionPathObstructed]
  )

  return { resolveNearbyLineSnap, resolveProjectedPenSnap }
}
