import type React from 'react'
import { type FloorPlanInputEvent } from '@/components/canvas/plan/FloorPlanDrawingPreview'
import { useCallback } from 'react'
import type { Point2 } from '@/types/schema'

interface FloorPlanPointerCoordinatesOptions {
  stageContainerRef: React.RefObject<HTMLElement | null>
  penPointerCaptureTargetRef: React.RefObject<HTMLElement | null>
  penPointerCaptureIdRef: React.RefObject<number | null>
  planView: import('@/types/ui').ViewState
}

export function useFloorPlanPointerCoordinates({
  stageContainerRef,
  penPointerCaptureTargetRef,
  penPointerCaptureIdRef,
  planView,
}: FloorPlanPointerCoordinatesOptions) {
  const rememberStageContainer = useCallback(
    (e: FloorPlanInputEvent) => {
      const container = e.target?.getStage?.()?.container?.()
      if (container) stageContainerRef.current = container
    },
    [stageContainerRef]
  )

  const capturePenPointer = useCallback(
    (e: FloorPlanInputEvent) => {
      const nativeEvent = e.evt as PointerEvent
      const target = nativeEvent.target
      if (
        typeof nativeEvent.pointerId !== 'number' ||
        !(target instanceof HTMLElement) ||
        typeof target.setPointerCapture !== 'function'
      ) {
        return
      }

      try {
        target.setPointerCapture(nativeEvent.pointerId)
        penPointerCaptureTargetRef.current = target
        penPointerCaptureIdRef.current = nativeEvent.pointerId
      } catch {
        // Pointer capture is a best-effort guard for HTML overlays crossing the canvas.
      }
    },
    [penPointerCaptureIdRef, penPointerCaptureTargetRef]
  )

  const releasePenPointer = useCallback(() => {
    const target = penPointerCaptureTargetRef.current
    const pointerId = penPointerCaptureIdRef.current
    penPointerCaptureTargetRef.current = null
    penPointerCaptureIdRef.current = null
    if (!target || pointerId == null || !target.hasPointerCapture(pointerId)) return
    try {
      target.releasePointerCapture(pointerId)
    } catch {
      // The browser may already have released capture after a cancelled gesture.
    }
  }, [penPointerCaptureIdRef, penPointerCaptureTargetRef])

  const clientCoordsToCanvasPoint = useCallback(
    (clientX: number, clientY: number): Point2 | null => {
      const container = stageContainerRef.current
      if (!container) return null
      const rect = container.getBoundingClientRect()
      const stageX = clientX - rect.left
      const stageY = clientY - rect.top
      return {
        x: (stageX - planView.pan.x) / planView.zoom,
        y: (stageY - planView.pan.y) / planView.zoom,
      }
    },
    [planView.pan.x, planView.pan.y, planView.zoom, stageContainerRef]
  )

  const getCanvasPointFromEvent = useCallback(
    (e: FloorPlanInputEvent): Point2 | null => {
      const stage = e.target?.getStage?.()
      if (!stage) return null

      const pointer = stage.getPointerPosition()
      if (pointer) {
        return {
          x: (pointer.x - planView.pan.x) / planView.zoom,
          y: (pointer.y - planView.pan.y) / planView.zoom,
        }
      }

      // iPad/Safari fallback: pointer can be null on initial touch events.
      const nativeEvt = e.evt as TouchEvent | PointerEvent | MouseEvent | undefined
      const stageContainer = stage.container?.()
      if (!nativeEvt || !stageContainer) return null
      const rect = stageContainer.getBoundingClientRect()
      const touch =
        (nativeEvt as TouchEvent).touches?.[0] || (nativeEvt as TouchEvent).changedTouches?.[0]
      const clientX = touch?.clientX ?? (nativeEvt as PointerEvent).clientX
      const clientY = touch?.clientY ?? (nativeEvt as PointerEvent).clientY
      if (typeof clientX !== 'number' || typeof clientY !== 'number') return null

      const stageX = clientX - rect.left
      const stageY = clientY - rect.top
      return {
        x: (stageX - planView.pan.x) / planView.zoom,
        y: (stageY - planView.pan.y) / planView.zoom,
      }
    },
    [planView]
  )

  return {
    rememberStageContainer,
    capturePenPointer,
    releasePenPointer,
    clientCoordsToCanvasPoint,
    getCanvasPointFromEvent,
  }
}
