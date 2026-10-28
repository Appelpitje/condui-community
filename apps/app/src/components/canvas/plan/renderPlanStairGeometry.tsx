import type { usePlanGeometrySelectionDrag } from '@/hooks/plan/usePlanGeometrySelectionDrag'
import type { usePlanGeometrySnapping } from '@/hooks/plan/usePlanGeometrySnapping'
import type { usePlanGeometrySelection } from '@/hooks/plan/usePlanGeometrySelection'
import type { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'
import { EMPTY_POINT_SELECTION } from '@/components/canvas/plan/planCanvasBindings'
import React from 'react'

import { StairRenderer } from '@/components/canvas/plan'

interface PlanStairGeometryOptions {
  activeFloor: import('@/types/schema').Floor | null | undefined
  stairsForRender: ReturnType<typeof usePlanCanvasGeometry>['stairsForRender']
  isExporting: boolean
  activeTool: import('@/types/ui').PlanToolMode
  theme: import('@/types/ui').Theme
  planView: import('@/types/ui').ViewState
  canvasPxPerMeter: number
  spiralRotationPreview: ReturnType<typeof usePlanCanvasGeometry>['spiralRotationPreview']
  selectedStairId: ReturnType<typeof usePlanGeometrySelection>['selectedStairId']
  hoveredStairId: string | null
  selectedStairPointIndices: Map<string, number[]>
  shouldKeepGeometryTouchSelection: ReturnType<
    typeof usePlanGeometrySelection
  >['shouldKeepGeometryTouchSelection']
  applySelection: (selection: import('@/types/ui').Selection) => void
  applySelectedStairPointIndices: React.Dispatch<React.SetStateAction<Map<string, number[]>>>
  getCurrentMixedPointSelection: ReturnType<
    typeof usePlanGeometrySelection
  >['getCurrentMixedPointSelection']
  buildEncodedFloorPointIds: ReturnType<
    typeof usePlanGeometrySelection
  >['buildEncodedFloorPointIds']
  applyHoveredStairId: React.Dispatch<React.SetStateAction<string | null>>
  makeCanvasPointFromEvent: ReturnType<typeof usePlanGeometrySnapping>['makeCanvasPointFromEvent']
  beginStairSelectionDrag: ReturnType<
    typeof usePlanGeometrySelectionDrag
  >['beginStairSelectionDrag']
  updateStairSelectionDrag: ReturnType<
    typeof usePlanGeometrySelectionDrag
  >['updateStairSelectionDrag']
  endStairSelectionDrag: ReturnType<typeof usePlanGeometrySelectionDrag>['endStairSelectionDrag']
  handleStairPointDragStart: ReturnType<
    typeof usePlanGeometrySelectionDrag
  >['handleStairPointDragStart']
  handleStairPointMove: ReturnType<typeof usePlanGeometrySelectionDrag>['handleStairPointMove']
  handleStairPointDragEnd: ReturnType<
    typeof usePlanGeometrySelectionDrag
  >['handleStairPointDragEnd']
}

export function renderPlanStairGeometry({
  activeFloor,
  stairsForRender,
  isExporting,
  activeTool,
  theme,
  planView,
  canvasPxPerMeter,
  spiralRotationPreview,
  selectedStairId,
  hoveredStairId,
  selectedStairPointIndices,
  shouldKeepGeometryTouchSelection,
  applySelection,
  applySelectedStairPointIndices,
  getCurrentMixedPointSelection,
  buildEncodedFloorPointIds,
  applyHoveredStairId,
  makeCanvasPointFromEvent,
  beginStairSelectionDrag,
  updateStairSelectionDrag,
  endStairSelectionDrag,
  handleStairPointDragStart,
  handleStairPointMove,
  handleStairPointDragEnd,
}: PlanStairGeometryOptions) {
  return (
    activeFloor?.floorPlan && (
      <StairRenderer
        stairs={stairsForRender}
        activeTool={isExporting ? 'none' : activeTool}
        themeMode={theme.mode}
        zoom={planView.zoom}
        pxPerMeter={canvasPxPerMeter}
        renderMode="geometry"
        spiralRotationPreview={spiralRotationPreview}
        selectedStairId={isExporting ? null : selectedStairId}
        hoveredStairId={isExporting ? null : hoveredStairId}
        selectedPointIndices={isExporting ? EMPTY_POINT_SELECTION : selectedStairPointIndices}
        onStairSelect={(stairId, event) => {
          if (shouldKeepGeometryTouchSelection(event, 'stair', stairId)) return
          const isMultiSelect = !!(event && (event.shiftKey || event.ctrlKey || event.metaKey))
          if (!isMultiSelect) {
            applySelection({ type: 'stair', ids: [stairId] })
            applySelectedStairPointIndices(new Map())
            return
          }
          const { wallPoints: nextWalls, stairPoints: nextStairs } = getCurrentMixedPointSelection()
          const existing = nextStairs.get(stairId) ?? []
          const allPoints =
            stairsForRender.find((s) => s.id === stairId)?.points.map((_, idx) => idx) ?? []
          const alreadyWhole =
            existing.length === allPoints.length && existing.every((idx) => allPoints.includes(idx))
          if (alreadyWhole) {
            nextStairs.delete(stairId)
          } else if (allPoints.length > 0) {
            nextStairs.set(stairId, allPoints)
          }
          const ids = buildEncodedFloorPointIds(nextWalls, nextStairs)
          applySelectedStairPointIndices(nextStairs)
          applySelection(ids.length > 0 ? { type: 'wallPoint', ids } : { type: null, ids: [] })
        }}
        onStairHover={applyHoveredStairId}
        onStairDragStart={(_stairId, e) => {
          const canvasPoint = makeCanvasPointFromEvent(e)
          if (!canvasPoint) return
          beginStairSelectionDrag(canvasPoint, 'free')
        }}
        onStairDragMove={(_stairId, e) => {
          const canvasPoint = makeCanvasPointFromEvent(e)
          if (!canvasPoint) return
          updateStairSelectionDrag(canvasPoint)
        }}
        onStairDragEnd={(_stairId, e) => {
          const canvasPoint = makeCanvasPointFromEvent(e)
          if (canvasPoint) updateStairSelectionDrag(canvasPoint)
          endStairSelectionDrag()
        }}
        onStairPointSelect={(stairId, pointIndex, event) => {
          if (shouldKeepGeometryTouchSelection(event, 'stair', stairId, pointIndex)) return
          const isMultiSelect = !!(event && (event.shiftKey || event.ctrlKey || event.metaKey))
          if (!isMultiSelect) {
            applySelection({ type: 'stairPoint', ids: [stairId, String(pointIndex)] })
            applySelectedStairPointIndices(new Map([[stairId, [pointIndex]]]))
            return
          }
          const { wallPoints: nextWalls, stairPoints: nextStairs } = getCurrentMixedPointSelection()
          const existing = nextStairs.get(stairId) ?? []
          const alreadySelected = existing.includes(pointIndex)
          if (alreadySelected) {
            const updated = existing.filter((idx) => idx !== pointIndex)
            if (updated.length > 0) nextStairs.set(stairId, updated)
            else nextStairs.delete(stairId)
          } else {
            nextStairs.set(
              stairId,
              [...existing, pointIndex].sort((a, b) => a - b)
            )
          }
          const ids = buildEncodedFloorPointIds(nextWalls, nextStairs)
          applySelectedStairPointIndices(nextStairs)
          applySelection(ids.length > 0 ? { type: 'wallPoint', ids } : { type: null, ids: [] })
        }}
        onStairPointDragStart={handleStairPointDragStart}
        onStairPointMove={handleStairPointMove}
        onStairPointDragEnd={handleStairPointDragEnd}
      />
    )
  )
}
