import type React from 'react'
import { useCallback } from 'react'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import {
  handleInsertDoor,
  handleInsertWindow,
  validateOpeningPlacement,
  resolveWindowInsertWidthPx,
  computeOpeningGeometry,
} from '@/handlers/plan/wallDrawing'
import {
  openingWallNormalDeadzoneCanvas,
  resolveDoorPlacementOrientation,
} from '@/lib/plan/doorSwingFromPointer'
import {
  computeOpeningDragPlacement,
  fitOpeningPlacementForPreview,
  snapOpeningWidthToWholeCentimeters,
} from '@/lib/plan/openingPlacementDrag'
import type { Point2, Wall } from '@/types/schema'
import { isCurvedWall } from '@/lib/plan/wallCurve'
import { readLegacyCompatibilityFloors } from '@/lib/projectV2/buildingFloors'
import {
  OPENING_SPAN_CENTER_SNAP_ZONE_PX,
  OPENING_SPAN_CENTER_SNAP_ZONE_PX_MAX,
  OPENING_SPAN_CENTER_SNAP_ZONE_PX_MIN,
  screenPxToCanvasUnits,
} from '@/constants/canvasConstants'
import { resolveOpeningPositionSnap } from '@/lib/plan/openingPositionSnap'

interface FloorPlanOpeningPlacementOptions {
  activeFloorId: string | null
  getWallsByFloor: (floorId: string) => import('@/types/schema').Wall[]
  planView: import('@/types/ui').ViewState
  gridSize: number
  canvasPxPerMeter: number
  previewPxPerMeter: number | null
  activeFloor: import('@/types/schema').Floor | null | undefined
  doorPlacementOpenSideRef: React.RefObject<'left' | 'right'>
  currentProject: import('@/types/projectV2').ProjectV2 | null
  onOpeningInserted: ((kind: 'door' | 'window') => void) | undefined
  setSelection: (selection: import('@/types/ui').Selection) => void
}

