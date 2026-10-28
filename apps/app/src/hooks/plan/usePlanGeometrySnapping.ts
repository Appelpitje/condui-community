import type { usePlanGeometrySelection } from '@/hooks/plan/usePlanGeometrySelection'
import type { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'
import { PlanCanvasInputEvent } from '@/components/canvas/plan/planCanvasBindings'
import { useCallback, useMemo } from 'react'
import { getPlanCanvasPointSelectionBounds } from '@/lib/plan/planCanvasPointSelection'
import { getTouchPointHitRadiusCanvas } from '@/lib/canvas/touchHitZones'

import type { Point2 } from '@/types/schema'
import { isCurvedWall } from '@/lib/plan/wallCurve'
import { snapToGrid } from '@/utils/plan/gridSnap'
import {
  DRAW_TOOL_POINT_RADIUS_PX,
  DRAW_TOOL_POINT_RADIUS_PX_MAX,
  DRAW_TOOL_POINT_RADIUS_PX_MIN,
  DRAW_TOOL_PROJECTION_SNAP_ZONE_PX,
  DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MAX,
  DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MIN,
  DRAW_TOOL_GRID_SNAP_BREAKAWAY_PX,
  DRAW_TOOL_GRID_SNAP_BREAKAWAY_PX_MAX,
  DRAW_TOOL_GRID_SNAP_BREAKAWAY_PX_MIN,
  screenPxToCanvasUnits,
} from '@/constants/canvasConstants'

interface PlanGeometrySnappingOptions {
  gridSize: ReturnType<typeof usePlanCanvasGeometry>['gridSize']
  planView: import('@/types/ui').ViewState
  activeFloor: import('@/types/schema').Floor | null | undefined
  isFloorPlanMode: boolean
  selectedPointIndices: Map<string, number[]>
  selectedStairPointIndices: Map<string, number[]>
  wallsForRender: ReturnType<typeof usePlanCanvasGeometry>['wallsForRender']
  stairsForRender: ReturnType<typeof usePlanCanvasGeometry>['stairsForRender']
  activeTool: import('@/types/ui').PlanToolMode
  selection: import('@/types/ui').Selection
  selectedWallIds: ReturnType<typeof usePlanGeometrySelection>['selectedWallIds']
  touchPrimary: boolean
}

export function usePlanGeometrySnapping({
  gridSize,
  planView,
  activeFloor,
  isFloorPlanMode,
  selectedPointIndices,
  selectedStairPointIndices,
  wallsForRender,
  stairsForRender,
  activeTool,
  selection,
  selectedWallIds,
  touchPrimary,
}: PlanGeometrySnappingOptions) {
  const softSnapToGrid = useCallback(
    (point: Point2, enabled: boolean, axis?: 'x' | 'y'): Point2 => {
      if (!enabled) return point
      const gridPoint = snapToGrid(point, gridSize, planView.snapToGrid)
      const snapped =
        axis === 'x'
          ? { x: gridPoint.x, y: point.y }
          : axis === 'y'
            ? { x: point.x, y: gridPoint.y }
            : gridPoint
      const breakawayThreshold = screenPxToCanvasUnits(
        planView.zoom,
        DRAW_TOOL_GRID_SNAP_BREAKAWAY_PX,
        DRAW_TOOL_GRID_SNAP_BREAKAWAY_PX_MIN,
        DRAW_TOOL_GRID_SNAP_BREAKAWAY_PX_MAX
      )
      const dx = snapped.x - point.x
      const dy = snapped.y - point.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      return dist <= breakawayThreshold ? snapped : point
    },
    [gridSize, planView.snapToGrid, planView.zoom]
  )

  const resolveProjectedFloorSnap = useCallback(
    (
      point: Point2,
      excludedKeys: Set<string>
    ): { snappedPoint: Point2; guides: Array<{ from: Point2; to: Point2 }> } | null => {
      if (!activeFloor?.floorPlan || planView.snapToProjection === false) return null
      const projectionSnapZone = screenPxToCanvasUnits(
        planView.zoom,
        DRAW_TOOL_PROJECTION_SNAP_ZONE_PX,
        DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MIN,
        DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MAX
      )

      const anchors: Point2[] = []
      for (const wall of activeFloor.floorPlan.walls) {
        for (let pointIndex = 0; pointIndex < wall.points.length; pointIndex++) {
          if (excludedKeys.has(`w:${wall.id}:${pointIndex}`)) continue
          if (isCurvedWall(wall) && pointIndex === 1) continue
          const anchor = wall.points[pointIndex]
          if (anchor) anchors.push(anchor)
        }
      }
      for (const stair of activeFloor.floorPlan.stairs ?? []) {
        for (let pointIndex = 0; pointIndex < stair.points.length; pointIndex++) {
          if (excludedKeys.has(`s:${stair.id}:${pointIndex}`)) continue
          const anchor = stair.points[pointIndex]
          if (anchor) anchors.push(anchor)
        }
      }

      let bestVertical: { offset: number; anchor: Point2 } | null = null
      let bestHorizontal: { offset: number; anchor: Point2 } | null = null

      for (const anchor of anchors) {
        const dx = Math.abs(point.x - anchor.x)
        const dy = Math.abs(point.y - anchor.y)
        if (dx <= projectionSnapZone && (!bestVertical || dx < bestVertical.offset)) {
          bestVertical = { offset: dx, anchor }
        }
        if (dy <= projectionSnapZone && (!bestHorizontal || dy < bestHorizontal.offset)) {
          bestHorizontal = { offset: dy, anchor }
        }
      }

      if (!bestVertical && !bestHorizontal) return null

      const snappedPoint: Point2 = {
        x: bestVertical ? bestVertical.anchor.x : point.x,
        y: bestHorizontal ? bestHorizontal.anchor.y : point.y,
      }
      const guides: Array<{ from: Point2; to: Point2 }> = []
      if (bestVertical)
        guides.push({
          from: bestVertical.anchor,
          to: { x: bestVertical.anchor.x, y: snappedPoint.y },
        })
      if (bestHorizontal)
        guides.push({
          from: bestHorizontal.anchor,
          to: { x: snappedPoint.x, y: bestHorizontal.anchor.y },
        })
      return { snappedPoint, guides: guides.slice(0, 2) }
    },
    [activeFloor, planView.snapToProjection, planView.zoom]
  )

  const wallSelectionBounds = useMemo(() => {
    if (!isFloorPlanMode || !activeFloor?.floorPlan) return null
    if (selectedPointIndices.size === 0 && selectedStairPointIndices.size === 0) return null
    // Render bounds use preview geometry so the handles remain aligned during a drag.
    return getPlanCanvasPointSelectionBounds({
      wallPointIndices: selectedPointIndices,
      stairPointIndices: selectedStairPointIndices,
      walls: wallsForRender,
      stairs: stairsForRender,
    })
  }, [
    isFloorPlanMode,
    activeFloor,
    selectedPointIndices,
    selectedStairPointIndices,
    wallsForRender,
    stairsForRender,
  ])

  const makeCanvasPointFromEvent = useCallback(
    (e: PlanCanvasInputEvent): Point2 | null => {
      const stage = e.target.getStage()
      const pointer = stage?.getPointerPosition()
      if (!stage || !pointer) return null
      return {
        x: (pointer.x - planView.pan.x) / planView.zoom,
        y: (pointer.y - planView.pan.y) / planView.zoom,
      }
    },
    [planView.pan.x, planView.pan.y, planView.zoom]
  )
  const scopedWallIdForVertexSelection = useMemo(
    function () {
      if (activeTool !== 'select') return null
      if (selection.type === 'wall' && selection.ids.length === 1) {
        return selection.ids[0] ?? null
      }
      if (
        selection.type === 'wallPoint' &&
        selectedWallIds.length === 1 &&
        selectedStairPointIndices.size === 0
      ) {
        return selectedWallIds[0] ?? null
      }
      return null
    },
    [activeTool, selection.type, selection.ids, selectedWallIds, selectedStairPointIndices]
  )

  const resolveScopedPointTarget = useCallback(
    (
      wallId: string,
      pointIndex: number,
      e: PlanCanvasInputEvent
    ): { wallId: string; pointIndex: number } | null => {
      if (!scopedWallIdForVertexSelection) {
        return { wallId, pointIndex }
      }
      if (wallId === scopedWallIdForVertexSelection) {
        return { wallId, pointIndex }
      }
      const scopedWall = wallsForRender.find((w) => w.id === scopedWallIdForVertexSelection)
      if (!scopedWall || scopedWall.points.length === 0) return null
      const canvasPoint = makeCanvasPointFromEvent(e)
      if (!canvasPoint) return null
      const visualPickRadius = screenPxToCanvasUnits(
        planView.zoom,
        DRAW_TOOL_POINT_RADIUS_PX,
        DRAW_TOOL_POINT_RADIUS_PX_MIN,
        DRAW_TOOL_POINT_RADIUS_PX_MAX
      )
      const pointPickRadius = touchPrimary
        ? getTouchPointHitRadiusCanvas(planView.zoom, visualPickRadius)
        : visualPickRadius * 1.5
      const pointPickRadiusSq = pointPickRadius * pointPickRadius
      let nearestIndex = -1
      let nearestDistSq = Number.POSITIVE_INFINITY
      scopedWall.points.forEach((p, idx) => {
        const dx = p.x - canvasPoint.x
        const dy = p.y - canvasPoint.y
        const distSq = dx * dx + dy * dy
        if (distSq <= pointPickRadiusSq && distSq < nearestDistSq) {
          nearestDistSq = distSq
          nearestIndex = idx
        }
      })
      if (nearestIndex < 0) return null
      return { wallId: scopedWall.id, pointIndex: nearestIndex }
    },
    [
      scopedWallIdForVertexSelection,
      wallsForRender,
      makeCanvasPointFromEvent,
      planView.zoom,
      touchPrimary,
    ]
  )

  return {
    softSnapToGrid,
    resolveProjectedFloorSnap,
    wallSelectionBounds,
    makeCanvasPointFromEvent,
    scopedWallIdForVertexSelection,
    resolveScopedPointTarget,
  }
}
