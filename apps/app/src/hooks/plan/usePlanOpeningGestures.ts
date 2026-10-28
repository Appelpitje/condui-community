import { useRef } from 'react'
import type { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'
import type { usePlanGeometryGestureState } from '@/hooks/plan/usePlanGeometryGestureState'
import { useCallback } from 'react'
import type { Wall, Point2, Door, Window } from '@/types/schema'
import { nowMs } from '@/utils/clock'
import { clamp } from '@/lib/geometry'
import { computeOpeningGeometry, getWallTotalLength } from '@/handlers/plan/wallDrawing'
import { applyOpeningMoveOnSegment } from '@/lib/plan/constraints'
import {
  fitOpeningPlacementForPreview,
  snapOpeningWidthToWholeCentimeters,
} from '@/lib/plan/openingPlacementDrag'
import {
  clampAnchoredDimensionResize,
  resizeDimensionFromDrag,
  resolveDimensionDrag,
  snapDimensionValue,
  type DimensionDragModifiers,
} from '@/lib/plan/dimensionDragGesture'
import { screenPxToCanvasUnits } from '@/constants/canvasConstants'

interface PlanOpeningGesturesOptions {
  doorDragRef: ReturnType<typeof usePlanGeometryGestureState>['doorDragRef']
  activeFloor: import('@/types/schema').Floor | null | undefined
  doorsForRender: ReturnType<typeof usePlanCanvasGeometry>['doorsForRender']
  windowsForRender: ReturnType<typeof usePlanCanvasGeometry>['windowsForRender']

  applyPreviewDoors: ReturnType<typeof usePlanGeometryGestureState>['applyPreviewDoors']
  baseDoors: ReturnType<typeof usePlanCanvasGeometry>['baseDoors']
  applyPreviewWindows: ReturnType<typeof usePlanGeometryGestureState>['applyPreviewWindows']
  baseWindows: ReturnType<typeof usePlanCanvasGeometry>['baseWindows']
  updateDoor: (doorId: string, updates: Partial<import('@/types/schema').Door>) => void
  updateWindow: (windowId: string, updates: Partial<import('@/types/schema').Window>) => void
  selectedOpeningForWidthEditor:
    import('@/hooks/plan/usePlanOpeningWidthEditor').PlanOpeningWidthEditorModel | null
  openingDimensionDragRef: ReturnType<typeof usePlanGeometryGestureState>['openingDimensionDragRef']
  planView: import('@/types/ui').ViewState
  canvasPxPerMeter: number
  gridSize: ReturnType<typeof usePlanCanvasGeometry>['gridSize']
}

export function usePlanOpeningGestures({
  doorDragRef,
  activeFloor,
  doorsForRender,
  windowsForRender,

  applyPreviewDoors,
  baseDoors,
  applyPreviewWindows,
  baseWindows,
  updateDoor,
  updateWindow,
  selectedOpeningForWidthEditor,
  openingDimensionDragRef,
  planView,
  canvasPxPerMeter,
  gridSize,
}: PlanOpeningGesturesOptions) {
  const lastDoorUpdateTimeRef = useRef<number>(0)
  const lastWindowUpdateTimeRef = useRef<number>(0)

  const applyOpeningMoveFromPointer = useCallback(
    (pointer: Point2, mode: 'preview' | 'commit') => {
      const dragState = doorDragRef.current
      if (!dragState || !activeFloor?.floorPlan) return

      const { kind, entityId, wallId, geom, handleEnd, handleOffsetFromCenter } = dragState
      const wall = (activeFloor.floorPlan.walls ?? []).find((w: Wall) => w.id === wallId)
      if (!wall || wall.points.length < 2) return

      const totalLength = getWallTotalLength(wall.points)
      if (totalLength < 1e-10) return

      // Collect all openings (doors + windows) on this wall, using the
      // current render state so previews are respected while dragging.
      type OpeningOnWall = {
        kind: 'door' | 'window'
        id: string
        width: number
        position: number
      }

      const wallDoors = (doorsForRender ?? []).filter((d) => d.wallId === wallId)
      const wallWindows = (windowsForRender ?? []).filter((w) => w.wallId === wallId)
      const allOpenings: OpeningOnWall[] = [
        ...wallDoors.map((d) => ({
          kind: 'door' as const,
          id: d.id,
          width: d.width,
          position: d.position,
        })),
        ...wallWindows.map((w) => ({
          kind: 'window' as const,
          id: w.id,
          width: w.width,
          position: w.position,
        })),
      ]

      if (!allOpenings.length) return

      // Constrain movement to the single wall segment where the drag
      // started, so openings cannot slide over corners.
      const segmentStart = geom.segmentStartDist
      const segmentEnd = geom.segmentEndDist
      const segmentLength = segmentEnd - segmentStart
      if (segmentLength <= 1e-6) return

      // Openings that live on this same segment, ordered along the segment.
      const segmentOpenings: Array<OpeningOnWall & { centerAlongSegment: number }> = []
      for (const o of allOpenings) {
        const g = computeOpeningGeometry(wall.points, o.position)
        if (!g || g.segmentIndex !== geom.segmentIndex) continue
        const centerAlongSegment = g.centerDist - segmentStart
        segmentOpenings.push({
          ...o,
          centerAlongSegment,
        })
      }

      if (!segmentOpenings.length) return

      segmentOpenings.sort((a, b) => a.centerAlongSegment - b.centerAlongSegment)

      const movingIndex = segmentOpenings.findIndex((o) => o.kind === kind && o.id === entityId)
      if (movingIndex === -1) return

      const moving = segmentOpenings[movingIndex]!

      // Project pointer onto the specific wall segment where the drag
      // started, so movement is strictly along that segment and cannot
      // jump across corners.
      const segStartPoint = wall.points[geom.segmentIndex]!
      const segEndPoint = wall.points[geom.segmentIndex + 1]!
      const segDx = segEndPoint.x - segStartPoint.x
      const segDy = segEndPoint.y - segStartPoint.y
      const segLenSq = segDx * segDx + segDy * segDy
      const segLen = Math.sqrt(segLenSq)
      let desiredCenterOnSegmentRaw = moving.centerAlongSegment
      if (segLenSq > 1e-10) {
        const t = Math.max(
          0,
          Math.min(
            1,
            ((pointer.x - segStartPoint.x) * segDx + (pointer.y - segStartPoint.y) * segDy) /
              segLenSq
          )
        )
        const projectedDist = t * segLen
        // Keep the grabbed handle under the cursor using actual visual handle offset (halfWidth + handleOffset).
        if (handleEnd === 'start') {
          desiredCenterOnSegmentRaw = projectedDist + handleOffsetFromCenter
        } else {
          desiredCenterOnSegmentRaw = projectedDist - handleOffsetFromCenter
        }
      }

      const segmentOpeningsForEngine = segmentOpenings.map((o) => ({
        id: o.id,
        kind: o.kind,
        width: o.width,
        centerDist: segmentStart + o.centerAlongSegment,
        centerAlongSegment: o.centerAlongSegment,
      }))
      const moveResult = applyOpeningMoveOnSegment({
        openingId: entityId,
        kind,
        width: moving.width,
        segmentIndex: geom.segmentIndex,
        segmentStartDist: segmentStart,
        segmentEndDist: segmentEnd,
        segmentLength,
        segmentOpenings: segmentOpeningsForEngine,
        desiredCenterAlongSegment: desiredCenterOnSegmentRaw,
      })

      const updatedPositions = new Map<string, number>()
      for (const [openingId, centerAlongSegment] of moveResult.positionsByOpeningId) {
        const centerAlongWall = segmentStart + centerAlongSegment
        const pos = totalLength > 0 ? centerAlongWall / totalLength : 0
        updatedPositions.set(openingId, pos)
      }

      const now = nowMs()
      const lastRef = kind === 'door' ? lastDoorUpdateTimeRef : lastWindowUpdateTimeRef
      if (mode === 'preview' && now - lastRef.current < 16) {
        return
      }
      lastRef.current = now

      if (mode === 'preview') {
        applyPreviewDoors((prev) => {
          const next = new Map(prev ?? undefined)
          for (const o of allOpenings) {
            if (o.kind !== 'door') continue
            const newPos = updatedPositions.get(o.id)
            const base =
              baseDoors.find((d) => d.id === o.id) ??
              (prev ? (prev.get(o.id) as Door | undefined) : undefined)
            if (!base) continue
            next.set(o.id, {
              ...base,
              position: newPos != null ? newPos : base.position,
            })
          }
          return next
        })
        applyPreviewWindows((prev) => {
          const next = new Map(prev ?? undefined)
          for (const o of allOpenings) {
            if (o.kind !== 'window') continue
            const newPos = updatedPositions.get(o.id)
            const base =
              baseWindows.find((w) => w.id === o.id) ??
              (prev ? (prev.get(o.id) as Window | undefined) : undefined)
            if (!base) continue
            next.set(o.id, {
              ...base,
              position: newPos != null ? newPos : base.position,
            })
          }
          return next
        })
      } else {
        applyPreviewDoors(null)
        applyPreviewWindows(null)
        for (const o of allOpenings) {
          const newPos = updatedPositions.get(o.id)
          if (newPos == null) continue
          if (o.kind === 'door') {
            updateDoor(o.id, { position: newPos })
          } else {
            updateWindow(o.id, { position: newPos })
          }
        }
        lastDoorUpdateTimeRef.current = 0
        lastWindowUpdateTimeRef.current = 0
      }
    },
    [
      activeFloor,
      baseDoors,
      baseWindows,
      doorsForRender,
      windowsForRender,
      updateDoor,
      updateWindow,
      doorDragRef,
      applyPreviewDoors,
      applyPreviewWindows,
    ]
  )

  const beginOpeningDimensionDrag = useCallback(
    (start: Point2, outwardNormal: Point2) => {
      if (!activeFloor?.floorPlan || !selectedOpeningForWidthEditor) return
      const { kind, id } = selectedOpeningForWidthEditor
      const opening =
        kind === 'door'
          ? baseDoors.find((door) => door.id === id)
          : baseWindows.find((window) => window.id === id)
      if (!opening) return
      const wall = activeFloor.floorPlan.walls.find(
        (candidate: Wall) => candidate.id === opening.wallId
      )
      if (!wall) return
      const geom = computeOpeningGeometry(wall.points, opening.position)
      if (!geom) return
      openingDimensionDragRef.current = {
        kind,
        entityId: id,
        wall,
        geom,
        start,
        outwardNormal,
        mode: null,
        baseWidth: opening.width,
        basePosition: opening.position,
        lastResult: null,
      }
    },
    [activeFloor, baseDoors, baseWindows, selectedOpeningForWidthEditor, openingDimensionDragRef]
  )

  const applyOpeningDimensionDrag = useCallback(
    (
      pointer: Point2,
      mode: 'preview' | 'commit',
      modifiers: DimensionDragModifiers = { precise: false, quantize: false }
    ) => {
      const drag = openingDimensionDragRef.current
      if (!drag) return
      const { wall, geom } = drag
      const effectivePointer = modifiers.precise
        ? {
            x: drag.start.x + (pointer.x - drag.start.x) * 0.1,
            y: drag.start.y + (pointer.y - drag.start.y) * 0.1,
          }
        : pointer
      const resolution = resolveDimensionDrag(
        drag.start,
        effectivePointer,
        geom.tangent,
        drag.outwardNormal,
        drag.mode,
        screenPxToCanvasUnits(planView.zoom, 5, 3, 10)
      )
      drag.mode = resolution.mode
      if (!resolution.mode) return

      const minimumWidth = Math.max(1, canvasPxPerMeter / 100)
      const rawResize = resizeDimensionFromDrag(drag.baseWidth, resolution, minimumWidth)
      const dimensionSnapStep = planView.snapToGrid
        ? gridSize
        : modifiers.quantize
          ? canvasPxPerMeter / 10
          : 0
      const width =
        dimensionSnapStep > 0
          ? snapDimensionValue(rawResize.width, dimensionSnapStep, minimumWidth)
          : snapOpeningWidthToWholeCentimeters(rawResize.width, canvasPxPerMeter)
      const segmentLength = geom.segmentEndDist - geom.segmentStartDist
      const boundedWidth = Math.min(width, Math.max(minimumWidth, segmentLength))
      const totalLength = getWallTotalLength(wall.points)
      const otherDoors =
        drag.kind === 'door' ? baseDoors.filter((door) => door.id !== drag.entityId) : baseDoors
      const otherWindows =
        drag.kind === 'window'
          ? baseWindows.filter((window) => window.id !== drag.entityId)
          : baseWindows
      let fitted: { width: number; position: number }

      if (resolution.mode === 'centered') {
        const halfWidth = boundedWidth / 2
        const desiredCenterDist = clamp(
          geom.segmentEndDist - halfWidth,
          geom.segmentStartDist + halfWidth,
          geom.centerDist
        )
        const segmentStart = wall.points[geom.segmentIndex]!
        const centerPoint = {
          x: segmentStart.x + geom.tangent.x * (desiredCenterDist - geom.segmentStartDist),
          y: segmentStart.y + geom.tangent.y * (desiredCenterDist - geom.segmentStartDist),
        }
        fitted = fitOpeningPlacementForPreview(
          wall,
          {
            width: boundedWidth,
            centerPoint,
            centerPosition: totalLength > 0 ? desiredCenterDist / totalLength : drag.basePosition,
            doorSwing: null,
            isDraggingAlongWall: false,
          },
          otherDoors,
          otherWindows
        )
      } else {
        const obstacleSpans = [...otherDoors, ...otherWindows].flatMap((opening) => {
          if (opening.wallId !== wall.id) return []
          const openingGeom = computeOpeningGeometry(wall.points, opening.position)
          if (!openingGeom || openingGeom.segmentIndex !== geom.segmentIndex) return []
          return [
            {
              start: openingGeom.centerDist - opening.width / 2,
              end: openingGeom.centerDist + opening.width / 2,
            },
          ]
        })
        const anchored = clampAnchoredDimensionResize(
          geom.centerDist,
          drag.baseWidth,
          boundedWidth,
          resolution.mode,
          minimumWidth,
          geom.segmentStartDist,
          geom.segmentEndDist,
          obstacleSpans
        )
        fitted = {
          width: anchored.width,
          position: totalLength > 0 ? anchored.center / totalLength : drag.basePosition,
        }
      }
      drag.lastResult = fitted

      if (mode === 'preview') {
        if (drag.kind === 'door') {
          const base = baseDoors.find((door) => door.id === drag.entityId)
          if (base) applyPreviewDoors(new Map([[base.id, { ...base, ...fitted }]]))
        } else {
          const base = baseWindows.find((window) => window.id === drag.entityId)
          if (base) applyPreviewWindows(new Map([[base.id, { ...base, ...fitted }]]))
        }
        return
      }

      applyPreviewDoors(null)
      applyPreviewWindows(null)
      if (drag.kind === 'door') updateDoor(drag.entityId, fitted)
      else updateWindow(drag.entityId, fitted)
    },
    [
      baseDoors,
      baseWindows,
      canvasPxPerMeter,
      gridSize,
      planView.snapToGrid,
      planView.zoom,
      updateDoor,
      updateWindow,
      applyPreviewDoors,
      applyPreviewWindows,
      openingDimensionDragRef,
    ]
  )

  const endOpeningDimensionDrag = useCallback(
    (pointer: Point2 | null, modifiers: DimensionDragModifiers) => {
      const drag = openingDimensionDragRef.current
      if (!drag) return
      if (pointer) applyOpeningDimensionDrag(pointer, 'commit', modifiers)
      else if (drag.lastResult) {
        applyPreviewDoors(null)
        applyPreviewWindows(null)
        if (drag.kind === 'door') updateDoor(drag.entityId, drag.lastResult)
        else updateWindow(drag.entityId, drag.lastResult)
      }
      openingDimensionDragRef.current = null
    },
    [
      applyOpeningDimensionDrag,
      updateDoor,
      updateWindow,
      applyPreviewDoors,
      applyPreviewWindows,
      openingDimensionDragRef,
    ]
  )

  return {
    applyOpeningMoveFromPointer,
    beginOpeningDimensionDrag,
    applyOpeningDimensionDrag,
    endOpeningDimensionDrag,
  }
}
