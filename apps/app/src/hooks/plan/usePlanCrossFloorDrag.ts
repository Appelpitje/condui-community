import type { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'

import React, { useCallback, useEffect } from 'react'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import type { Point } from '@/types/ui'

import {
  captureCrossFloorDragClientOffsets,
  resolveCrossFloorDragPositions,
  type ClientPoint,
} from '@/lib/plan/crossFloorDragContinuation'

interface PlanCrossFloorDragOptions {
  isDraggingRef: React.MutableRefObject<boolean>
  activeFloorId: string | null
  lastPlanPointerClientRef: React.RefObject<
    import('@/lib/plan/crossFloorDragContinuation').ClientPoint | null
  >
  moveActiveDragToFloor: (floorId: string) => Map<string, import('@/types/ui').Point> | null
  crossFloorDragSessionRef: React.RefObject<
    import('@/components/canvas/plan/planCanvasBindings').CrossFloorDragSession | null
  >
  planToClient: (plan: import('@/types/ui').Point) => { x: number; y: number }
  viewportUI: import('zustand/vanilla').StoreApi<import('@/stores/uiStore').UIState>
  containerRef: React.RefObject<HTMLDivElement | null>
  snapPlacementPosition: ReturnType<typeof usePlanCanvasGeometry>['snapPlacementPosition']
  updateCrossFloorDragPreview: (positions: Map<string, import('@/types/ui').Point>) => void
  planView: import('@/types/ui').ViewState
  finishCrossFloorDrag: () => void
  window: globalThis.Window
}

export function usePlanCrossFloorDrag({
  isDraggingRef,
  activeFloorId,
  lastPlanPointerClientRef,
  moveActiveDragToFloor,
  crossFloorDragSessionRef,
  planToClient,
  viewportUI,
  containerRef,
  snapPlacementPosition,
  updateCrossFloorDragPreview,
  planView,
  finishCrossFloorDrag,
  window,
}: PlanCrossFloorDragOptions) {
  const handleBeforeFloorSwitch = useCallback(
    (floorId: string): boolean => {
      if (!isDraggingRef.current || floorId === activeFloorId) return true
      const cursorClient = lastPlanPointerClientRef.current
      if (!cursorClient) return false

      const positions = moveActiveDragToFloor(floorId)
      if (!positions) return false
      if (positions.size === 0) return true

      crossFloorDragSessionRef.current = {
        floorId,
        clientOffsets: captureCrossFloorDragClientOffsets(positions, cursorClient, planToClient),
        lastPositions: new Map(positions),
      }
      return true
    },
    [
      activeFloorId,
      isDraggingRef,
      moveActiveDragToFloor,
      planToClient,
      crossFloorDragSessionRef,
      lastPlanPointerClientRef,
    ]
  )

  const updateCrossFloorDragFromClient = useCallback(
    (cursorClient: ClientPoint): Map<string, Point> | null => {
      const session = crossFloorDragSessionRef.current
      const uiState = viewportUI.getState()
      if (!session || session.floorId !== uiState.activeFloorId) return null
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return null
      const positions = resolveCrossFloorDragPositions(
        session.clientOffsets,
        cursorClient,
        (clientX, clientY) => ({
          x: (clientX - rect.left - uiState.planView.pan.x) / uiState.planView.zoom,
          y: (clientY - rect.top - uiState.planView.pan.y) / uiState.planView.zoom,
        }),
        snapPlacementPosition
      )
      if (!positions) return null
      session.lastPositions = positions
      updateCrossFloorDragPreview(positions)
      return positions
    },
    [
      snapPlacementPosition,
      updateCrossFloorDragPreview,
      viewportUI,
      containerRef,
      crossFloorDragSessionRef,
    ]
  )

  useEffect(
    function continueDragAcrossFloorAndViewportChanges() {
      const session = crossFloorDragSessionRef.current
      const cursorClient = lastPlanPointerClientRef.current
      if (!session || !cursorClient || session.floorId !== activeFloorId) return
      updateCrossFloorDragFromClient(cursorClient)
    },
    [
      activeFloorId,
      planView.pan.x,
      planView.pan.y,
      planView.zoom,
      updateCrossFloorDragFromClient,
      crossFloorDragSessionRef,
      lastPlanPointerClientRef,
    ]
  )

  useEffect(
    function trackAndFinishCrossFloorDrag() {
      const rememberPointer = (event: PointerEvent) => {
        const cursorClient = { x: event.clientX, y: event.clientY }
        lastPlanPointerClientRef.current = cursorClient
        if (crossFloorDragSessionRef.current) {
          updateCrossFloorDragFromClient(cursorClient)
        }
      }
      const finishPointerDrag = (event: PointerEvent) => {
        const session = crossFloorDragSessionRef.current
        if (!session) return
        const cursorClient = { x: event.clientX, y: event.clientY }
        lastPlanPointerClientRef.current = cursorClient
        const positions = updateCrossFloorDragFromClient(cursorClient) ?? session.lastPositions
        crossFloorDragSessionRef.current = null

        // Let the now-cancelled Konva drag-end event run while the continuation guard is still
        // active, then make the pointer-driven positions authoritative.
        queueMicrotask(() => {
          runProjectCommand('plan.moveToFloor', {
            floorId: session.floorId,
            moves: Array.from(positions, ([placementId, pos]) => ({ placementId, pos })),
          })
          finishCrossFloorDrag()
        })
      }

      window.addEventListener('pointerdown', rememberPointer, true)
      window.addEventListener('pointermove', rememberPointer, true)
      window.addEventListener('pointerup', finishPointerDrag, true)
      window.addEventListener('pointercancel', finishPointerDrag, true)
      return () => {
        window.removeEventListener('pointerdown', rememberPointer, true)
        window.removeEventListener('pointermove', rememberPointer, true)
        window.removeEventListener('pointerup', finishPointerDrag, true)
        window.removeEventListener('pointercancel', finishPointerDrag, true)
      }
    },
    [
      finishCrossFloorDrag,
      updateCrossFloorDragFromClient,
      window,
      crossFloorDragSessionRef,
      lastPlanPointerClientRef,
    ]
  )

  return { handleBeforeFloorSwitch }
}
