import type { usePlanGeometryGestureState } from '@/hooks/plan/usePlanGeometryGestureState'
import type { usePlanGeometrySnapping } from '@/hooks/plan/usePlanGeometrySnapping'
import type { usePlanWallVertexGestures } from '@/hooks/plan/usePlanWallVertexGestures'
import type { usePlanGeometrySelectionDrag } from '@/hooks/plan/usePlanGeometrySelectionDrag'
import type { usePlanWallGeometryActions } from '@/hooks/plan/usePlanWallGeometryActions'
import type { usePlanGeometrySelection } from '@/hooks/plan/usePlanGeometrySelection'
import type { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'
import {
  executePlanGeometryBatch,
  EMPTY_WALL_SELECTION_IDS,
  EMPTY_POINT_SELECTION,
} from '@/components/canvas/plan/planCanvasBindings'
import React from 'react'
import { type CommandInvocation } from '@/lib/commands/project'
import { parseWallPointIds } from '@/lib/plan/planCanvasPointSelection'

import type { Wall, Point2, Window } from '@/types/schema'
import { WallRenderer } from '@/components/canvas/plan'
import { isPrimaryPlanActivationEvent } from '@/lib/canvas/planPointerEvent'
import {
  handleInsertPoint,
  getNearestSegmentIndex,
  handleClipWall,
} from '@/handlers/plan/wallDrawing'
import { getOpeningsBySegment } from '@/lib/plan/constraints'

import { isCurvedWall } from '@/lib/plan/wallCurve'
import type { OpeningOnSegment } from '@/lib/plan/constraints'

interface PlanWallGeometryOptions {
  activeFloor: import('@/types/schema').Floor | null | undefined
  wallsForRender: ReturnType<typeof usePlanCanvasGeometry>['wallsForRender']
  doorsForRender: ReturnType<typeof usePlanCanvasGeometry>['doorsForRender']
  windowsForRender: ReturnType<typeof usePlanCanvasGeometry>['windowsForRender']
  canvasPxPerMeter: number
  activeTool: import('@/types/ui').PlanToolMode
  planView: import('@/types/ui').ViewState
  isExporting: boolean
  selectedWallIds: ReturnType<typeof usePlanGeometrySelection>['selectedWallIds']
  selectedPointIndices: Map<string, number[]>
  selectedSegmentIndices: Map<string, number[]>
  isFloorPlanMode: boolean
  commitWallSegmentLength: ReturnType<typeof usePlanWallGeometryActions>['commitWallSegmentLength']
  commitWallOpeningDistance: ReturnType<
    typeof usePlanWallGeometryActions
  >['commitWallOpeningDistance']
  handleWallDimensionDrag: ReturnType<typeof usePlanWallGeometryActions>['handleWallDimensionDrag']
  shouldHandleWallHover: boolean
  hoveredWallId: string | null
  hoveredDoorId: string | null
  hoveredWindowId: string | null
  openingPreview: {
    wallId: string
    position: number
    width: number
    kind: 'door' | 'window'
    valid: boolean
    doorSwing?: 'left' | 'right' | undefined
    doorDirection?: 'in' | 'out' | undefined
  } | null
  shouldKeepGeometryTouchSelection: ReturnType<
    typeof usePlanGeometrySelection
  >['shouldKeepGeometryTouchSelection']
  retainDirectOpeningSelectionForMixed: ReturnType<
    typeof usePlanGeometrySelection
  >['retainDirectOpeningSelectionForMixed']
  clearMixedOpeningSelection: ReturnType<
    typeof usePlanGeometrySelection
  >['clearMixedOpeningSelection']
  gridSize: ReturnType<typeof usePlanCanvasGeometry>['gridSize']
  updateWall: (
    wallId: string,
    updates: Partial<import('@/types/schema').Wall> & {
      doorUpdates?: { id: string; position: number }[] | undefined
      windowUpdates?: { id: string; position: number }[] | undefined
    }
  ) => void
  activeFloorId: string | null
  applySelection: (selection: import('@/types/ui').Selection) => void
  applyClipPreviewPoints: React.Dispatch<
    React.SetStateAction<import('@/types/schema').Point2[] | null>
  >
  viewportUI: import('zustand/vanilla').StoreApi<import('@/stores/uiStore').UIState>
  applySelectedPointIndices: React.Dispatch<React.SetStateAction<Map<string, number[]>>>
  applySelectedSegmentIndices: React.Dispatch<React.SetStateAction<Map<string, number[]>>>
  getCurrentMixedPointSelection: ReturnType<
    typeof usePlanGeometrySelection
  >['getCurrentMixedPointSelection']
  applySelectedStairPointIndices: React.Dispatch<React.SetStateAction<Map<string, number[]>>>
  buildEncodedFloorPointIds: ReturnType<
    typeof usePlanGeometrySelection
  >['buildEncodedFloorPointIds']
  selection: import('@/types/ui').Selection
  beginWallSelectionDrag: ReturnType<typeof usePlanGeometrySelectionDrag>['beginWallSelectionDrag']
  updateWallSelectionDrag: ReturnType<
    typeof usePlanGeometrySelectionDrag
  >['updateWallSelectionDrag']
  endWallSelectionDrag: ReturnType<typeof usePlanGeometrySelectionDrag>['endWallSelectionDrag']
  handleWallHover: ReturnType<typeof usePlanWallVertexGestures>['handleWallHover']
  resolveScopedPointTarget: ReturnType<typeof usePlanGeometrySnapping>['resolveScopedPointTarget']
  selectedStairPointIndices: Map<string, number[]>
  scopedWallIdForVertexSelection: ReturnType<
    typeof usePlanGeometrySnapping
  >['scopedWallIdForVertexSelection']
  pointDragTargetsRef: ReturnType<typeof usePlanGeometryGestureState>['pointDragTargetsRef']
  vertexDragInitialOpeningsRef: ReturnType<
    typeof usePlanGeometryGestureState
  >['vertexDragInitialOpeningsRef']
  vertexDragAnchorRef: ReturnType<typeof usePlanGeometryGestureState>['vertexDragAnchorRef']
  vertexDragInitialPointsRef: ReturnType<
    typeof usePlanGeometryGestureState
  >['vertexDragInitialPointsRef']
  buildMergedPointTargets: ReturnType<typeof usePlanWallVertexGestures>['buildMergedPointTargets']
  baseDoors: ReturnType<typeof usePlanCanvasGeometry>['baseDoors']
  baseWindows: ReturnType<typeof usePlanCanvasGeometry>['baseWindows']
  applyMergedPointMove: ReturnType<typeof usePlanWallVertexGestures>['applyMergedPointMove']
  applyPreviewWalls: ReturnType<typeof usePlanGeometryGestureState>['applyPreviewWalls']
  lastWallPointUpdateTimeRef: React.RefObject<number>
  theme: import('@/types/ui').Theme
  selectedDoorIds: ReturnType<typeof usePlanGeometrySelection>['selectedDoorIds']
  selectedWindowIds: ReturnType<typeof usePlanGeometrySelection>['selectedWindowIds']
  canSelectDoorsInInsertMode: boolean
  toggleMixedOpeningSelection: ReturnType<
    typeof usePlanGeometrySelection
  >['toggleMixedOpeningSelection']
  applyHoveredDoorId: React.Dispatch<React.SetStateAction<string | null>>
  canSelectWindowsInInsertMode: boolean
  applyHoveredWindowId: React.Dispatch<React.SetStateAction<string | null>>
  shouldListenToWalls: boolean
  doorsListening: boolean
  windowsListening: boolean
}

export function renderPlanWallGeometry({
  activeFloor,
  wallsForRender,
  doorsForRender,
  windowsForRender,
  canvasPxPerMeter,
  activeTool,
  planView,
  isExporting,
  selectedWallIds,
  selectedPointIndices,
  selectedSegmentIndices,
  isFloorPlanMode,
  commitWallSegmentLength,
  commitWallOpeningDistance,
  handleWallDimensionDrag,
  shouldHandleWallHover,
  hoveredWallId,
  hoveredDoorId,
  hoveredWindowId,
  openingPreview,
  shouldKeepGeometryTouchSelection,
  retainDirectOpeningSelectionForMixed,
  clearMixedOpeningSelection,
  gridSize,
  updateWall,
  activeFloorId,
  applySelection,
  applyClipPreviewPoints,
  viewportUI,
  applySelectedPointIndices,
  applySelectedSegmentIndices,
  getCurrentMixedPointSelection,
  applySelectedStairPointIndices,
  buildEncodedFloorPointIds,
  selection,
  beginWallSelectionDrag,
  updateWallSelectionDrag,
  endWallSelectionDrag,
  handleWallHover,
  resolveScopedPointTarget,
  selectedStairPointIndices,
  scopedWallIdForVertexSelection,
  pointDragTargetsRef,
  vertexDragInitialOpeningsRef,
  vertexDragAnchorRef,
  vertexDragInitialPointsRef,
  buildMergedPointTargets,
  baseDoors,
  baseWindows,
  applyMergedPointMove,
  applyPreviewWalls,
  lastWallPointUpdateTimeRef,
  theme,
  selectedDoorIds,
  selectedWindowIds,
  canSelectDoorsInInsertMode,
  toggleMixedOpeningSelection,
  applyHoveredDoorId,
  canSelectWindowsInInsertMode,
  applyHoveredWindowId,
  shouldListenToWalls,
  doorsListening,
  windowsListening,
}: PlanWallGeometryOptions) {
  return (
    activeFloor?.floorPlan && (
      <WallRenderer
        walls={wallsForRender}
        doors={doorsForRender}
        windows={windowsForRender}
        // Interpret master wall thickness as centimeters and convert to px in WallRenderer using pxPerMeter.
        masterWallThickness={activeFloor.floorPlan.masterWallThickness}
        pxPerMeter={canvasPxPerMeter}
        interactionMode={activeTool}
        zoom={planView.zoom}
        selectedWallIds={isExporting ? EMPTY_WALL_SELECTION_IDS : selectedWallIds}
        selectedPointIndices={isExporting ? EMPTY_POINT_SELECTION : selectedPointIndices}
        selectedSegmentIndices={isExporting ? EMPTY_POINT_SELECTION : selectedSegmentIndices}
        showSegmentMeasurements={isFloorPlanMode && activeTool !== 'none' && !isExporting}
        onSegmentLengthCommit={commitWallSegmentLength}
        onOpeningDistanceCommit={commitWallOpeningDistance}
        onSegmentDimensionDrag={handleWallDimensionDrag}
        hoveredWallId={shouldHandleWallHover && !isExporting ? hoveredWallId : null}
        hoveredDoorId={isFloorPlanMode && !isExporting ? hoveredDoorId : null}
        hoveredWindowId={isFloorPlanMode && !isExporting ? hoveredWindowId : null}
        previewOpening={
          isFloorPlanMode && !isExporting && openingPreview?.valid
            ? {
                wallId: openingPreview.wallId,
                position: openingPreview.position,
                width: openingPreview.width,
                kind: openingPreview.kind,
                doorSwing: openingPreview.doorSwing,
                doorDirection: openingPreview.doorDirection,
              }
            : null
        }
        onWallClick={(wallId, e) => {
          if (!isPrimaryPlanActivationEvent(e.evt)) return
          e.cancelBubble = true
          // Both taps must keep the group: BaseCanvas opens its menu on the second.
          if (shouldKeepGeometryTouchSelection(e.evt, 'wall', wallId)) return
          const stage = e.target.getStage()
          const pointer = stage?.getPointerPosition()
          const isMultiSelect = !!(e.evt && (e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey))
          if (activeTool === 'select') {
            if (isMultiSelect) retainDirectOpeningSelectionForMixed()
            else clearMixedOpeningSelection()
          }
          const canvasPoint: Point2 | null =
            stage && pointer
              ? {
                  x: (pointer.x - planView.pan.x) / planView.zoom,
                  y: (pointer.y - planView.pan.y) / planView.zoom,
                }
              : null
          if (activeTool === 'insertPoint' && activeFloor?.floorPlan) {
            if (canvasPoint) {
              const walls = activeFloor.floorPlan.walls
              const wall = walls.find((w: Wall) => w.id === wallId)
              if (wall && !isCurvedWall(wall)) {
                const segmentIndex = getNearestSegmentIndex(wall, canvasPoint)
                const newPoints = handleInsertPoint(
                  wall,
                  segmentIndex,
                  canvasPoint,
                  gridSize,
                  planView.snapToGrid
                )
                updateWall(wallId, { points: newPoints })
              }
            }
          } else if (activeTool === 'clipWall' && activeFloorId && activeFloor?.floorPlan) {
            const walls = activeFloor.floorPlan.walls
            const wall = walls.find((w: Wall) => w.id === wallId)
            if (wall && !isCurvedWall(wall)) {
              const { walls: newWalls } = handleClipWall(wall, walls, canvasPoint ?? undefined)
              const isNoOp = newWalls.length === 1 && newWalls[0]?.id === wall.id
              if (!isNoOp) {
                const commands: CommandInvocation[] = [
                  {
                    id: 'entities.delete',
                    input: { refs: [{ kind: 'wall', id: wallId }] },
                  },
                ]
                const minLengthSq = 100
                newWalls.forEach((w) => {
                  const pts = w.points
                  let degenerate = pts.length < 2
                  if (!degenerate && pts.length === 2) {
                    const dx = pts[1]!.x - pts[0]!.x
                    const dy = pts[1]!.y - pts[0]!.y
                    degenerate = dx * dx + dy * dy < minLengthSq
                  }
                  if (!degenerate)
                    commands.push({
                      id: 'plan.createBuildingGeometry',
                      input: {
                        kind: 'wall',
                        floorId: activeFloorId,
                        points: w.points,
                        thickness: w.thickness,
                      },
                    })
                })
                if (executePlanGeometryBatch(commands, 'clip wall')) {
                  applySelection({ type: null, ids: [] })
                  applyClipPreviewPoints(null)
                }
              }
              return
            }
          }
          const liveSelection = viewportUI.getState().selection
          const isWallScopedOrSelected =
            liveSelection.type === 'wall'
              ? liveSelection.ids.includes(wallId)
              : liveSelection.type === 'wallPoint'
                ? parseWallPointIds(liveSelection.ids).has(wallId)
                : false
          if (
            activeTool === 'select' &&
            activeFloor?.floorPlan &&
            canvasPoint &&
            (isWallScopedOrSelected || isMultiSelect)
          ) {
            const wall = activeFloor.floorPlan.walls.find((w: Wall) => w.id === wallId)
            if (wall && !isCurvedWall(wall) && wall.points.length >= 2) {
              const segmentIndex = getNearestSegmentIndex(wall, canvasPoint)
              if (segmentIndex >= 0 && segmentIndex < wall.points.length - 1) {
                const endpointIndices = [segmentIndex, segmentIndex + 1]
                if (!isMultiSelect) {
                  applySelectedPointIndices(new Map([[wallId, endpointIndices]]))
                  applySelectedSegmentIndices(new Map([[wallId, [segmentIndex]]]))
                  applySelection({ type: 'wall', ids: [wallId] })
                  return
                }
                const { wallPoints: nextPoints, stairPoints: nextStairs } =
                  getCurrentMixedPointSelection()
                const nextSegments = new Map(selectedSegmentIndices)
                const existingPoints = nextPoints.get(wallId) ?? []
                const mergedPoints = Array.from(
                  new Set([...existingPoints, ...endpointIndices])
                ).sort((a, b) => a - b)
                nextPoints.set(wallId, mergedPoints)
                const existingSegments = nextSegments.get(wallId) ?? []
                const mergedSegments = Array.from(
                  new Set([...existingSegments, segmentIndex])
                ).sort((a, b) => a - b)
                nextSegments.set(wallId, mergedSegments)
                applySelectedPointIndices(nextPoints)
                applySelectedStairPointIndices(nextStairs)
                applySelectedSegmentIndices(nextSegments)
                if (nextStairs.size > 0) {
                  const ids = buildEncodedFloorPointIds(nextPoints, nextStairs)
                  applySelection(
                    ids.length > 0 ? { type: 'wallPoint', ids } : { type: null, ids: [] }
                  )
                } else {
                  applySelection({ type: 'wall', ids: Array.from(nextPoints.keys()) })
                }
                return
              }
            }
          }
          // Default wall selection: select the wall and all of its points for movement.
          if (activeFloor?.floorPlan) {
            const wall = activeFloor.floorPlan.walls.find((w: Wall) => w.id === wallId)
            if (wall) {
              const wallPointIndices = wall.points.map((_: Point2, idx: number) => idx)
              if (isMultiSelect) {
                const { wallPoints: nextWalls, stairPoints: nextStairs } =
                  getCurrentMixedPointSelection()
                nextWalls.set(wallId, wallPointIndices)
                applySelectedPointIndices(nextWalls)
                applySelectedStairPointIndices(nextStairs)
                applySelectedSegmentIndices(new Map())
                if (nextStairs.size > 0 || selection.type === 'wallPoint') {
                  const ids = buildEncodedFloorPointIds(nextWalls, nextStairs)
                  applySelection(
                    ids.length > 0 ? { type: 'wallPoint', ids } : { type: null, ids: [] }
                  )
                } else {
                  applySelection({ type: 'wall', ids: Array.from(nextWalls.keys()) })
                }
                return
              }
              applySelectedPointIndices(new Map([[wallId, wallPointIndices]]))
              applySelectedSegmentIndices(new Map())
            }
          }
          applySelection({ type: 'wall', ids: [wallId] })
        }}
        onWallDragStart={(_wallId, e) => {
          const stage = e.target.getStage()
          const pointer = stage?.getPointerPosition()
          if (!stage || !pointer) return
          const canvasPoint: Point2 = {
            x: (pointer.x - planView.pan.x) / planView.zoom,
            y: (pointer.y - planView.pan.y) / planView.zoom,
          }
          beginWallSelectionDrag(canvasPoint)
        }}
        onWallDragMove={(_wallId, e) => {
          const stage = e.target.getStage()
          const pointer = stage?.getPointerPosition()
          if (!stage || !pointer) return
          const canvasPoint: Point2 = {
            x: (pointer.x - planView.pan.x) / planView.zoom,
            y: (pointer.y - planView.pan.y) / planView.zoom,
          }
          updateWallSelectionDrag(canvasPoint)
        }}
        onWallDragEnd={(_wallId, e) => {
          const stage = e.target.getStage()
          const pointer = stage?.getPointerPosition()
          if (stage && pointer) {
            const canvasPoint: Point2 = {
              x: (pointer.x - planView.pan.x) / planView.zoom,
              y: (pointer.y - planView.pan.y) / planView.zoom,
            }
            updateWallSelectionDrag(canvasPoint)
          }
          endWallSelectionDrag()
        }}
        onWallMouseMove={
          shouldHandleWallHover
            ? (wallId, e) => {
                const stage = e.target.getStage()
                const pointer = stage?.getPointerPosition()
                const canvasPoint: Point2 | null =
                  stage && pointer
                    ? {
                        x: (pointer.x - planView.pan.x) / planView.zoom,
                        y: (pointer.y - planView.pan.y) / planView.zoom,
                      }
                    : null
                handleWallHover(wallId, canvasPoint)
              }
            : undefined
        }
        onWallMouseLeave={
          shouldHandleWallHover
            ? () => {
                handleWallHover(null, null)
              }
            : undefined
        }
        onPointClick={(wallId, pointIndex, e) => {
          if (!isPrimaryPlanActivationEvent(e.evt)) return
          e.cancelBubble = true
          if (shouldKeepGeometryTouchSelection(e.evt, 'wall', wallId, pointIndex)) return
          applySelectedSegmentIndices(new Map())
          const resolvedTarget = resolveScopedPointTarget(wallId, pointIndex, e)
          if (!resolvedTarget) return
          const targetWallId = resolvedTarget.wallId
          const targetPointIndex = resolvedTarget.pointIndex
          const isMultiSelect = !!(e.evt && (e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey))
          if (isMultiSelect) retainDirectOpeningSelectionForMixed()
          else clearMixedOpeningSelection()
          const currentMixedSelection = isMultiSelect ? getCurrentMixedPointSelection() : null

          const baseWallPoints =
            currentMixedSelection?.wallPoints ??
            (selection.type === 'wallPoint'
              ? parseWallPointIds(selection.ids)
              : selectedPointIndices)
          let next = new Map(baseWallPoints)
          const nextStairs = currentMixedSelection?.stairPoints ?? new Map<string, number[]>()

          if (!isMultiSelect) {
            next = new Map([[targetWallId, [targetPointIndex]]])
          } else {
            const existing = next.get(targetWallId) ?? []
            const alreadySelected = existing.includes(targetPointIndex)
            if (alreadySelected) {
              const updated = existing.filter((i) => i !== targetPointIndex)
              if (updated.length > 0) {
                next.set(targetWallId, updated)
              } else {
                next.delete(targetWallId)
              }
            } else {
              next.set(
                targetWallId,
                [...existing, targetPointIndex].sort((a, b) => a - b)
              )
            }
          }

          if (nextStairs.size > 0) {
            applySelectedStairPointIndices(nextStairs)
          } else if (selectedStairPointIndices.size > 0) {
            applySelectedStairPointIndices(new Map())
          }

          const floorPointIds = buildEncodedFloorPointIds(next, nextStairs)
          const wallIds = Array.from(next.keys())
          if (floorPointIds.length === 0) {
            applySelection({ type: null, ids: [] })
          } else if (nextStairs.size === 0 && wallIds.length > 0) {
            applySelection({ type: 'wallPoint', ids: floorPointIds })
          } else {
            applySelection({ type: 'wallPoint', ids: floorPointIds })
          }
        }}
        onPointDragStart={(wallId, pointIndex) => {
          if (scopedWallIdForVertexSelection && wallId !== scopedWallIdForVertexSelection) {
            return
          }
          const walls = activeFloor?.floorPlan?.walls ?? []
          if (!walls.length) {
            pointDragTargetsRef.current = []
            vertexDragInitialOpeningsRef.current = null
            vertexDragAnchorRef.current = null
            vertexDragInitialPointsRef.current = null
            return
          }

          const activeWallPoints =
            selection.type === 'wallPoint' ? parseWallPointIds(selection.ids) : selectedPointIndices
          const isAlreadySelected = activeWallPoints.get(wallId)?.includes(pointIndex) ?? false

          let dragTargets: Array<{ wallId: string; pointIndex: number }> = []

          if (activeWallPoints.size > 0 && isAlreadySelected) {
            const mergedByWall = new Map<string, Set<number>>()
            for (const [wid, indices] of activeWallPoints.entries()) {
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
            for (const [wid, set] of mergedByWall.entries()) {
              for (const idx of set) {
                dragTargets.push({ wallId: wid, pointIndex: idx })
              }
            }
          } else {
            dragTargets = buildMergedPointTargets(walls, wallId, pointIndex)
          }

          pointDragTargetsRef.current = dragTargets

          if (!isAlreadySelected || activeWallPoints.size === 0) {
            const nextPoints = new Map([[wallId, [pointIndex]]])
            applySelection({
              type: 'wallPoint',
              ids: buildEncodedFloorPointIds(nextPoints, new Map()),
            })
          }

          vertexDragAnchorRef.current = { wallId, pointIndex }
          const initialByWall = new Map<string, Point2[]>()
          for (const w of walls) {
            initialByWall.set(
              w.id,
              w.points.map((p: Point2) => ({ x: p.x, y: p.y }))
            )
          }
          vertexDragInitialPointsRef.current = initialByWall

          const targets = pointDragTargetsRef.current
          if (
            targets.length === 1 &&
            targets[0]!.wallId === wallId &&
            targets[0]!.pointIndex === pointIndex
          ) {
            const wall = walls.find((w: Wall) => w.id === wallId)
            if (wall && wall.points.length >= 2) {
              const wallDoors = baseDoors.filter((d) => d.wallId === wallId)
              const wallWindows = baseWindows.filter((w: Window) => w.wallId === wallId)
              const bySegment = getOpeningsBySegment(wall.points, wallDoors, wallWindows)
              const leftIdx = pointIndex - 1
              const rightIdx = pointIndex
              const snapshot = new Map<number, OpeningOnSegment[]>()
              if (leftIdx >= 0 && bySegment.has(leftIdx))
                snapshot.set(leftIdx, bySegment.get(leftIdx)!)
              if (rightIdx < wall.points.length && bySegment.has(rightIdx))
                snapshot.set(rightIdx, bySegment.get(rightIdx)!)
              vertexDragInitialOpeningsRef.current = {
                wallId,
                pointIndex,
                bySegment: snapshot,
              }
            } else {
              vertexDragInitialOpeningsRef.current = null
            }
          } else {
            vertexDragInitialOpeningsRef.current = null
          }
        }}
        onPointDragMove={(wallId, pointIndex, newPos) => {
          if (scopedWallIdForVertexSelection && wallId !== scopedWallIdForVertexSelection) {
            return
          }
          const walls = activeFloor?.floorPlan?.walls ?? []
          if (!walls.length) return
          if (pointDragTargetsRef.current.length === 0) {
            pointDragTargetsRef.current = buildMergedPointTargets(walls, wallId, pointIndex)
          }
          // Run constraint every frame and return clamped position so handle stays at limit (no flicker).
          const result = applyMergedPointMove(walls, newPos, false, 'preview')
          return result?.overridePositions.get(`${wallId}:${pointIndex}`)
        }}
        onPointDragEnd={(wallId, pointIndex, newPos) => {
          if (scopedWallIdForVertexSelection && wallId !== scopedWallIdForVertexSelection) {
            return
          }
          const walls = activeFloor?.floorPlan?.walls ?? []
          if (!walls.length) return
          if (pointDragTargetsRef.current.length === 0) {
            pointDragTargetsRef.current = buildMergedPointTargets(walls, wallId, pointIndex)
          }
          // On release, snap the final position to the grid for all merged points.
          applyMergedPointMove(walls, newPos, true, 'commit')
          pointDragTargetsRef.current = []
          vertexDragAnchorRef.current = null
          vertexDragInitialPointsRef.current = null
          applyPreviewWalls(null)
          lastWallPointUpdateTimeRef.current = 0
        }}
        // In floor plan mode, always show wall points; only allow dragging when using the implicit select+move tool.
        showPointHandles={isFloorPlanMode}
        pointHandlesDraggable={isFloorPlanMode && activeTool === 'select'}
        draggableSelectedWalls={isFloorPlanMode && activeTool === 'select'}
        theme={theme.mode}
        customWallColors={theme.wallColors}
        selectedDoorIds={selectedDoorIds}
        selectedWindowIds={selectedWindowIds}
        onDoorClick={(doorId, e) => {
          if (!isPrimaryPlanActivationEvent(e.evt)) return
          if (shouldKeepGeometryTouchSelection(e.evt, 'door', doorId)) return
          // In insert-point mode, openings should not be selectable.
          if (activeTool === 'insertPoint') {
            e.cancelBubble = true
            return
          }
          if (activeTool === 'insertDoor' && !canSelectDoorsInInsertMode) {
            return
          }
          if (activeTool === 'insertWindow') {
            return
          }
          e.cancelBubble = true
          const isMultiSelect = !!(e.evt && (e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey))
          if (isMultiSelect) {
            toggleMixedOpeningSelection('door', doorId)
            return
          }
          clearMixedOpeningSelection()
          applySelection({ type: 'door', ids: [doorId] })
        }}
        onDoorMouseEnter={(doorId) => applyHoveredDoorId(doorId)}
        onDoorMouseLeave={() => applyHoveredDoorId(null)}
        onWindowClick={(windowId, e) => {
          if (!isPrimaryPlanActivationEvent(e.evt)) return
          if (shouldKeepGeometryTouchSelection(e.evt, 'window', windowId)) return
          if (activeTool === 'insertPoint') {
            e.cancelBubble = true
            return
          }
          if (activeTool === 'insertWindow' && !canSelectWindowsInInsertMode) {
            return
          }
          if (activeTool === 'insertDoor') {
            return
          }
          e.cancelBubble = true
          const isMultiSelect = !!(e.evt && (e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey))
          if (isMultiSelect) {
            toggleMixedOpeningSelection('window', windowId)
            return
          }
          clearMixedOpeningSelection()
          applySelection({ type: 'window', ids: [windowId] })
        }}
        onWindowMouseEnter={(windowId) => applyHoveredWindowId(windowId)}
        onWindowMouseLeave={() => applyHoveredWindowId(null)}
        listening={shouldListenToWalls || doorsListening || windowsListening}
        wallsListening={shouldListenToWalls}
        doorsListening={doorsListening}
        windowsListening={windowsListening}
      />
    )
  )
}