export function useFloorPlanOpeningPlacement({
  activeFloorId,
  getWallsByFloor,
  planView,
  gridSize,
  canvasPxPerMeter,
  previewPxPerMeter,
  activeFloor,
  doorPlacementOpenSideRef,
  currentProject,
  onOpeningInserted,
  setSelection,
}: FloorPlanOpeningPlacementOptions) {
  const findClosestWallForOpening = useCallback((point: Point2, walls: Wall[]): Wall | null => {
    let closestWall: Wall | null = null
    let minDistance = Infinity
    for (const wall of walls) {
      if (isCurvedWall(wall)) continue
      for (let i = 0; i < wall.points.length - 1; i++) {
        const p1 = wall.points[i]
        const p2 = wall.points[i + 1]
        if (!p1 || !p2) continue
        const dx = p2.x - p1.x
        const dy = p2.y - p1.y
        const lengthSq = dx * dx + dy * dy
        if (lengthSq < 1e-10) continue
        const t = Math.max(
          0,
          Math.min(1, ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lengthSq)
        )
        const projX = p1.x + t * dx
        const projY = p1.y + t * dy
        const dist = Math.hypot(point.x - projX, point.y - projY)
        if (dist < minDistance && dist < 20) {
          minDistance = dist
          closestWall = wall
        }
      }
    }
    return closestWall
  }, [])

  const resolveOpeningAnchor = useCallback(
    (wall: Wall, pointer: Point2): Point2 =>
      resolveOpeningPositionSnap({
        wall,
        walls: activeFloorId ? getWallsByFloor(activeFloorId) : [wall],
        pointer,
        spanCenterRadius: screenPxToCanvasUnits(
          planView.zoom,
          OPENING_SPAN_CENTER_SNAP_ZONE_PX,
          OPENING_SPAN_CENTER_SNAP_ZONE_PX_MIN,
          OPENING_SPAN_CENTER_SNAP_ZONE_PX_MAX
        ),
        snapToGrid: planView.snapToGrid,
        gridSize,
      }).point,
    [activeFloorId, getWallsByFloor, gridSize, planView.snapToGrid, planView.zoom]
  )

  const getDefaultOpeningWidth = useCallback(
    (kind: 'door' | 'window') => {
      const doorWidthPx = snapOpeningWidthToWholeCentimeters(
        0.83 * canvasPxPerMeter,
        canvasPxPerMeter
      )
      const clickWindowWidthPx = 0.5 * canvasPxPerMeter
      const previewWindowWidthPx = previewPxPerMeter != null ? 0.5 * previewPxPerMeter : 100
      const windowWidthPx = snapOpeningWidthToWholeCentimeters(
        resolveWindowInsertWidthPx(clickWindowWidthPx, previewWindowWidthPx),
        canvasPxPerMeter
      )
      return kind === 'door' ? doorWidthPx : windowWidthPx
    },
    [canvasPxPerMeter, previewPxPerMeter]
  )

  const getOpeningPlacementOptions = useCallback(
    (kind: 'door' | 'window') => ({
      snapWidthToCm: true as const,
      canvasPxPerMeter,
      dragActivationThresholdPx: kind === 'door' ? 10 : 8,
      minimumWidthPx: kind === 'door' ? 0.5 * canvasPxPerMeter : 0.15 * canvasPxPerMeter,
    }),
    [canvasPxPerMeter]
  )

  const resolvePlacementDoorOrientation = useCallback(
    (
      wall: Wall,
      position: number,
      pointer: Point2,
      hingeSwing: 'left' | 'right' | null,
      options?: { useOpenSideDeadzone?: boolean }
    ) => {
      const geom = computeOpeningGeometry(wall.points, position)
      if (!geom || !activeFloorId) return null
      const floorPlan = activeFloor?.floorPlan
      if (!floorPlan) return null
      return resolveDoorPlacementOrientation({
        hingeSwing,
        center: geom.center,
        tangent: geom.tangent,
        pointer,
        walls: getWallsByFloor(activeFloorId),
        wall,
        masterWallThickness: floorPlan.masterWallThickness,
        pxPerMeter: canvasPxPerMeter,
        deadzonePx: openingWallNormalDeadzoneCanvas(planView.zoom),
        useOpenSideDeadzone: options?.useOpenSideDeadzone,
        lastOpenSide: doorPlacementOpenSideRef.current,
      })
    },
    [
      activeFloor,
      activeFloorId,
      canvasPxPerMeter,
      getWallsByFloor,
      planView.zoom,
      doorPlacementOpenSideRef,
    ]
  )

  const commitOpeningInsert = useCallback(
    (
      kind: 'door' | 'window',
      wall: Wall,
      anchor: Point2,
      current: Point2,
      defaultWidth: number,
      dragSizingLatched = false
    ) => {
      if (!activeFloorId) return
      const floorPlan = (currentProject ? readLegacyCompatibilityFloors(currentProject) : []).find(
        (f: { id: string }) => f.id === activeFloorId
      )?.floorPlan
      const doors = floorPlan?.doors ?? []
      const windows = floorPlan?.windows ?? []
      const placement = computeOpeningDragPlacement(wall, anchor, current, defaultWidth, 6, {
        ...getOpeningPlacementOptions(kind),
        forceDragSizing: dragSizingLatched,
      })
      const fitted = fitOpeningPlacementForPreview(wall, placement, doors, windows)
      const validation = validateOpeningPlacement(
        wall,
        placement.centerPoint,
        fitted.width,
        doors,
        windows
      )
      if (!validation.valid) return

      if (kind === 'door') {
        const result = handleInsertDoor(wall, placement.centerPoint, fitted.width)
        const orientation = resolvePlacementDoorOrientation(
          wall,
          fitted.position,
          current,
          placement.doorSwing,
          { useOpenSideDeadzone: false }
        )
        if (orientation) {
          doorPlacementOpenSideRef.current = orientation.openSide
        }
        const outcome = runProjectCommand(
          'plan.createBuildingGeometry',
          {
            kind: 'door',
            floorId: activeFloorId,
            wallId: wall.id,
            position: fitted.position,
            width: result.door.width,
            ...(orientation ? { swing: orientation.swing, direction: orientation.direction } : {}),
          },
          { label: 'add door', source: 'floor-plan-drawing' }
        )
        if (!outcome?.changed) return
        onOpeningInserted?.('door')
        const insertedDoor = outcome.results[0]?.created.find((ref) => ref.kind === 'door')
        if (insertedDoor) setSelection({ type: 'door', ids: [insertedDoor.id] })
        return
      }

      const result = handleInsertWindow(wall, placement.centerPoint, fitted.width)
      const outcome = runProjectCommand(
        'plan.createBuildingGeometry',
        {
          kind: 'window',
          floorId: activeFloorId,
          wallId: wall.id,
          position: fitted.position,
          width: result.window.width,
        },
        { label: 'add window', source: 'floor-plan-drawing' }
      )
      if (!outcome?.changed) return
      onOpeningInserted?.('window')
      const insertedWindow = outcome.results[0]?.created.find((ref) => ref.kind === 'window')
      if (insertedWindow) setSelection({ type: 'window', ids: [insertedWindow.id] })
    },
    [
      activeFloorId,
      currentProject,
      setSelection,
      onOpeningInserted,
      resolvePlacementDoorOrientation,
      getOpeningPlacementOptions,
      doorPlacementOpenSideRef,
    ]
  )

  return {
    findClosestWallForOpening,
    resolveOpeningAnchor,
    getDefaultOpeningWidth,
    getOpeningPlacementOptions,
    resolvePlacementDoorOrientation,
    commitOpeningInsert,
  }
}
