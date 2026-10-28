import type { usePlanGeometrySnapping } from '@/hooks/plan/usePlanGeometrySnapping'
import type { usePlanGeometryGestureState } from '@/hooks/plan/usePlanGeometryGestureState'
import type { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'
import type React from 'react'
import { useCallback } from 'react'
import type { Wall, Point2, Door, Window } from '@/types/schema'
import {
  handleClipWall,
  projectPointToWall,
  computeOpeningGeometry,
  validateOpeningPlacement,
  resolveWindowInsertWidthPx,
} from '@/handlers/plan/wallDrawing'
import {
  constrainVertexMove,
  preserveOpeningPositionsAfterPointChange,
  adjustVerticesAndOpenings,
} from '@/lib/plan/constraints'
import {
  openingWallNormalDeadzoneCanvas,
  resolveDoorPlacementOrientation,
} from '@/lib/plan/doorSwingFromPointer'
import { snapOpeningWidthToWholeCentimeters } from '@/lib/plan/openingPlacementDrag'
import { resolveOpeningPositionSnap } from '@/lib/plan/openingPositionSnap'
import {
  getCurvedWallToolHoverFeedback,
  getWallPathPoints,
  isCurvedWall,
} from '@/lib/plan/wallCurve'
import {
  OPENING_SPAN_CENTER_SNAP_ZONE_PX,
  OPENING_SPAN_CENTER_SNAP_ZONE_PX_MAX,
  OPENING_SPAN_CENTER_SNAP_ZONE_PX_MIN,
  DRAW_TOOL_PROJECTION_SNAP_ZONE_PX,
  DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MAX,
  DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MIN,
  screenPxToCanvasUnits,
} from '@/constants/canvasConstants'

interface PlanWallVertexGesturesOptions {
  shouldHandleWallHover: boolean
  activeFloor: import('@/types/schema').Floor | null | undefined
  applyHoveredWallId: React.Dispatch<React.SetStateAction<string | null>>
  applyClipPreviewPoints: React.Dispatch<
    React.SetStateAction<import('@/types/schema').Point2[] | null>
  >
  applyOpeningPreview: React.Dispatch<
    React.SetStateAction<{
      wallId: string
      position: number
      width: number
      kind: 'door' | 'window'
      valid: boolean
      doorSwing?: 'left' | 'right' | undefined
      doorDirection?: 'in' | 'out' | undefined
    } | null>
  >
  applyInsertPointPreview: React.Dispatch<
    React.SetStateAction<import('@/types/schema').Point2 | null>
  >
  activeTool: import('@/types/ui').PlanToolMode
  canvasPxPerMeter: number
  pxPerMeter: ReturnType<typeof usePlanCanvasGeometry>['pxPerMeter']
  planView: import('@/types/ui').ViewState
  baseDoors: ReturnType<typeof usePlanCanvasGeometry>['baseDoors']
  baseWindows: ReturnType<typeof usePlanCanvasGeometry>['baseWindows']
  doorHoverWallIdRef: ReturnType<typeof usePlanGeometryGestureState>['doorHoverWallIdRef']
  doorHoverOpenSideRef: ReturnType<typeof usePlanGeometryGestureState>['doorHoverOpenSideRef']
  gridSize: ReturnType<typeof usePlanCanvasGeometry>['gridSize']
  resolveNearbyFloorLineSnap: ReturnType<typeof usePlanCanvasGeometry>['resolveNearbyFloorLineSnap']
  resolveProjectedFloorSnap: ReturnType<typeof usePlanGeometrySnapping>['resolveProjectedFloorSnap']
  softSnapToGrid: ReturnType<typeof usePlanGeometrySnapping>['softSnapToGrid']
  pointDragTargetsRef: ReturnType<typeof usePlanGeometryGestureState>['pointDragTargetsRef']
  vertexDragAnchorRef: ReturnType<typeof usePlanGeometryGestureState>['vertexDragAnchorRef']
  vertexDragInitialPointsRef: ReturnType<
    typeof usePlanGeometryGestureState
  >['vertexDragInitialPointsRef']
  applyVertexMoveProjectedSnapGuides: React.Dispatch<
    React.SetStateAction<
      {
        from: import('@/types/schema').Point2
        to: import('@/types/schema').Point2
        hideDistanceLabel?: boolean | undefined
      }[]
    >
  >
  vertexDragInitialOpeningsRef: ReturnType<
    typeof usePlanGeometryGestureState
  >['vertexDragInitialOpeningsRef']
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
}

export function usePlanWallVertexGestures({
  shouldHandleWallHover,
  activeFloor,
  applyHoveredWallId,
  applyClipPreviewPoints,
  applyOpeningPreview,
  applyInsertPointPreview,
  activeTool,
  canvasPxPerMeter,
  pxPerMeter,
  planView,
  baseDoors,
  baseWindows,
  doorHoverWallIdRef,
  doorHoverOpenSideRef,
  gridSize,
  resolveNearbyFloorLineSnap,
  resolveProjectedFloorSnap,
  softSnapToGrid,
  pointDragTargetsRef,
  vertexDragAnchorRef,
  vertexDragInitialPointsRef,
  applyVertexMoveProjectedSnapGuides,
  vertexDragInitialOpeningsRef,
  applyPreviewWalls,
  applyPreviewDoors,
  applyPreviewWindows,
  updateWall,
}: PlanWallVertexGesturesOptions) {
  const handleWallHover = useCallback(
    (wallId: string | null, pointer: Point2 | null) => {
      if (!shouldHandleWallHover) return

      if (!wallId || !pointer || !activeFloor?.floorPlan) {
        applyHoveredWallId((prev) => (prev === null ? prev : null))
        applyClipPreviewPoints((prev) => (prev === null ? prev : null))
        applyOpeningPreview(null)
        applyInsertPointPreview(null)
        return
      }

      const wall = activeFloor.floorPlan.walls.find((w: Wall) => w.id === wallId)
      if (!wall) {
        applyHoveredWallId((prev) => (prev === null ? prev : null))
        applyClipPreviewPoints((prev) => (prev === null ? prev : null))
        applyOpeningPreview(null)
        applyInsertPointPreview(null)
        return
      }

      const curvedHoverFeedback = isCurvedWall(wall)
        ? getCurvedWallToolHoverFeedback(activeTool)
        : 'default'
      const nextHoveredWallId = curvedHoverFeedback === 'suppressed' ? null : wallId
      applyHoveredWallId((prev) => (prev === nextHoveredWallId ? prev : nextHoveredWallId))

      // Select tool only needs hover highlight — skip preview work on every pointer move.
      if (activeTool === 'select') return

      if (isCurvedWall(wall)) {
        applyClipPreviewPoints((prev) => (prev === null ? prev : null))
        applyOpeningPreview(null)
        applyInsertPointPreview(null)
        return
      }

      if (activeTool === 'clipWall') {
        const preview =
          handleClipWall(wall, activeFloor.floorPlan.walls, pointer).trimmedSegment ?? null
        applyClipPreviewPoints(preview && preview.length >= 2 ? preview : null)
        applyOpeningPreview(null)
        applyInsertPointPreview(null)
        return
      }

      if (activeTool === 'insertDoor' || activeTool === 'insertWindow') {
        applyClipPreviewPoints((prev) => (prev === null ? prev : null))
        applyInsertPointPreview(null)
        const doorWidthPx = snapOpeningWidthToWholeCentimeters(
          0.83 * canvasPxPerMeter,
          canvasPxPerMeter
        )
        const clickWindowWidthPx = 0.5 * canvasPxPerMeter
        const previewWindowWidthPx = pxPerMeter != null ? 0.5 * pxPerMeter : 100
        const windowWidthPx = snapOpeningWidthToWholeCentimeters(
          resolveWindowInsertWidthPx(clickWindowWidthPx, previewWindowWidthPx),
          canvasPxPerMeter
        )
        const width = activeTool === 'insertDoor' ? doorWidthPx : windowWidthPx
        const snappedCenter = resolveOpeningPositionSnap({
          wall,
          walls: activeFloor.floorPlan.walls,
          pointer,
          spanCenterRadius: screenPxToCanvasUnits(
            planView.zoom,
            OPENING_SPAN_CENTER_SNAP_ZONE_PX,
            OPENING_SPAN_CENTER_SNAP_ZONE_PX_MIN,
            OPENING_SPAN_CENTER_SNAP_ZONE_PX_MAX
          ),
          snapToGrid: planView.snapToGrid,
          gridSize,
        })
        const result = validateOpeningPlacement(
          wall,
          snappedCenter.point,
          width,
          baseDoors,
          baseWindows
        )
        const doorOrientation =
          activeTool === 'insertDoor' && result.valid
            ? (() => {
                const geom = computeOpeningGeometry(wall.points, result.position)
                if (!geom) return null
                if (doorHoverWallIdRef.current !== wallId) {
                  doorHoverWallIdRef.current = wallId
                  doorHoverOpenSideRef.current = 'right'
                }
                return resolveDoorPlacementOrientation({
                  hingeSwing: null,
                  center: geom.center,
                  tangent: geom.tangent,
                  pointer,
                  walls: activeFloor.floorPlan!.walls,
                  wall,
                  masterWallThickness: activeFloor.floorPlan!.masterWallThickness,
                  pxPerMeter: canvasPxPerMeter,
                  deadzonePx: openingWallNormalDeadzoneCanvas(planView.zoom),
                  lastOpenSide: doorHoverOpenSideRef.current,
                })
              })()
            : null
        if (doorOrientation) {
          doorHoverOpenSideRef.current = doorOrientation.openSide
        }
        applyOpeningPreview({
          wallId,
          position: result.position,
          width: result.width,
          kind: activeTool === 'insertDoor' ? 'door' : 'window',
          valid: result.valid,
          ...(doorOrientation
            ? {
                doorSwing: doorOrientation.swing,
                doorDirection: doorOrientation.direction,
              }
            : {}),
        })
        return
      }

      if (activeTool === 'insertPoint') {
        applyClipPreviewPoints((prev) => (prev === null ? prev : null))
        applyOpeningPreview(null)
        // Preview = point on wall (project cursor onto wall, like opening preview). Keeps preview on the line.
        const { t } = projectPointToWall(wall.points, pointer)
        const geom = computeOpeningGeometry(wall.points, t)
        applyInsertPointPreview(geom?.center ?? null)
        return
      }

      applyClipPreviewPoints((prev) => (prev === null ? prev : null))
      applyOpeningPreview(null)
      applyInsertPointPreview(null)
    },
    [
      shouldHandleWallHover,
      activeFloor,
      activeTool,
      applyHoveredWallId,
      applyClipPreviewPoints,
      applyOpeningPreview,
      applyInsertPointPreview,
      canvasPxPerMeter,
      pxPerMeter,
      planView.zoom,
      planView.snapToGrid,
      gridSize,
      baseDoors,
      baseWindows,
      doorHoverWallIdRef,
      doorHoverOpenSideRef,
    ]
  )

  const handleOpeningPreviewOverrideChange = useCallback(
    (
      preview: {
        wallId: string
        position: number
        width: number
        kind: 'door' | 'window'
        valid: boolean
        doorSwing?: 'left' | 'right'
        doorDirection?: 'in' | 'out'
      } | null
    ) => {
      applyOpeningPreview(preview)
    },
    [applyOpeningPreview]
  )

  const pointsEqual = useCallback((a: Point2, b: Point2, epsilon = 1e-4) => {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= epsilon
  }, [])

  const pointKey = useCallback(
    (p: Point2) => `${Math.round(p.x * 1000)}:${Math.round(p.y * 1000)}`,
    []
  )

  const segmentKey = useCallback(
    (a: Point2, b: Point2) => {
      const k1 = pointKey(a)
      const k2 = pointKey(b)
      return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`
    },
    [pointKey]
  )

  const getSegmentConnectedWallIds = useCallback(
    (walls: Wall[], startWallId: string): Set<string> => {
      const wallSegments = new Map<string, Set<string>>()
      const segmentToWalls = new Map<string, Set<string>>()
      for (const w of walls) {
        const segs = new Set<string>()
        for (let i = 0; i < w.points.length - 1; i++) {
          const key = segmentKey(w.points[i]!, w.points[i + 1]!)
          segs.add(key)
          let owners = segmentToWalls.get(key)
          if (!owners) {
            owners = new Set<string>()
            segmentToWalls.set(key, owners)
          }
          owners.add(w.id)
        }
        wallSegments.set(w.id, segs)
      }

      const connected = new Set<string>([startWallId])
      const queue: string[] = [startWallId]
      while (queue.length > 0) {
        const current = queue.shift()!
        const segs = wallSegments.get(current)
        if (!segs) continue
        for (const seg of segs) {
          const owners = segmentToWalls.get(seg)
          if (!owners) continue
          for (const otherWallId of owners) {
            if (!connected.has(otherWallId)) {
              connected.add(otherWallId)
              queue.push(otherWallId)
            }
          }
        }
      }
      return connected
    },
    [segmentKey]
  )

  const buildMergedPointTargets = useCallback(
    (walls: Wall[], wallId: string, pointIndex: number) => {
      const sourceWall = walls.find((w) => w.id === wallId)
      const sourcePoint = sourceWall?.points[pointIndex]
      if (!sourceWall || !sourcePoint) return []
      if (isCurvedWall(sourceWall) && pointIndex === 1) {
        return [{ wallId, pointIndex }]
      }

      const connectedWallIds = getSegmentConnectedWallIds(walls, wallId)
      const targets: Array<{ wallId: string; pointIndex: number }> = []
      for (const w of walls) {
        if (!connectedWallIds.has(w.id)) continue
        w.points.forEach((p, idx) => {
          if (isCurvedWall(w) && idx === 1) return
          if (pointsEqual(p, sourcePoint)) {
            targets.push({ wallId: w.id, pointIndex: idx })
          }
        })
      }
      return targets
    },
    [getSegmentConnectedWallIds, pointsEqual]
  )

  const snapGraphicFloorPoint = useCallback(
    (point: Point2): { point: Point2; guides: Array<{ from: Point2; to: Point2 }> } => {
      const nearbyLine = resolveNearbyFloorLineSnap(point)
      if (nearbyLine) return { point: nearbyLine.point, guides: [] }
      const projected = resolveProjectedFloorSnap(point, new Set())
      const snapped = softSnapToGrid(projected?.snappedPoint ?? point, true)
      return { point: snapped, guides: projected?.guides ?? [] }
    },
    [resolveNearbyFloorLineSnap, resolveProjectedFloorSnap, softSnapToGrid]
  )

  const applyMergedPointMove = useCallback(
    (
      walls: Wall[],
      newPos: Point2,
      snapToGridEnabled: boolean,
      mode: 'preview' | 'commit' = 'commit',
      movementAxis?: 'x' | 'y'
    ): { overridePositions: Map<string, Point2> } | void => {
      const targets = pointDragTargetsRef.current
      if (targets.length === 0) return

      const pointsMatch = (a: Point2, b: Point2, epsilon = 1e-4) =>
        Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
      const segmentIntersectionPoint = (
        a: Point2,
        b: Point2,
        c: Point2,
        d: Point2
      ): Point2 | null => {
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
        return { x: a.x + t * r.x, y: a.y + t * r.y }
      }
      const isProjectionPathObstructed = (
        from: Point2,
        to: Point2,
        segments: Array<{ a: Point2; b: Point2 }>
      ) => {
        for (const seg of segments) {
          const hit = segmentIntersectionPoint(from, to, seg.a, seg.b)
          if (!hit) continue
          if (pointsMatch(hit, from) || pointsMatch(hit, to)) continue
          return true
        }
        return false
      }
      const resolveProjectedSnap = (point: Point2) => {
        const projectionSnapZone = screenPxToCanvasUnits(
          planView.zoom,
          DRAW_TOOL_PROJECTION_SNAP_ZONE_PX,
          DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MIN,
          DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MAX
        )
        const excludedAnchorKeys = new Set(targets.map((t) => `${t.wallId}:${t.pointIndex}`))
        const anchors: Array<{ wallId: string; pointIndex: number; point: Point2 }> = []
        for (const wall of walls) {
          for (let pointIndex = 0; pointIndex < wall.points.length; pointIndex++) {
            const p = wall.points[pointIndex]
            if (!p) continue
            if (isCurvedWall(wall) && pointIndex === 1) continue
            const key = `${wall.id}:${pointIndex}`
            // Never project-snap against vertices that are currently being dragged.
            if (excludedAnchorKeys.has(key)) continue
            anchors.push({ wallId: wall.id, pointIndex, point: p })
          }
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
        let bestVertical: { offset: number; distanceToAnchor: number; anchor: Point2 } | null = null
        let bestHorizontal: { offset: number; distanceToAnchor: number; anchor: Point2 } | null =
          null
        for (const anchor of anchors) {
          if (pointsMatch(anchor.point, point)) continue
          const dx = Math.abs(point.x - anchor.point.x)
          const dy = Math.abs(point.y - anchor.point.y)
          if (dx <= projectionSnapZone) {
            const snapped = { x: anchor.point.x, y: point.y }
            if (!isProjectionPathObstructed(snapped, anchor.point, segments)) {
              const distanceToAnchor = Math.hypot(
                snapped.x - anchor.point.x,
                snapped.y - anchor.point.y
              )
              const isBetter =
                !bestVertical ||
                dx < bestVertical.offset ||
                (Math.abs(dx - bestVertical.offset) <= 1e-6 &&
                  distanceToAnchor < bestVertical.distanceToAnchor)
              if (isBetter) bestVertical = { offset: dx, distanceToAnchor, anchor: anchor.point }
            }
          }
          if (dy <= projectionSnapZone) {
            const snapped = { x: point.x, y: anchor.point.y }
            if (!isProjectionPathObstructed(snapped, anchor.point, segments)) {
              const distanceToAnchor = Math.hypot(
                snapped.x - anchor.point.x,
                snapped.y - anchor.point.y
              )
              const isBetter =
                !bestHorizontal ||
                dy < bestHorizontal.offset ||
                (Math.abs(dy - bestHorizontal.offset) <= 1e-6 &&
                  distanceToAnchor < bestHorizontal.distanceToAnchor)
              if (isBetter) bestHorizontal = { offset: dy, distanceToAnchor, anchor: anchor.point }
            }
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
      }

      const anchor = vertexDragAnchorRef.current
      const initialPointsByWall = vertexDragInitialPointsRef.current
      let hasDelta = false
      let dx = 0
      let dy = 0
      if (anchor && initialPointsByWall) {
        const initialPoints = initialPointsByWall.get(anchor.wallId)
        const anchorInitial = initialPoints?.[anchor.pointIndex]
        if (anchorInitial) {
          dx = newPos.x - anchorInitial.x
          dy = newPos.y - anchorInitial.y
          hasDelta = true
        }
      }

      const isSingleVertexMove = targets.length === 1
      let snappedDx = dx
      let snappedDy = dy
      let targetPos = newPos
      const nextVertexGuides: Array<{ from: Point2; to: Point2 }> = []
      const excludedLineKeys = new Set(
        targets.map((target) => `w:${target.wallId}:${target.pointIndex}`)
      )
      const nearbyLine = hasDelta
        ? resolveNearbyFloorLineSnap(newPos, excludedLineKeys, movementAxis)
        : null
      if (nearbyLine && anchor && initialPointsByWall) {
        const anchorInitial = initialPointsByWall.get(anchor.wallId)?.[anchor.pointIndex]
        if (anchorInitial) {
          snappedDx = nearbyLine.point.x - anchorInitial.x
          snappedDy = nearbyLine.point.y - anchorInitial.y
          targetPos = nearbyLine.point
        }
      }

      type AxisCandidate = {
        snappedDelta: number
        offset: number
        guides: Array<{ from: Point2; to: Point2 }>
      }
      const xCandidates: AxisCandidate[] = []
      const yCandidates: AxisCandidate[] = []

      if (!nearbyLine && hasDelta && initialPointsByWall && planView.snapToProjection !== false) {
        for (const target of targets) {
          const basePoint = initialPointsByWall.get(target.wallId)?.[target.pointIndex]
          if (!basePoint) continue
          const rawMovedPos = { x: basePoint.x + dx, y: basePoint.y + dy }
          const projected = resolveProjectedSnap(rawMovedPos)
          if (!projected) continue
          const candidateDx = projected.snappedPoint.x - basePoint.x
          const candidateDy = projected.snappedPoint.y - basePoint.y
          if (movementAxis !== 'y' && Math.abs(candidateDx - dx) > 1e-6) {
            xCandidates.push({
              snappedDelta: candidateDx,
              offset: Math.abs(candidateDx - dx),
              guides: projected.guides,
            })
          }
          if (movementAxis !== 'x' && Math.abs(candidateDy - dy) > 1e-6) {
            yCandidates.push({
              snappedDelta: candidateDy,
              offset: Math.abs(candidateDy - dy),
              guides: projected.guides,
            })
          }
        }
      }

      if (xCandidates.length > 0) {
        xCandidates.sort((a, b) => a.offset - b.offset)
        snappedDx = xCandidates[0]!.snappedDelta
        nextVertexGuides.push(...xCandidates[0]!.guides)
      }
      if (yCandidates.length > 0) {
        yCandidates.sort((a, b) => a.offset - b.offset)
        snappedDy = yCandidates[0]!.snappedDelta
        nextVertexGuides.push(...yCandidates[0]!.guides)
      }

      if (anchor && initialPointsByWall) {
        const anchorInitial = initialPointsByWall.get(anchor.wallId)?.[anchor.pointIndex]
        if (anchorInitial) {
          targetPos = {
            x: anchorInitial.x + snappedDx,
            y: anchorInitial.y + snappedDy,
          }
        }
      }

      const shouldApplyGrid =
        (isSingleVertexMove && planView.snapToGrid) || (!isSingleVertexMove && snapToGridEnabled)
      if (!nearbyLine && shouldApplyGrid && anchor && initialPointsByWall) {
        const anchorInitial = initialPointsByWall.get(anchor.wallId)?.[anchor.pointIndex]
        if (anchorInitial) {
          const snappedAnchor = softSnapToGrid(
            {
              x: anchorInitial.x + snappedDx,
              y: anchorInitial.y + snappedDy,
            },
            planView.snapToGrid,
            movementAxis
          )
          snappedDx = snappedAnchor.x - anchorInitial.x
          snappedDy = snappedAnchor.y - anchorInitial.y
          targetPos = snappedAnchor
        }
      }

      if (mode === 'preview') {
        applyVertexMoveProjectedSnapGuides(nextVertexGuides)
      } else {
        applyVertexMoveProjectedSnapGuides([])
      }

      const byWall = new Map<string, Set<number>>()
      for (const target of targets) {
        let indices = byWall.get(target.wallId)
        if (!indices) {
          indices = new Set<number>()
          byWall.set(target.wallId, indices)
        }
        indices.add(target.pointIndex)
      }

      let overridePositions: Map<string, Point2> | null = null

      for (const [targetWallId, indices] of byWall) {
        const targetWall = walls.find((w) => w.id === targetWallId)
        if (!targetWall) continue

        const initialWallPoints = initialPointsByWall?.get(targetWallId) ?? null
        const wallDoors = baseDoors.filter((d) => d.wallId === targetWallId)
        const wallWindows = baseWindows.filter((w) => w.wallId === targetWallId)
        let currentPoints = targetWall.points
        const currentDoors = wallDoors.map((d) => ({ ...d }))
        const currentWindows = wallWindows.map((w) => ({ ...w }))
        const allDoorUpdates: Array<{ id: string; position: number }> = []
        const allWindowUpdates: Array<{ id: string; position: number }> = []
        const constraintResultsByPoint: Array<{
          pointIndex: number
          wasClamped: boolean
          doorUpdates: number
          windowUpdates: number
        }> = []

        const sortedIndices = Array.from(indices).sort((a, b) => a - b)

        if (sortedIndices.length === 1) {
          const pointIndex = sortedIndices[0]!
          const basePoint = initialWallPoints?.[pointIndex]
          const candidatePos =
            hasDelta && basePoint
              ? { x: basePoint.x + snappedDx, y: basePoint.y + snappedDy }
              : targetPos
          const initialOpenings =
            vertexDragInitialOpeningsRef.current?.wallId === targetWallId &&
            vertexDragInitialOpeningsRef.current?.pointIndex === pointIndex
              ? vertexDragInitialOpeningsRef.current.bySegment
              : undefined
          const result = constrainVertexMove(
            currentPoints,
            pointIndex,
            candidatePos,
            currentDoors,
            currentWindows,
            initialOpenings ? { initialOpeningsBySegment: initialOpenings } : undefined
          )
          constraintResultsByPoint.push({
            pointIndex,
            wasClamped: result.wasClamped,
            doorUpdates: result.doorUpdates.length,
            windowUpdates: result.windowUpdates.length,
          })
          currentPoints = result.points
          for (const u of result.doorUpdates) {
            const d = currentDoors.find((x) => x.id === u.id)
            if (d) d.position = u.position
          }
          for (const u of result.windowUpdates) {
            const w = currentWindows.find((x) => x.id === u.id)
            if (w) w.position = u.position
          }
          allDoorUpdates.push(...result.doorUpdates)
          allWindowUpdates.push(...result.windowUpdates)
        } else {
          if (!initialWallPoints || !hasDelta) {
            continue
          }
          const basePoints = initialWallPoints
          const movedSet = new Set(sortedIndices)
          const candidatePoints = basePoints.map((p, idx) =>
            movedSet.has(idx) ? { x: p.x + snappedDx, y: p.y + snappedDy } : p
          )
          const result = adjustVerticesAndOpenings(
            basePoints,
            candidatePoints,
            currentDoors,
            currentWindows,
            sortedIndices
          )
          currentPoints = result.points
          for (const u of result.doorUpdates) {
            const d = currentDoors.find((x) => x.id === u.id)
            if (d) d.position = u.position
          }
          for (const u of result.windowUpdates) {
            const w = currentWindows.find((x) => x.id === u.id)
            if (w) w.position = u.position
          }
          allDoorUpdates.push(...result.doorUpdates)
          allWindowUpdates.push(...result.windowUpdates)
          constraintResultsByPoint.push({
            pointIndex: -1,
            wasClamped: result.wasClamped,
            doorUpdates: result.doorUpdates.length,
            windowUpdates: result.windowUpdates.length,
          })
        }

        const doorUpdateById = new Map<string, number>()
        for (const u of allDoorUpdates) {
          doorUpdateById.set(u.id, u.position)
        }
        const windowUpdateById = new Map<string, number>()
        for (const u of allWindowUpdates) {
          windowUpdateById.set(u.id, u.position)
        }

        const excludeIds = new Set<string>([...doorUpdateById.keys(), ...windowUpdateById.keys()])
        const { doorUpdates: preservedDoorUpdates, windowUpdates: preservedWindowUpdates } =
          preserveOpeningPositionsAfterPointChange(
            targetWall.points,
            currentPoints,
            currentDoors,
            currentWindows,
            excludeIds
          )

        for (const u of preservedDoorUpdates) {
          doorUpdateById.set(u.id, u.position)
          const d = currentDoors.find((x) => x.id === u.id)
          if (d) d.position = u.position
        }
        for (const u of preservedWindowUpdates) {
          windowUpdateById.set(u.id, u.position)
          const w = currentWindows.find((x) => x.id === u.id)
          if (w) w.position = u.position
        }

        const finalDoorUpdates = Array.from(doorUpdateById, ([id, position]) => ({
          id,
          position,
        }))
        const finalWindowUpdates = Array.from(windowUpdateById, ([id, position]) => ({
          id,
          position,
        }))

        if (mode === 'preview') {
          if (!overridePositions) overridePositions = new Map()
          for (const pointIndex of indices) {
            const pt = currentPoints[pointIndex]
            if (pt) overridePositions.set(`${targetWallId}:${pointIndex}`, pt)
          }
        }

        if (mode === 'preview') {
          applyPreviewWalls((prev) => {
            const next = new Map(prev ?? undefined)
            next.set(targetWallId, { ...targetWall, points: currentPoints })
            return next
          })
          if (finalDoorUpdates.length > 0 || finalWindowUpdates.length > 0) {
            applyPreviewDoors((prev) => {
              const next = new Map(prev ?? undefined)
              for (const u of finalDoorUpdates) {
                const base =
                  baseDoors.find((d) => d.id === u.id) ?? (prev?.get(u.id) as Door | undefined)
                if (base) next.set(u.id, { ...base, position: u.position })
              }
              return next
            })
            applyPreviewWindows((prev) => {
              const next = new Map(prev ?? undefined)
              for (const u of finalWindowUpdates) {
                const base =
                  baseWindows.find((w) => w.id === u.id) ?? (prev?.get(u.id) as Window | undefined)
                if (base) next.set(u.id, { ...base, position: u.position })
              }
              return next
            })
          }
        } else {
          vertexDragInitialOpeningsRef.current = null
          updateWall(targetWallId, {
            points: currentPoints,
            doorUpdates: finalDoorUpdates,
            windowUpdates: finalWindowUpdates,
          })
          vertexDragAnchorRef.current = null
          vertexDragInitialPointsRef.current = null
        }
      }
      if (mode === 'preview' && overridePositions && overridePositions.size > 0)
        return { overridePositions }
    },
    [
      resolveNearbyFloorLineSnap,
      planView.snapToProjection,
      planView.snapToGrid,
      planView.zoom,
      softSnapToGrid,
      applyVertexMoveProjectedSnapGuides,
      baseDoors,
      baseWindows,
      updateWall,
      pointDragTargetsRef,
      vertexDragAnchorRef,
      vertexDragInitialPointsRef,
      vertexDragInitialOpeningsRef,
      applyPreviewWalls,
      applyPreviewDoors,
      applyPreviewWindows,
    ]
  )

  return {
    handleWallHover,
    handleOpeningPreviewOverrideChange,
    buildMergedPointTargets,
    snapGraphicFloorPoint,
    applyMergedPointMove,
  }
}
