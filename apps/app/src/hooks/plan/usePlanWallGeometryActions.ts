import type { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'
import type { usePlanGeometryGestureState } from '@/hooks/plan/usePlanGeometryGestureState'
import type React from 'react'
import { executePlanGeometryBatch } from '@/components/canvas/plan/planCanvasBindings'
import { useCallback } from 'react'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { type CommandInvocation } from '@/lib/commands/project'
import type { Wall, Point2, Door, Window } from '@/types/schema'
import { computeOpeningGeometry, getWallTotalLength } from '@/handlers/plan/wallDrawing'
import {
  getOpeningsBySegment,
  minSegmentLengthForOpenings,
  applyOpeningDistanceOnSegment,
  preserveOpeningPositionsAfterPointChange,
  adjustVerticesAndOpenings,
} from '@/lib/plan/constraints'
import { type DimensionDragModifiers } from '@/lib/plan/dimensionDragGesture'
import {
  buildWallSelectionDeletionPlan,
  splitWallPointsAtDeletedSegments,
} from '@/lib/plan/wallSelectionDeletion'
import { dragWallShapeDimension, resizeWallShapeSegment } from '@/lib/plan/wallShapeResize'

interface PlanWallGeometryActionsOptions {
  isFloorPlanMode: boolean
  activeFloor: import('@/types/schema').Floor | null | undefined
  viewportUI: import('zustand/vanilla').StoreApi<import('@/stores/uiStore').UIState>
  selectedSegmentIndices: Map<string, number[]>
  selectedPointIndices: Map<string, number[]>
  applySelectedPointIndices: React.Dispatch<React.SetStateAction<Map<string, number[]>>>
  applySelectedSegmentIndices: React.Dispatch<React.SetStateAction<Map<string, number[]>>>
  clearSelection: () => void
  canvasPxPerMeter: number
  updateWall: (
    wallId: string,
    updates: Partial<import('@/types/schema').Wall> & {
      doorUpdates?: { id: string; position: number }[] | undefined
      windowUpdates?: { id: string; position: number }[] | undefined
    }
  ) => void
  wallDimensionDragRef: ReturnType<typeof usePlanGeometryGestureState>['wallDimensionDragRef']
  applyPreviewWalls: ReturnType<typeof usePlanGeometryGestureState>['applyPreviewWalls']
  applyPreviewDoors: ReturnType<typeof usePlanGeometryGestureState>['applyPreviewDoors']
  applyPreviewWindows: ReturnType<typeof usePlanGeometryGestureState>['applyPreviewWindows']
  planView: import('@/types/ui').ViewState
  gridSize: ReturnType<typeof usePlanCanvasGeometry>['gridSize']
}

export function usePlanWallGeometryActions({
  isFloorPlanMode,
  activeFloor,
  viewportUI,
  selectedSegmentIndices,
  selectedPointIndices,
  applySelectedPointIndices,
  applySelectedSegmentIndices,
  clearSelection,
  canvasPxPerMeter,
  updateWall,
  wallDimensionDragRef,
  applyPreviewWalls,
  applyPreviewDoors,
  applyPreviewWindows,
  planView,
  gridSize,
}: PlanWallGeometryActionsOptions) {
  const deleteSelectedWallGeometry = useCallback((): boolean => {
    if (!isFloorPlanMode || !activeFloor?.floorPlan) return false
    const activeFloorPlan = activeFloor.floorPlan
    const activeFloorIdForDeletion = activeFloor.id
    const selectionState = viewportUI.getState().selection
    const hasGlobalWallSelection =
      selectionState.type === 'wall' || selectionState.type === 'wallPoint'
    // A segment click updates canvas-local state and global selection separately. Honor the
    // local segment immediately even if the global selection update has not rendered yet.
    if (!hasGlobalWallSelection && selectedSegmentIndices.size === 0) return false

    const selectedWallIds =
      selectionState.type === 'wall' ? selectionState.ids : Array.from(selectedPointIndices.keys())
    const deletionPlan = buildWallSelectionDeletionPlan({
      walls: activeFloorPlan.walls,
      selectedWallIds,
      selectedPointIndices,
      selectedSegmentIndices,
    })
    if (
      deletionPlan.wholeWallIds.length === 0 &&
      deletionPlan.pointIndicesByWall.size === 0 &&
      deletionPlan.segmentIndicesByWall.size === 0
    ) {
      return false
    }

    const commands: CommandInvocation[] = []
    const wallIdsToDelete = new Set(deletionPlan.wholeWallIds)
    for (const [wallId, indices] of deletionPlan.pointIndicesByWall.entries()) {
      const wall = activeFloorPlan.walls.find((entry: Wall) => entry.id === wallId)
      if (!wall) continue
      const indexSet = new Set(indices)
      const nextPoints = wall.points.filter((_: Point2, index: number) => !indexSet.has(index))
      if (nextPoints.length >= 2) {
        commands.push({
          id: 'properties.edit',
          input: { edits: [{ kind: 'wall', ids: [wallId], set: { points: nextPoints } }] },
        })
      } else wallIdsToDelete.add(wallId)
    }
    const replacementWalls: Array<{ points: Point2[]; thickness?: number }> = []
    for (const [wallId, indices] of deletionPlan.segmentIndicesByWall.entries()) {
      const wall = activeFloorPlan.walls.find((entry: Wall) => entry.id === wallId)
      if (!wall) continue
      wallIdsToDelete.add(wallId)
      replacementWalls.push(
        ...splitWallPointsAtDeletedSegments(wall.points, indices).map((points) => ({
          points,
          thickness: wall.thickness,
        }))
      )
    }
    if (wallIdsToDelete.size)
      commands.unshift({
        id: 'entities.delete',
        input: { refs: [...wallIdsToDelete].map((id) => ({ kind: 'wall' as const, id })) },
      })
    for (const wall of replacementWalls)
      commands.push({
        id: 'plan.createBuildingGeometry',
        input: { kind: 'wall', floorId: activeFloorIdForDeletion, ...wall },
      })
    if (!commands.length || !executePlanGeometryBatch(commands, 'delete-wall-selection'))
      return false

    applySelectedPointIndices(new Map())
    applySelectedSegmentIndices(new Map())
    clearSelection()
    return true
  }, [
    activeFloor,
    applySelectedPointIndices,
    applySelectedSegmentIndices,
    clearSelection,
    isFloorPlanMode,
    selectedPointIndices,
    selectedSegmentIndices,
    viewportUI,
  ])

  const commitWallSegmentLength = useCallback(
    (wallId: string, segmentIndex: number, lengthCm: number) => {
      const floorPlan = activeFloor?.floorPlan
      if (!floorPlan || !Number.isFinite(lengthCm) || lengthCm <= 0 || canvasPxPerMeter <= 0) {
        return
      }
      const wall = floorPlan.walls.find((entry: Wall) => entry.id === wallId)
      if (!wall) return
      const wallDoors = floorPlan.doors.filter((door: Door) => door.wallId === wallId)
      const wallWindows = floorPlan.windows.filter((window: Window) => window.wallId === wallId)
      const lengthSnapStep = canvasPxPerMeter / 1000
      const openingMinimum = minSegmentLengthForOpenings(
        getOpeningsBySegment(wall.points, wallDoors, wallWindows).get(segmentIndex) ?? []
      )
      const snappedLengthCm = Math.round(lengthCm * 10) / 10
      const requestedLength = (snappedLengthCm / 100) * canvasPxPerMeter
      const targetLength = Math.max(
        requestedLength,
        Math.ceil(openingMinimum / lengthSnapStep) * lengthSnapStep
      )
      const resize = resizeWallShapeSegment(wall.points, segmentIndex, targetLength, lengthSnapStep)
      if (!resize) return

      const constrained = adjustVerticesAndOpenings(
        wall.points,
        resize.points,
        wallDoors,
        wallWindows,
        resize.movedPointIndices
      )
      const constrainedOpeningIds = new Set([
        ...constrained.doorUpdates.map((update) => update.id),
        ...constrained.windowUpdates.map((update) => update.id),
      ])
      const preserved = preserveOpeningPositionsAfterPointChange(
        wall.points,
        constrained.points,
        wallDoors,
        wallWindows,
        constrainedOpeningIds
      )
      const doorUpdates = [...constrained.doorUpdates, ...preserved.doorUpdates]
      const windowUpdates = [...constrained.windowUpdates, ...preserved.windowUpdates]

      updateWall(wallId, { points: constrained.points, doorUpdates, windowUpdates })
    },
    [activeFloor?.floorPlan, canvasPxPerMeter, updateWall]
  )

  const commitWallOpeningDistance = useCallback(
    (wallId: string, openingId: string, side: 'start' | 'end', lengthCm: number) => {
      const floorPlan = activeFloor?.floorPlan
      if (!floorPlan || !Number.isFinite(lengthCm) || lengthCm < 0 || canvasPxPerMeter <= 0) {
        return
      }

      const wall = floorPlan.walls.find((entry: Wall) => entry.id === wallId)
      if (!wall) return
      const doors = floorPlan.doors.filter((door: Door) => door.wallId === wallId)
      const windows = floorPlan.windows.filter((window: Window) => window.wallId === wallId)
      const opening =
        doors.find((door) => door.id === openingId) ??
        windows.find((window) => window.id === openingId)
      if (!opening) return

      const geom = computeOpeningGeometry(wall.points, opening.position)
      if (!geom) return
      const segmentLength = geom.segmentEndDist - geom.segmentStartDist
      if (segmentLength <= 1e-6) return
      const segmentOpenings = getOpeningsBySegment(wall.points, doors, windows).get(
        geom.segmentIndex
      )
      if (!segmentOpenings) return

      const requestedDistance = (lengthCm / 100) * canvasPxPerMeter
      const openingIndex = segmentOpenings.findIndex((entry) => entry.id === openingId)
      if (openingIndex < 0) return
      const previous = segmentOpenings[openingIndex - 1]
      const next = segmentOpenings[openingIndex + 1]
      const leftBoundary = previous ? previous.centerAlongSegment + previous.width / 2 : 0
      const rightBoundary = next ? next.centerAlongSegment - next.width / 2 : segmentLength
      // The displayed interval can start/end at another opening, not only at a
      // wall vertex. Convert that interval-relative value to a segment-edge value
      // before applying the shared train-of-carts constraint.
      const distanceFromSegmentEdge =
        side === 'start'
          ? leftBoundary + requestedDistance
          : segmentLength - rightBoundary + requestedDistance
      const result = applyOpeningDistanceOnSegment({
        openingId,
        kind: doors.some((door) => door.id === openingId) ? 'door' : 'window',
        width: opening.width,
        segmentIndex: geom.segmentIndex,
        segmentStartDist: geom.segmentStartDist,
        segmentEndDist: geom.segmentEndDist,
        segmentLength,
        segmentOpenings,
        side,
        distance: distanceFromSegmentEdge,
      })

      const doorUpdates: Array<{ id: string; position: number }> = []
      const windowUpdates: Array<{ id: string; position: number }> = []
      const totalLength = getWallTotalLength(wall.points)
      if (totalLength <= 1e-6) return
      for (const [id, centerAlongSegment] of result.positionsByOpeningId) {
        const position = (geom.segmentStartDist + centerAlongSegment) / totalLength
        const existingDoor = doors.find((door) => door.id === id)
        const existingWindow = windows.find((window) => window.id === id)
        if (existingDoor && Math.abs(existingDoor.position - position) > 1e-6) {
          doorUpdates.push({ id, position })
        } else if (existingWindow && Math.abs(existingWindow.position - position) > 1e-6) {
          windowUpdates.push({ id, position })
        }
      }
      if (doorUpdates.length === 0 && windowUpdates.length === 0) return

      const edits = [
        ...doorUpdates.map((update) => ({
          kind: 'door' as const,
          ids: [update.id],
          set: { position: update.position },
        })),
        ...windowUpdates.map((update) => ({
          kind: 'window' as const,
          ids: [update.id],
          set: { position: update.position },
        })),
      ]
      runProjectCommand(
        'properties.edit',
        { edits },
        { label: 'move opening by distance', source: 'plan-canvas-geometry' }
      )
    },
    [activeFloor?.floorPlan, canvasPxPerMeter]
  )

  const handleWallDimensionDrag = useCallback(
    (
      wallId: string,
      segmentIndex: number,
      delta: Point2,
      phase: 'start' | 'preview' | 'commit' | 'cancel',
      modifiers: DimensionDragModifiers
    ) => {
      const floorPlan = activeFloor?.floorPlan
      if (!floorPlan) return

      if (phase === 'start') {
        const wall = floorPlan.walls.find((entry: Wall) => entry.id === wallId)
        if (!wall) return
        wallDimensionDragRef.current = {
          wall: { ...wall, points: wall.points.map((point) => ({ ...point })) },
          doors: floorPlan.doors
            .filter((door: Door) => door.wallId === wallId)
            .map((door: Door) => ({ ...door })),
          windows: floorPlan.windows
            .filter((window: Window) => window.wallId === wallId)
            .map((window: Window) => ({ ...window })),
          segmentIndex,
          minimumSegmentLength: minSegmentLengthForOpenings(
            getOpeningsBySegment(
              wall.points,
              floorPlan.doors.filter((door: Door) => door.wallId === wallId),
              floorPlan.windows.filter((window: Window) => window.wallId === wallId)
            ).get(segmentIndex) ?? []
          ),
          parallelDragDirection: null,
        }
        applyPreviewWalls(null)
        applyPreviewDoors(null)
        applyPreviewWindows(null)
        return
      }

      const drag = wallDimensionDragRef.current
      if (!drag || drag.wall.id !== wallId || drag.segmentIndex !== segmentIndex) return
      if (phase === 'cancel') {
        wallDimensionDragRef.current = null
        applyPreviewWalls(null)
        applyPreviewDoors(null)
        applyPreviewWindows(null)
        return
      }

      const segmentStart = drag.wall.points[segmentIndex]
      const segmentEnd = drag.wall.points[segmentIndex + 1]
      if (drag.parallelDragDirection == null && segmentStart && segmentEnd) {
        const segmentX = segmentEnd.x - segmentStart.x
        const segmentY = segmentEnd.y - segmentStart.y
        const segmentLength = Math.hypot(segmentX, segmentY)
        if (segmentLength > 1e-6) {
          const parallelDelta = (delta.x * segmentX + delta.y * segmentY) / segmentLength
          if (Math.abs(parallelDelta) > 1e-6) {
            drag.parallelDragDirection = parallelDelta < 0 ? -1 : 1
          }
        }
      }

      const resize = dragWallShapeDimension(
        drag.wall.points,
        segmentIndex,
        delta,
        planView.snapToGrid
          ? gridSize
          : modifiers.quantize
            ? canvasPxPerMeter / 10
            : canvasPxPerMeter / 1000,
        drag.minimumSegmentLength,
        drag.parallelDragDirection ?? undefined
      )
      if (!resize) return
      const constrained = adjustVerticesAndOpenings(
        drag.wall.points,
        resize.points,
        drag.doors,
        drag.windows,
        resize.movedPointIndices
      )
      const constrainedOpeningIds = new Set([
        ...constrained.doorUpdates.map((update) => update.id),
        ...constrained.windowUpdates.map((update) => update.id),
      ])
      const preserved = preserveOpeningPositionsAfterPointChange(
        drag.wall.points,
        constrained.points,
        drag.doors,
        drag.windows,
        constrainedOpeningIds
      )
      const doorUpdates = [...constrained.doorUpdates, ...preserved.doorUpdates]
      const windowUpdates = [...constrained.windowUpdates, ...preserved.windowUpdates]

      if (phase === 'preview') {
        applyPreviewWalls(new Map([[wallId, { ...drag.wall, points: constrained.points }]]))
        applyPreviewDoors(
          new Map(
            drag.doors.map((door) => {
              const update = doorUpdates.find((entry) => entry.id === door.id)
              return [door.id, update ? { ...door, position: update.position } : door]
            })
          )
        )
        applyPreviewWindows(
          new Map(
            drag.windows.map((window) => {
              const update = windowUpdates.find((entry) => entry.id === window.id)
              return [window.id, update ? { ...window, position: update.position } : window]
            })
          )
        )
        return
      }

      updateWall(wallId, { points: constrained.points, doorUpdates, windowUpdates })
      wallDimensionDragRef.current = null
      applyPreviewWalls(null)
      applyPreviewDoors(null)
      applyPreviewWindows(null)
    },
    [
      activeFloor?.floorPlan,
      canvasPxPerMeter,
      gridSize,
      planView.snapToGrid,
      updateWall,
      applyPreviewDoors,
      applyPreviewWalls,
      applyPreviewWindows,
      wallDimensionDragRef,
    ]
  )

  return {
    deleteSelectedWallGeometry,
    commitWallSegmentLength,
    commitWallOpeningDistance,
    handleWallDimensionDrag,
  }
}
