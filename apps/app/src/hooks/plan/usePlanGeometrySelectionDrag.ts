import type { usePlanGeometrySnapping } from '@/hooks/plan/usePlanGeometrySnapping'
import type { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'
import type { usePlanWallVertexGestures } from '@/hooks/plan/usePlanWallVertexGestures'
import type { usePlanGeometryGestureState } from '@/hooks/plan/usePlanGeometryGestureState'
import type { usePlanGeometrySelection } from '@/hooks/plan/usePlanGeometrySelection'
import type React from 'react'
import { useCallback } from 'react'
import type { Wall, Point2, Door, Window, Stair } from '@/types/schema'
import { nowMs } from '@/utils/clock'
import {
  getOpeningsBySegment,
  preserveOpeningPositionsAfterPointChange,
  sanitizeWallOpeningPositions,
  isRigidTranslation,
} from '@/lib/plan/constraints'
import type { OpeningOnSegment } from '@/lib/plan/constraints'

interface PlanGeometrySelectionDragOptions {
  activeFloor: import('@/types/schema').Floor | null | undefined
  selectedWallIds: ReturnType<typeof usePlanGeometrySelection>['selectedWallIds']
  selectedStairPointIndices: Map<string, number[]>
  wallSelectionPreviewRef: ReturnType<typeof usePlanGeometryGestureState>['wallSelectionPreviewRef']
  stairSelectionPreviewRef: ReturnType<
    typeof usePlanGeometryGestureState
  >['stairSelectionPreviewRef']
  selectedPointIndices: Map<string, number[]>
  wallSelectionDragRef: ReturnType<typeof usePlanGeometryGestureState>['wallSelectionDragRef']
  vertexDragAnchorRef: ReturnType<typeof usePlanGeometryGestureState>['vertexDragAnchorRef']
  vertexDragInitialPointsRef: ReturnType<
    typeof usePlanGeometryGestureState
  >['vertexDragInitialPointsRef']
  pointDragTargetsRef: ReturnType<typeof usePlanGeometryGestureState>['pointDragTargetsRef']
  buildMergedPointTargets: ReturnType<typeof usePlanWallVertexGestures>['buildMergedPointTargets']
  baseDoors: ReturnType<typeof usePlanCanvasGeometry>['baseDoors']
  baseWindows: ReturnType<typeof usePlanCanvasGeometry>['baseWindows']
  vertexDragInitialOpeningsRef: ReturnType<
    typeof usePlanGeometryGestureState
  >['vertexDragInitialOpeningsRef']
  updateStair: (stairId: string, updates: Partial<import('@/types/schema').Stair>) => void
  applySelectionPreview: ReturnType<typeof usePlanGeometryGestureState>['applySelectionPreview']
  resolveNearbyFloorLineSnap: ReturnType<typeof usePlanCanvasGeometry>['resolveNearbyFloorLineSnap']
  resolveProjectedFloorSnap: ReturnType<typeof usePlanGeometrySnapping>['resolveProjectedFloorSnap']
  softSnapToGrid: ReturnType<typeof usePlanGeometrySnapping>['softSnapToGrid']
  planView: import('@/types/ui').ViewState
  stairPointDragRef: ReturnType<typeof usePlanGeometryGestureState>['stairPointDragRef']
  selection: import('@/types/ui').Selection
  applyVertexMoveProjectedSnapGuides: React.Dispatch<
    React.SetStateAction<
      {
        from: import('@/types/schema').Point2
        to: import('@/types/schema').Point2
        hideDistanceLabel?: boolean | undefined
      }[]
    >
  >
  lastWallSelectionUpdateTimeRef: React.RefObject<number>
  applyMergedPointMove: ReturnType<typeof usePlanWallVertexGestures>['applyMergedPointMove']
  applyPreviewWalls: ReturnType<typeof usePlanGeometryGestureState>['applyPreviewWalls']
  applyPreviewDoors: ReturnType<typeof usePlanGeometryGestureState>['applyPreviewDoors']
  applyPreviewWindows: ReturnType<typeof usePlanGeometryGestureState>['applyPreviewWindows']
  updateWall: (
    wallId: string,
    updates: Partial<import('@/types/schema').Wall> & {
      doorUpdates?: { id: string; position: number }[] | undefined
      windowUpdates?: { id: string; position: number }[] | undefined
    }
  ) => void

  selectedStair: ReturnType<typeof usePlanGeometrySelection>['selectedStair']
  stairSelectionDragRef: ReturnType<typeof usePlanGeometryGestureState>['stairSelectionDragRef']
  selectedStairPointIndex: ReturnType<typeof usePlanGeometrySelection>['selectedStairPointIndex']
}

export function usePlanGeometrySelectionDrag({
  activeFloor,
  selectedWallIds,
  selectedStairPointIndices,
  wallSelectionPreviewRef,
  stairSelectionPreviewRef,
  selectedPointIndices,
  wallSelectionDragRef,
  vertexDragAnchorRef,
  vertexDragInitialPointsRef,
  pointDragTargetsRef,
  buildMergedPointTargets,
  baseDoors,
  baseWindows,
  vertexDragInitialOpeningsRef,
  updateStair,
  applySelectionPreview,
  resolveNearbyFloorLineSnap,
  resolveProjectedFloorSnap,
  softSnapToGrid,
  planView,
  stairPointDragRef,
  selection,
  applyVertexMoveProjectedSnapGuides,
  lastWallSelectionUpdateTimeRef,
  applyMergedPointMove,
  applyPreviewWalls,
  applyPreviewDoors,
  applyPreviewWindows,
  updateWall,
  selectedStair,
  stairSelectionDragRef,
  selectedStairPointIndex,
}: PlanGeometrySelectionDragOptions) {
  const floorStairs = activeFloor?.floorPlan?.stairs

  const beginWallSelectionDrag = useCallback(
    (start: Point2, mode: 'free' | 'horizontal' | 'vertical' = 'free') => {
      if (!activeFloor?.floorPlan) return
      if (selectedWallIds.length === 0 && selectedStairPointIndices.size === 0) return
      // Start fresh selection preview geometry.
      wallSelectionPreviewRef.current = new Map()
      stairSelectionPreviewRef.current = new Map()
      const wallsById = new Map<string, Wall>(
        activeFloor.floorPlan.walls.map((w: Wall) => [w.id, w as Wall])
      )
      const stairsById = new Map<string, Stair>(
        (activeFloor.floorPlan.stairs ?? []).map((stair: Stair) => [stair.id, stair as Stair])
      )
      const initialPointsByWall = new Map<string, Point2[]>()
      const indicesByWall = new Map<string, Set<number>>()
      const initialPointsByStair = new Map<string, Point2[]>()
      const indicesByStair = new Map<string, Set<number>>()

      for (const wallId of selectedWallIds) {
        const wall = wallsById.get(wallId)
        if (!wall) continue
        initialPointsByWall.set(
          wallId,
          wall.points.map((p: Point2) => ({ x: p.x, y: p.y }))
        )
        const explicit = selectedPointIndices.get(wallId)
        const indices =
          explicit && explicit.length
            ? new Set<number>(explicit)
            : new Set<number>(wall.points.map((_, idx) => idx))
        indicesByWall.set(wallId, indices)
      }

      for (const [stairId, explicit] of selectedStairPointIndices.entries()) {
        const stair = stairsById.get(stairId)
        if (!stair || explicit.length === 0) continue
        initialPointsByStair.set(
          stairId,
          stair.points.map((p: Point2) => ({ x: p.x, y: p.y }))
        )
        indicesByStair.set(stairId, new Set<number>(explicit))
      }

      // Whole-shape move = rigid delta (no constraints) only when all points of every affected wall are selected.
      let isWholeShapeMove = true
      for (const [wallId, indices] of indicesByWall.entries()) {
        const wall = wallsById.get(wallId)
        if (wall && indices.size !== wall.points.length) {
          isWholeShapeMove = false
          break
        }
      }

      wallSelectionDragRef.current = {
        start,
        initialPointsByWall,
        indicesByWall,
        initialPointsByStair,
        indicesByStair,
        mode,
        singlePointTarget: null,
        singlePointCurrentPos: null,
        isWholeShapeMove,
      }

      const singlePointSelections: Array<{ wallId: string; pointIndex: number }> = []
      for (const [wallId, indices] of indicesByWall.entries()) {
        for (const pointIndex of indices.values()) {
          singlePointSelections.push({ wallId, pointIndex })
        }
      }

      // Blue single-axis handles and wall selection drags should route through
      // the same constraint path as free vertex drag. When exactly one vertex
      // is selected we additionally capture opening snapshots around it.
      if (singlePointSelections.length === 1) {
        const target = singlePointSelections[0]!
        wallSelectionDragRef.current.singlePointTarget = target
        const wall = activeFloor.floorPlan.walls.find((w: Wall) => w.id === target.wallId)
        const point = wall?.points[target.pointIndex]
        wallSelectionDragRef.current.singlePointCurrentPos = point
          ? { x: point.x, y: point.y }
          : null
        vertexDragAnchorRef.current = target
        if (activeFloor.floorPlan.walls.length > 0) {
          const initialByWall = new Map<string, Point2[]>()
          for (const w of activeFloor.floorPlan.walls) {
            initialByWall.set(
              w.id,
              w.points.map((p: Point2) => ({ x: p.x, y: p.y }))
            )
          }
          vertexDragInitialPointsRef.current = initialByWall
        } else {
          vertexDragInitialPointsRef.current = null
        }
        pointDragTargetsRef.current = buildMergedPointTargets(
          activeFloor.floorPlan.walls,
          target.wallId,
          target.pointIndex
        )
        if (
          pointDragTargetsRef.current.length === 1 &&
          pointDragTargetsRef.current[0]!.wallId === target.wallId &&
          pointDragTargetsRef.current[0]!.pointIndex === target.pointIndex &&
          wall &&
          wall.points.length >= 2
        ) {
          const wallDoors = baseDoors.filter((d) => d.wallId === target.wallId)
          const wallWindows = baseWindows.filter((w) => w.wallId === target.wallId)
          const bySegment = getOpeningsBySegment(wall.points, wallDoors, wallWindows)
          const leftIdx = target.pointIndex - 1
          const rightIdx = target.pointIndex
          const snapshot = new Map<number, OpeningOnSegment[]>()
          if (leftIdx >= 0 && bySegment.has(leftIdx)) snapshot.set(leftIdx, bySegment.get(leftIdx)!)
          if (rightIdx < wall.points.length && bySegment.has(rightIdx))
            snapshot.set(rightIdx, bySegment.get(rightIdx)!)
          vertexDragInitialOpeningsRef.current = {
            wallId: target.wallId,
            pointIndex: target.pointIndex,
            bySegment: snapshot,
          }
        } else {
          vertexDragInitialOpeningsRef.current = null
        }
      } else {
        // Multi-vertex: use the same constraint path as freeform (applyMergedPointMove
        // + constrainVertexMove per vertex). Build merged targets and snapshot all walls.
        const walls = activeFloor.floorPlan.walls
        const mergedByWall = new Map<string, Set<number>>()
        for (const [wid, indices] of indicesByWall.entries()) {
          for (const idx of indices) {
            const merged = buildMergedPointTargets(walls, wid, idx)
            if (merged.length === 0) {
              let set = mergedByWall.get(wid)
              if (!set) {
                set = new Set<number>()
                mergedByWall.set(wid, set)
              }
              set.add(idx)
            } else {
              for (const m of merged) {
                let set = mergedByWall.get(m.wallId)
                if (!set) {
                  set = new Set<number>()
                  mergedByWall.set(m.wallId, set)
                }
                set.add(m.pointIndex)
              }
            }
          }
        }
        const multiTargets: Array<{ wallId: string; pointIndex: number }> = []
        for (const [wid, set] of mergedByWall.entries()) {
          for (const idx of set) {
            multiTargets.push({ wallId: wid, pointIndex: idx })
          }
        }
        pointDragTargetsRef.current = multiTargets
        vertexDragInitialOpeningsRef.current = null

        const firstSelected = singlePointSelections[0]
        if (firstSelected) {
          vertexDragAnchorRef.current = firstSelected
          const initialByWall = new Map<string, Point2[]>()
          for (const w of walls) {
            initialByWall.set(
              w.id,
              w.points.map((p: Point2) => ({ x: p.x, y: p.y }))
            )
          }
          vertexDragInitialPointsRef.current = initialByWall
        } else {
          vertexDragAnchorRef.current = null
          vertexDragInitialPointsRef.current = null
        }
      }
    },
    [
      activeFloor,
      selectedWallIds,
      selectedPointIndices,
      selectedStairPointIndices,
      buildMergedPointTargets,
      baseDoors,
      baseWindows,
      wallSelectionPreviewRef,
      stairSelectionPreviewRef,
      wallSelectionDragRef,
      vertexDragAnchorRef,
      pointDragTargetsRef,
      vertexDragInitialPointsRef,
      vertexDragInitialOpeningsRef,
    ]
  )

  const commitStairPreviewGeometry = useCallback(
    function () {
      const preview = stairSelectionPreviewRef.current
      if (preview.size === 0) return
      for (const [stairId, newPoints] of preview) {
        const baseStair = floorStairs?.find((s: Stair) => s.id === stairId)
        if (!baseStair || baseStair.points.length !== newPoints.length) continue
        const changed = newPoints.some(
          (p, i) => p.x !== baseStair.points[i]!.x || p.y !== baseStair.points[i]!.y
        )
        if (changed) updateStair(stairId, { points: newPoints })
      }
      stairSelectionPreviewRef.current = new Map()
      applySelectionPreview({
        walls: new Map(wallSelectionPreviewRef.current),
        stairs: new Map(stairSelectionPreviewRef.current),
      })
    },
    [
      floorStairs,
      updateStair,
      applySelectionPreview,
      stairSelectionPreviewRef,
      wallSelectionPreviewRef,
    ]
  )

  const applySelectedStairPointDelta = useCallback(
    (
      initialPointsByStair: Map<string, Point2[]> | null,
      indicesByStair: Map<string, Set<number>> | null,
      dx: number,
      dy: number
    ) => {
      if (!initialPointsByStair || !indicesByStair) return
      const nextPreview = new Map(stairSelectionPreviewRef.current)
      for (const [stairId, originalPoints] of initialPointsByStair.entries()) {
        const indices = indicesByStair.get(stairId)
        if (!indices || indices.size === 0) continue
        nextPreview.set(
          stairId,
          originalPoints.map((point, index) =>
            indices.has(index) ? { x: point.x + dx, y: point.y + dy } : point
          )
        )
      }
      stairSelectionPreviewRef.current = nextPreview
      applySelectionPreview({
        walls: new Map(wallSelectionPreviewRef.current),
        stairs: new Map(stairSelectionPreviewRef.current),
      })
    },
    [applySelectionPreview, stairSelectionPreviewRef, wallSelectionPreviewRef]
  )

  const computeStairPointDragPoints = useCallback(
    (
      stairId: string,
      pointIndex: number,
      x: number,
      y: number,
      initialPoints: Point2[],
      selectedIndices: number[],
      shouldMoveSelection: boolean
    ): { points: Point2[]; guides: Array<{ from: Point2; to: Point2 }> } => {
      if (!shouldMoveSelection) {
        const rawTarget = { x, y }
        const excludedKeys = new Set([`s:${stairId}:${pointIndex}`])
        const nearbyLine = resolveNearbyFloorLineSnap(rawTarget, excludedKeys)
        const projected = nearbyLine ? null : resolveProjectedFloorSnap(rawTarget, excludedKeys)
        const snappedTarget =
          nearbyLine?.point ??
          softSnapToGrid(projected?.snappedPoint ?? rawTarget, planView.snapToGrid)
        return {
          points: initialPoints.map((p, idx) => (idx === pointIndex ? snappedTarget : p)),
          guides: projected?.guides ?? [],
        }
      }
      const basePoint = initialPoints[pointIndex]
      if (!basePoint) return { points: initialPoints, guides: [] }
      const rawTarget = { x, y }
      const excludedKeys = new Set(selectedIndices.map((index) => `s:${stairId}:${index}`))
      const nearbyLine = resolveNearbyFloorLineSnap(rawTarget, excludedKeys)
      const projected = nearbyLine ? null : resolveProjectedFloorSnap(rawTarget, excludedKeys)
      const snappedTarget =
        nearbyLine?.point ??
        softSnapToGrid(projected?.snappedPoint ?? rawTarget, planView.snapToGrid)
      const dx = snappedTarget.x - basePoint.x
      const dy = snappedTarget.y - basePoint.y
      return {
        points: initialPoints.map((p, idx) =>
          selectedIndices.includes(idx) ? { x: p.x + dx, y: p.y + dy } : p
        ),
        guides: projected?.guides ?? [],
      }
    },
    [resolveNearbyFloorLineSnap, resolveProjectedFloorSnap, softSnapToGrid, planView.snapToGrid]
  )

  const handleStairPointDragStart = useCallback(
    (stairId: string, pointIndex: number) => {
      const baseStair = floorStairs?.find((s: Stair) => s.id === stairId)
      if (!baseStair) return
      const selectedIndices = selectedStairPointIndices.get(stairId) ?? [pointIndex]
      stairPointDragRef.current = {
        stairId,
        pointIndex,
        initialPoints: baseStair.points.map((p: Point2) => ({ x: p.x, y: p.y })),
        selectedIndices: [...selectedIndices],
      }
    },
    [floorStairs, selectedStairPointIndices, stairPointDragRef]
  )

  const handleStairPointMove = useCallback(
    (stairId: string, pointIndex: number, x: number, y: number) => {
      let drag = stairPointDragRef.current
      if (!drag || drag.stairId !== stairId) {
        handleStairPointDragStart(stairId, pointIndex)
        drag = stairPointDragRef.current
      }
      if (!drag) return

      const selectedIndices = drag.selectedIndices
      const shouldMoveSelection =
        (selection.type === 'stairPoint' || selection.type === 'wallPoint') &&
        selectedIndices.includes(pointIndex) &&
        selectedPointIndices.size === 0
      const { points, guides } = computeStairPointDragPoints(
        stairId,
        pointIndex,
        x,
        y,
        drag.initialPoints,
        selectedIndices,
        shouldMoveSelection
      )
      applyVertexMoveProjectedSnapGuides(guides)
      const nextPreview = new Map(stairSelectionPreviewRef.current)
      nextPreview.set(stairId, points)
      stairSelectionPreviewRef.current = nextPreview
      applySelectionPreview({
        walls: new Map(wallSelectionPreviewRef.current),
        stairs: new Map(stairSelectionPreviewRef.current),
      })
    },
    [
      applyVertexMoveProjectedSnapGuides,
      computeStairPointDragPoints,
      handleStairPointDragStart,
      selectedPointIndices.size,
      selection.type,
      applySelectionPreview,
      stairPointDragRef,
      stairSelectionPreviewRef,
      wallSelectionPreviewRef,
    ]
  )

  const handleStairPointDragEnd = useCallback(
    (stairId: string, pointIndex: number, x: number, y: number) => {
      handleStairPointMove(stairId, pointIndex, x, y)
      applyVertexMoveProjectedSnapGuides([])
      commitStairPreviewGeometry()
      stairPointDragRef.current = null
    },
    [
      applyVertexMoveProjectedSnapGuides,
      commitStairPreviewGeometry,
      handleStairPointMove,
      stairPointDragRef,
    ]
  )

  const updateWallSelectionDrag = useCallback(
    (current: Point2) => {
      const {
        start,
        initialPointsByWall,
        indicesByWall,
        initialPointsByStair,
        indicesByStair,
        mode,
        singlePointTarget,
        isWholeShapeMove,
      } = wallSelectionDragRef.current
      if (!start || !initialPointsByWall || !indicesByWall) return

      const now = nowMs()
      const isSinglePoint = singlePointTarget != null
      // Single-point (blue handle) path: no throttle so bounds stay at clamped position and don't flicker.
      if (!isSinglePoint && now - lastWallSelectionUpdateTimeRef.current < 16) return
      if (!isSinglePoint) lastWallSelectionUpdateTimeRef.current = now
      let dx = current.x - start.x
      let dy = current.y - start.y
      if (mode === 'horizontal') {
        dy = 0
      } else if (mode === 'vertical') {
        dx = 0
      }
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return

      // Compute a uniform snapped delta for the whole selection so shapes stay rigid.
      // Use the first selected point across all walls as the snap anchor.
      let anchorInitial: Point2 | null = null
      outer: for (const [wallId, originalPoints] of initialPointsByWall.entries()) {
        const indices = indicesByWall.get(wallId)
        if (!indices || !indices.size) continue
        for (const idx of indices) {
          const p = originalPoints[idx]
          if (p) {
            anchorInitial = p
            break outer
          }
        }
      }
      if (!anchorInitial && initialPointsByStair && indicesByStair) {
        outerStair: for (const [stairId, originalPoints] of initialPointsByStair.entries()) {
          const indices = indicesByStair.get(stairId)
          if (!indices || !indices.size) continue
          for (const idx of indices) {
            const p = originalPoints[idx]
            if (p) {
              anchorInitial = p
              break outerStair
            }
          }
        }
      }

      let snappedDx = dx
      let snappedDy = dy
      const movementAxis = mode === 'horizontal' ? 'x' : mode === 'vertical' ? 'y' : undefined
      if (anchorInitial) {
        const movedAnchor = { x: anchorInitial.x + dx, y: anchorInitial.y + dy }
        const excludedLineKeys = new Set<string>()
        for (const [wallId, indices] of indicesByWall) {
          for (const index of indices) excludedLineKeys.add(`w:${wallId}:${index}`)
        }
        if (indicesByStair) {
          for (const [stairId, indices] of indicesByStair) {
            for (const index of indices) excludedLineKeys.add(`s:${stairId}:${index}`)
          }
        }
        const nearbyLine = resolveNearbyFloorLineSnap(movedAnchor, excludedLineKeys, movementAxis)
        const snappedAnchor =
          nearbyLine?.point ?? softSnapToGrid(movedAnchor, planView.snapToGrid, movementAxis)
        snappedDx = snappedAnchor.x - anchorInitial.x
        snappedDy = snappedAnchor.y - anchorInitial.y
      }

      // Use vertex path (constraints) when a single vertex is dragged, or when multiple vertices are
      // dragged but not all points are selected (partial selection deforms the shape → constraints must apply).
      // Only use rigid delta path when every affected wall has all points selected (whole-shape move).
      const useVertexPath =
        pointDragTargetsRef.current.length > 0 &&
        anchorInitial != null &&
        (singlePointTarget != null || !isWholeShapeMove)

      if (activeFloor?.floorPlan && useVertexPath) {
        const anchor = anchorInitial!
        const targetPos = {
          x: anchor.x + snappedDx,
          y: anchor.y + snappedDy,
        }
        wallSelectionDragRef.current.singlePointCurrentPos = targetPos
        applyMergedPointMove(activeFloor.floorPlan.walls, targetPos, false, 'preview', movementAxis)
        applySelectedStairPointDelta(initialPointsByStair, indicesByStair, snappedDx, snappedDy)
        return
      }

      const nextPreview = new Map(wallSelectionPreviewRef.current)
      for (const [wallId, originalPoints] of initialPointsByWall.entries()) {
        const indices = indicesByWall.get(wallId)
        if (!indices || !indices.size) continue
        const nextPoints = originalPoints.map((p, idx) => {
          if (!indices.has(idx)) return p
          return {
            x: p.x + snappedDx,
            y: p.y + snappedDy,
          }
        })
        nextPreview.set(wallId, nextPoints)
      }
      wallSelectionPreviewRef.current = nextPreview
      applySelectedStairPointDelta(initialPointsByStair, indicesByStair, snappedDx, snappedDy)
      applySelectionPreview({
        walls: new Map(wallSelectionPreviewRef.current),
        stairs: new Map(stairSelectionPreviewRef.current),
      })
    },
    [
      planView.snapToGrid,
      activeFloor,
      applyMergedPointMove,
      applySelectedStairPointDelta,
      resolveNearbyFloorLineSnap,
      softSnapToGrid,
      wallSelectionDragRef,
      lastWallSelectionUpdateTimeRef,
      pointDragTargetsRef,
      wallSelectionPreviewRef,
      applySelectionPreview,
      stairSelectionPreviewRef,
    ]
  )

  const endWallSelectionDrag = useCallback(
    function () {
      const { singlePointCurrentPos, mode } = wallSelectionDragRef.current
      if (
        pointDragTargetsRef.current.length > 0 &&
        singlePointCurrentPos &&
        activeFloor?.floorPlan
      ) {
        const movementAxis = mode === 'horizontal' ? 'x' : mode === 'vertical' ? 'y' : undefined
        applyMergedPointMove(
          activeFloor.floorPlan.walls,
          singlePointCurrentPos,
          true,
          'commit',
          movementAxis
        )
        pointDragTargetsRef.current = []
        vertexDragInitialOpeningsRef.current = null
        vertexDragAnchorRef.current = null
        vertexDragInitialPointsRef.current = null
        applyPreviewWalls(null)
        applyPreviewDoors(null)
        applyPreviewWindows(null)
        applyVertexMoveProjectedSnapGuides([])
        wallSelectionPreviewRef.current = new Map()
        applySelectionPreview({
          walls: new Map(wallSelectionPreviewRef.current),
          stairs: new Map(stairSelectionPreviewRef.current),
        })
        commitStairPreviewGeometry()
        wallSelectionDragRef.current = {
          start: null,
          initialPointsByWall: null,
          indicesByWall: null,
          initialPointsByStair: null,
          indicesByStair: null,
          mode: 'free',
          singlePointTarget: null,
          singlePointCurrentPos: null,
          isWholeShapeMove: false,
        }
        lastWallSelectionUpdateTimeRef.current = 0
        return
      }

      wallSelectionDragRef.current = {
        start: null,
        initialPointsByWall: null,
        indicesByWall: null,
        initialPointsByStair: null,
        indicesByStair: null,
        mode: 'free',
        singlePointTarget: null,
        singlePointCurrentPos: null,
        isWholeShapeMove: false,
      }
      // Commit preview geometry (delta path: whole-shape move only).
      if (wallSelectionPreviewRef.current.size > 0 && activeFloor?.floorPlan) {
        const floorPlan = activeFloor.floorPlan
        wallSelectionPreviewRef.current.forEach((newPoints, wallId) => {
          const wall = floorPlan.walls.find((w: Wall) => w.id === wallId)
          if (!wall || wall.points.length !== newPoints.length) return
          const oldPoints = wall.points
          if (isRigidTranslation(oldPoints, newPoints)) {
            updateWall(wallId, { points: newPoints })
          } else {
            const wallDoors = floorPlan.doors.filter((d: Door) => d.wallId === wallId)
            const wallWindows = floorPlan.windows.filter((w: Window) => w.wallId === wallId)
            const preserved = preserveOpeningPositionsAfterPointChange(
              oldPoints,
              newPoints,
              wallDoors,
              wallWindows
            )
            // Apply preserved positions to temp copies, then sanitize so openings fit (no overlap, no out-of-bounds).
            const doorsWithPreserved = wallDoors.map((d: Door) => {
              const u = preserved.doorUpdates.find((x) => x.id === d.id)
              return u ? { ...d, position: u.position } : d
            })
            const windowsWithPreserved = wallWindows.map((w: Window) => {
              const u = preserved.windowUpdates.find((x) => x.id === w.id)
              return u ? { ...w, position: u.position } : w
            })
            const sanitized = sanitizeWallOpeningPositions(
              newPoints,
              doorsWithPreserved,
              windowsWithPreserved
            )
            // Use sanitized where it adjusted, otherwise preserved (so all openings get a final position).
            const doorUpdates = preserved.doorUpdates.map((u) => {
              const s = sanitized.doorUpdates.find((x) => x.id === u.id)
              return { id: u.id, position: s?.position ?? u.position }
            })
            const windowUpdates = preserved.windowUpdates.map((u) => {
              const s = sanitized.windowUpdates.find((x) => x.id === u.id)
              return { id: u.id, position: s?.position ?? u.position }
            })
            updateWall(wallId, { points: newPoints, doorUpdates, windowUpdates })
          }
        })
        wallSelectionPreviewRef.current = new Map()
        applySelectionPreview({
          walls: new Map(wallSelectionPreviewRef.current),
          stairs: new Map(stairSelectionPreviewRef.current),
        })
        pointDragTargetsRef.current = []
        vertexDragInitialOpeningsRef.current = null
        vertexDragAnchorRef.current = null
        vertexDragInitialPointsRef.current = null
      }
      commitStairPreviewGeometry()
      applyVertexMoveProjectedSnapGuides([])
      lastWallSelectionUpdateTimeRef.current = 0
    },
    [
      activeFloor,
      commitStairPreviewGeometry,
      applyVertexMoveProjectedSnapGuides,
      applyMergedPointMove,
      updateWall,
      wallSelectionDragRef,
      pointDragTargetsRef,
      wallSelectionPreviewRef,
      lastWallSelectionUpdateTimeRef,
      vertexDragInitialOpeningsRef,
      vertexDragAnchorRef,
      vertexDragInitialPointsRef,
      applyPreviewWalls,
      applyPreviewDoors,
      applyPreviewWindows,
      applySelectionPreview,
      stairSelectionPreviewRef,
    ]
  )

  function beginStairSelectionDrag(
    start: Point2,
    mode: 'free' | 'horizontal' | 'vertical' = 'free'
  ) {
    if (!selectedStair) return
    stairSelectionPreviewRef.current = new Map()
    stairSelectionDragRef.current = {
      stairId: selectedStair.id,
      pointIndex: selection.type === 'stairPoint' ? selectedStairPointIndex : null,
      start,
      initialPoints: selectedStair.points.map((point) => ({ x: point.x, y: point.y })),
      mode,
    }
  }

  function updateStairSelectionDrag(current: Point2) {
    const { stairId, pointIndex, start, initialPoints, mode } = stairSelectionDragRef.current
    if (!stairId || !start || !initialPoints || initialPoints.length === 0) return

    const now = nowMs()
    if (now - lastWallSelectionUpdateTimeRef.current < 16) return
    lastWallSelectionUpdateTimeRef.current = now

    let dx = current.x - start.x
    let dy = current.y - start.y
    if (mode === 'horizontal') {
      dy = 0
    } else if (mode === 'vertical') {
      dx = 0
    }

    const anchor =
      pointIndex != null ? (initialPoints[pointIndex] ?? initialPoints[0]!) : initialPoints[0]!
    const movedAnchor = { x: anchor.x + dx, y: anchor.y + dy }
    const selectedIndices =
      pointIndex != null ? [pointIndex] : initialPoints.map((_, index) => index)
    const excludedKeys = new Set(selectedIndices.map((index) => `s:${stairId}:${index}`))
    const movementAxis = mode === 'horizontal' ? 'x' : mode === 'vertical' ? 'y' : undefined
    const nearbyLine = resolveNearbyFloorLineSnap(movedAnchor, excludedKeys, movementAxis)
    const projected = nearbyLine ? null : resolveProjectedFloorSnap(movedAnchor, excludedKeys)
    const projectedPoint = projected?.snappedPoint ?? movedAnchor
    const axisConstrainedProjectedPoint =
      movementAxis === 'x'
        ? { x: projectedPoint.x, y: movedAnchor.y }
        : movementAxis === 'y'
          ? { x: movedAnchor.x, y: projectedPoint.y }
          : projectedPoint
    const snappedAnchor =
      nearbyLine?.point ??
      softSnapToGrid(axisConstrainedProjectedPoint, planView.snapToGrid, movementAxis)
    const snappedDx = snappedAnchor.x - anchor.x
    const snappedDy = snappedAnchor.y - anchor.y
    applyVertexMoveProjectedSnapGuides(projected?.guides ?? [])

    const nextPoints = initialPoints.map((point, index) => {
      if (pointIndex != null && index !== pointIndex) {
        return point
      }
      return {
        x: point.x + snappedDx,
        y: point.y + snappedDy,
      }
    })
    const nextPreview = new Map(stairSelectionPreviewRef.current)
    nextPreview.set(stairId, nextPoints)
    stairSelectionPreviewRef.current = nextPreview
    applySelectionPreview({
      walls: new Map(wallSelectionPreviewRef.current),
      stairs: new Map(stairSelectionPreviewRef.current),
    })
  }

  function endStairSelectionDrag() {
    applyVertexMoveProjectedSnapGuides([])
    commitStairPreviewGeometry()
    lastWallSelectionUpdateTimeRef.current = 0
    stairSelectionDragRef.current = {
      stairId: null,
      pointIndex: null,
      start: null,
      initialPoints: null,
      mode: 'free',
    }
  }

  return {
    beginWallSelectionDrag,
    commitStairPreviewGeometry,
    handleStairPointDragStart,
    handleStairPointMove,
    handleStairPointDragEnd,
    updateWallSelectionDrag,
    endWallSelectionDrag,
    beginStairSelectionDrag,
    updateStairSelectionDrag,
    endStairSelectionDrag,
  }
}
