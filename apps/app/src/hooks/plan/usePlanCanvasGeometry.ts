import type { usePlanGeometryGestureState } from '@/hooks/plan/usePlanGeometryGestureState'
import { useCallback, useRef, useState, useMemo, useLayoutEffect } from 'react'
import type { Wall, Point2, Door, Window, Stair, PlanGraphicElement } from '@/types/schema'
import { getWallPathPoints, isCurvedWall } from '@/lib/plan/wallCurve'
import { snapPlacementCenterToGrid } from '@/utils/plan/gridSnap'
import { usePlanScale, usePlanGrid } from '@/hooks/plan'
import { calculatePxPerMeter } from '@/hooks/plan/usePlanScale'
import {
  DRAW_TOOL_LINE_SNAP_ZONE_PX,
  DRAW_TOOL_LINE_SNAP_ZONE_PX_MAX,
  DRAW_TOOL_LINE_SNAP_ZONE_PX_MIN,
  screenPxToCanvasUnits,
} from '@/constants/canvasConstants'
import {
  snapNearbyLineToGrid,
  snapPointToNearbyLine,
  snapPointToNearbyLineOnAxis,
  type LineSnapSegment,
} from '@/lib/plan/lineSnap'
import { getPlanZoomMinimum } from '@/lib/plan/planZoom'

interface PlanCanvasGeometryOptions {
  activeFloor: import('@/types/schema').Floor | null | undefined
  tempPxPerMeter: number | null
  previewWalls: ReturnType<typeof usePlanGeometryGestureState>['previewWalls']
  selectionPreview: ReturnType<typeof usePlanGeometryGestureState>['selectionPreview']
  previewDoors: ReturnType<typeof usePlanGeometryGestureState>['previewDoors']
  previewWindows: ReturnType<typeof usePlanGeometryGestureState>['previewWindows']
  planView: import('@/types/ui').ViewState
  isFloorPlanMode: boolean
}

export function usePlanCanvasGeometry({
  activeFloor,
  tempPxPerMeter,
  previewWalls,
  selectionPreview,
  previewDoors,
  previewWindows,
  planView,
  isFloorPlanMode,
}: PlanCanvasGeometryOptions) {
  const baseWalls: Wall[] = useMemo(
    () => activeFloor?.floorPlan?.walls ?? [],
    [activeFloor?.floorPlan?.walls]
  )
  const baseDoors: Door[] = useMemo(
    () => activeFloor?.floorPlan?.doors ?? [],
    [activeFloor?.floorPlan?.doors]
  )
  const baseWindows: Window[] = useMemo(
    () => activeFloor?.floorPlan?.windows ?? [],
    [activeFloor?.floorPlan?.windows]
  )
  const graphicElementsForRender = useMemo<PlanGraphicElement[]>(
    () => activeFloor?.floorPlan?.graphicElements ?? [],
    [activeFloor?.floorPlan?.graphicElements]
  )

  // Use hooks for scale, placements, labels, image, and grid
  const { pxPerMeter, baseSymbolSizePx, planLabelFontSize } = usePlanScale(
    activeFloor ?? null,
    tempPxPerMeter
  )
  // The zoom floor follows the committed calibration; preview scaling during
  // ruler editing must not change the navigation range before the user accepts it.
  const committedPxPerMeter = activeFloor?.planScaleNeedsCalibration
    ? null
    : calculatePxPerMeter(activeFloor ?? null)
  const planMinZoom = getPlanZoomMinimum(committedPxPerMeter)

  const wallsForRender = useMemo(
    function () {
      let walls: Wall[] = baseWalls
      if (previewWalls && previewWalls.size > 0) {
        walls = walls.map((w) => previewWalls.get(w.id) ?? w)
      }
      const previewMap = selectionPreview.walls
      if (previewMap.size > 0) {
        walls = walls.map((w) => {
          const pts = previewMap.get(w.id)
          return pts ? { ...w, points: pts } : w
        })
      }
      return walls
    },
    [baseWalls, previewWalls, selectionPreview.walls]
  )

  const doorsForRender = useMemo(
    function () {
      if (!previewDoors || previewDoors.size === 0) return baseDoors
      return baseDoors.map((d) => previewDoors.get(d.id) ?? d)
    },
    [baseDoors, previewDoors]
  )

  const windowsForRender = useMemo(
    function () {
      if (!previewWindows || previewWindows.size === 0) return baseWindows
      return baseWindows.map((w) => previewWindows.get(w.id) ?? w)
    },
    [baseWindows, previewWindows]
  )
  const stairsForRender: Stair[] = useMemo(
    function () {
      const base: Stair[] = activeFloor?.floorPlan?.stairs ?? []
      const previewMap = selectionPreview.stairs
      if (previewMap.size === 0) return base
      return base.map((stair) => {
        const pts = previewMap.get(stair.id)
        return pts ? { ...stair, points: pts } : stair
      })
    },
    [activeFloor?.floorPlan?.stairs, selectionPreview.stairs]
  )
  const [spiralRotationPreview, setSpiralRotationPreview] = useState<{
    stairId: string
    rotationDeg: number
  } | null>(null)

  const gridSize = usePlanGrid(activeFloor ?? null, planView, isFloorPlanMode, tempPxPerMeter)
  const snapFloorPlan = activeFloor?.floorPlan
  const resolveNearbyFloorLineSnap = useCallback(
    (point: Point2, excludedKeys: Set<string> = new Set(), axis?: 'x' | 'y') => {
      if (!snapFloorPlan) return null
      const radius = screenPxToCanvasUnits(
        planView.zoom,
        DRAW_TOOL_LINE_SNAP_ZONE_PX,
        DRAW_TOOL_LINE_SNAP_ZONE_PX_MIN,
        DRAW_TOOL_LINE_SNAP_ZONE_PX_MAX
      )
      const segments: LineSnapSegment[] = []
      const appendSegments = (kind: 'w' | 's', id: string, points: Point2[]) => {
        for (let index = 0; index < points.length - 1; index += 1) {
          if (
            excludedKeys.has(`${kind}:${id}:${index}`) ||
            excludedKeys.has(`${kind}:${id}:${index + 1}`)
          ) {
            continue
          }
          const a = points[index]
          const b = points[index + 1]
          if (a && b) segments.push({ a, b })
        }
      }

      for (const wall of snapFloorPlan.walls) {
        const excludesWallPoint = wall.points.some((_point, index) =>
          excludedKeys.has(`w:${wall.id}:${index}`)
        )
        if (isCurvedWall(wall) && excludesWallPoint) continue
        appendSegments('w', wall.id, getWallPathPoints(wall))
      }
      for (const stair of snapFloorPlan.stairs ?? []) {
        appendSegments('s', stair.id, stair.points)
      }

      const nearbyLine = axis
        ? snapPointToNearbyLineOnAxis(point, segments, radius, axis)
        : snapPointToNearbyLine(point, segments, radius)
      if (!nearbyLine) return null
      // A constrained move has no spare axis for grid snap: the line owns the
      // moving coordinate and the movement rail owns the locked coordinate.
      return axis ? nearbyLine : snapNearbyLineToGrid(nearbyLine, gridSize, planView.snapToGrid)
    },
    [snapFloorPlan, gridSize, planView.snapToGrid, planView.zoom]
  )
  const snapPlacementPosition = useCallback(
    (point: Point2) =>
      resolveNearbyFloorLineSnap(point)?.point ??
      snapPlacementCenterToGrid(point, gridSize, planView.snapToGrid),
    [gridSize, planView.snapToGrid, resolveNearbyFloorLineSnap]
  )
  const latestSnapPlacementPositionRef = useRef(snapPlacementPosition)
  useLayoutEffect(() => {
    latestSnapPlacementPositionRef.current = snapPlacementPosition
  }, [snapPlacementPosition])
  const stableSnapPlacementPosition = useCallback(
    (point: Point2) => latestSnapPlacementPositionRef.current(point),
    []
  )

  return {
    baseWalls,
    baseDoors,
    baseWindows,
    graphicElementsForRender,
    pxPerMeter,
    baseSymbolSizePx,
    planLabelFontSize,
    planMinZoom,
    wallsForRender,
    doorsForRender,
    windowsForRender,
    stairsForRender,
    spiralRotationPreview,
    setSpiralRotationPreview,
    gridSize,
    resolveNearbyFloorLineSnap,
    snapPlacementPosition,
    stableSnapPlacementPosition,
  }
}
