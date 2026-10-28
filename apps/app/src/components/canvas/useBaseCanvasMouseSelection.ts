import { debugTouchLog } from './baseCanvasGestureTiming'
import type { BaseCanvasProps } from './baseCanvasModel'
import type { useCanvasWindow } from '@/components/viewport/ViewportContext'
import type { useViewportUIApi } from '@/components/viewport/ViewportUIStore'

import { useEffect, useCallback } from 'react'

import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Point, Selection } from '@/types/ui'
import { ZOOM_MAX, ZOOM_100 } from '@/constants/canvasConstants'

import { selectMultiple } from '@/utils/selection'
import type { useCommitClearSelection, useCommitSelection } from '@/editions/community/communityHooks'
import { dismissCanvasOverlays } from '@/lib/ui/canvasOverlayDismiss'

import { isAppDialogOpen } from '@/lib/ui/appModalInteraction'

import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from 'react'

type CanvasSelectionRectangle = { startX: number; startY: number; endX: number; endY: number }
interface BaseCanvasMouseSelectionOptions extends Pick<BaseCanvasProps,
  'onFindElementsInRectangle' | 'pan' | 'pointerFollower' | 'prioritizeNavigation' | 'zoom'> {
  beginDeferredMousePan: (clientX: number, clientY: number, button: number,
    modifiers?: { shiftKey?: boolean; altKey?: boolean }) => void
  cameraGestureActiveRef: RefObject<boolean>
  cameraSyncTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>
  clearPreviewSelection: () => void
  clearSelection: ReturnType<typeof useCommitClearSelection>
  cursorShiftKeyRef: RefObject<boolean>
  dragOccurred: boolean
  dragOccurredRef: RefObject<boolean>
  fin: (value: number, fallback: number) => number
  
  handleMouseUpRef: RefObject<(event?: KonvaEventObject<MouseEvent>) => void>
  hoveredCursorNodeRef: RefObject<Konva.Node | null>
  ignoreNextTapClearRef: RefObject<boolean>
  isPanningRef: RefObject<boolean>
  isSelecting: boolean
  lastPanPointRef: RefObject<Point>
  leftDragPansCanvas: boolean
  minZoomRef: RefObject<number>
  mousePanWindowCleanupRef: RefObject<(() => void) | null>
  onCanvasPrimaryClickRef: RefObject<BaseCanvasProps['onCanvasPrimaryClick']>
  onCaptureRectangleRef: RefObject<BaseCanvasProps['onCaptureRectangle']>
  onViewportPanStateChangeRef: RefObject<BaseCanvasProps['onViewportPanStateChange']>
  panDisabledListeningRef: RefObject<boolean>
  panUiRafRef: RefObject<number | null>
  pendingMouseButtonPanRef: RefObject<{
    startX: number; startY: number; button: number; shiftKey: boolean; altKey: boolean
  } | null>
  pushLiveCameraToStore: (force: boolean) => void
  rectSelectActiveRef: RefObject<boolean>
  schedulePostPaintCameraCommit: () => void
  scheduleSelectionDragFrame: () => void
  selectionDragRafRef: RefObject<number | null>
  selectionRect: CanvasSelectionRectangle | null
  selectionRectLiveRef: RefObject<CanvasSelectionRectangle | null>
  setDragOccurred: Dispatch<SetStateAction<boolean>>
  setIsPanningForUI: Dispatch<SetStateAction<boolean>>
  setIsSelecting: Dispatch<SetStateAction<boolean>>
  setPointerFollowerPosition: Dispatch<SetStateAction<Point | null>>
  setSelection: ReturnType<typeof useCommitSelection>
  setSelectionRect: Dispatch<SetStateAction<CanvasSelectionRectangle | null>>
  shouldIgnoreSyntheticMouseEvent: () => boolean
  stageRef: RefObject<Konva.Stage | null>
  suppressNextContextMenuRef: RefObject<boolean>
  updateCanvasCursor: (preserveResize?: boolean) => void
  viewportUI: ReturnType<typeof useViewportUIApi>
  window: ReturnType<typeof useCanvasWindow>
}

function isCommentNode(node: Konva.Node, stage: Konva.Stage): boolean {
  let current: Konva.Node | null = node
  let depth = 0
  while (current && current !== stage && depth < 10) {
    
    current = current.getParent()
    depth++
  }
  return false
}
export function useBaseCanvasMouseSelection({
  beginDeferredMousePan,
  cameraGestureActiveRef,
  cameraSyncTimeoutRef,
  clearPreviewSelection,
  clearSelection,
  cursorShiftKeyRef,
  dragOccurred,
  dragOccurredRef,
  fin,
  
  handleMouseUpRef,
  hoveredCursorNodeRef,
  ignoreNextTapClearRef,
  isPanningRef,
  isSelecting,
  lastPanPointRef,
  leftDragPansCanvas,
  minZoomRef,
  mousePanWindowCleanupRef,
  onCanvasPrimaryClickRef,
  onCaptureRectangleRef,
  onFindElementsInRectangle,
  onViewportPanStateChangeRef,
  pan,
  panDisabledListeningRef,
  panUiRafRef,
  pendingMouseButtonPanRef,
  pointerFollower,
  prioritizeNavigation,
  pushLiveCameraToStore,
  rectSelectActiveRef,
  schedulePostPaintCameraCommit,
  scheduleSelectionDragFrame,
  selectionDragRafRef,
  selectionRect,
  selectionRectLiveRef,
  setDragOccurred,
  setIsPanningForUI,
  setIsSelecting,
  setPointerFollowerPosition,
  setSelection,
  setSelectionRect,
  shouldIgnoreSyntheticMouseEvent,
  stageRef,
  suppressNextContextMenuRef,
  updateCanvasCursor,
  viewportUI,
  window,
  zoom,
}: BaseCanvasMouseSelectionOptions) {
  // Handle mouse down (start panning or selection rectangle)
  const handleMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (isAppDialogOpen()) return
      const stage = e.target.getStage()
      if (!stage) return
      if (e.evt.button === 0) {
        dismissCanvasOverlays()
      }

      

      // Right/middle click: defer pan until the pointer moves — a stationary right-click is
      // for the context menu and must not run pan teardown (pushLiveCameraToStore, pan UI).
      if (e.evt.button === 2 || e.evt.button === 1) {
        beginDeferredMousePan(e.evt.clientX, e.evt.clientY, e.evt.button)
        e.evt.preventDefault()
        return
      }

      // Left click on empty space - pan (optional) or start selection rectangle / clear selection
      if (e.evt.button === 0 && (e.target === stage || prioritizeNavigation)) {
        // Touch devices fire synthetic mouse events after touchend; marquee select
        // and floor-plan drawing are handled via touch handlers instead.
        if (shouldIgnoreSyntheticMouseEvent()) return

        if (onCanvasPrimaryClickRef.current) {
          e.evt.preventDefault()
          return
        }

        if ((leftDragPansCanvas || prioritizeNavigation) && !e.evt.shiftKey) {
          beginDeferredMousePan(e.evt.clientX, e.evt.clientY, 0, {
            shiftKey: e.evt.shiftKey,
            altKey: e.evt.altKey,
          })
          e.evt.preventDefault()
          return
        }

        const pointer = stage.getPointerPosition()
        if (!pointer) return

        // Start selection rectangle
        const r = {
          startX: pointer.x,
          startY: pointer.y,
          endX: pointer.x,
          endY: pointer.y,
        }
        selectionRectLiveRef.current = r
        rectSelectActiveRef.current = true
        clearPreviewSelection()
        e.evt.preventDefault()
      }
    },
    [
      beginDeferredMousePan,
      clearPreviewSelection,
      
      leftDragPansCanvas,
      prioritizeNavigation,
      shouldIgnoreSyntheticMouseEvent,
      onCanvasPrimaryClickRef,
      rectSelectActiveRef,
      selectionRectLiveRef,
      suppressNextContextMenuRef,
    ]
  )

  // Handle mouse move (pan or update selection rectangle)
  const handleMouseMove = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage()
      if (!stage) return

      hoveredCursorNodeRef.current = e.target
      cursorShiftKeyRef.current = e.evt.shiftKey
      updateCanvasCursor(true)

      // Update selection rectangle (coalesced to rAF in scheduleSelectionDragFrame)
      if (rectSelectActiveRef.current && selectionRectLiveRef.current) {
        const pointer = stage.getPointerPosition()
        if (pointer) {
          const base = selectionRectLiveRef.current
          selectionRectLiveRef.current = {
            ...base,
            endX: pointer.x,
            endY: pointer.y,
          }
          scheduleSelectionDragFrame()
        }
        return
      }

      if (pointerFollower) {
        setPointerFollowerPosition({ x: e.evt.clientX, y: e.evt.clientY })
      }

      // Handle panning
      if (isPanningRef.current) {
        return
      }
    },
    [
      pointerFollower,
      scheduleSelectionDragFrame,
      updateCanvasCursor,
      cursorShiftKeyRef,
      hoveredCursorNodeRef,
      isPanningRef,
      rectSelectActiveRef,
      selectionRectLiveRef,
      setPointerFollowerPosition,
    ]
  )

  // Handle mouse up (stop panning or finalize selection)
  const handleMouseUp = useCallback(
    (e?: KonvaEventObject<MouseEvent>) => {
      if (isAppDialogOpen()) return
      const button = e?.evt?.button
      const rectSelectActive = rectSelectActiveRef.current
      const shouldDeferMouseButtonCameraCommit =
        isPanningRef.current && mousePanWindowCleanupRef.current != null && !rectSelectActive
      if (
        button != null &&
        button !== 0 &&
        !isPanningRef.current &&
        !isSelecting &&
        !rectSelectActive &&
        !pendingMouseButtonPanRef.current
      ) {
        return
      }

      const selection = viewportUI.getState().selection

      if (
        button === 0 &&
        onCanvasPrimaryClickRef.current &&
        !dragOccurred &&
        !dragOccurredRef.current &&
        !isPanningRef.current
      ) {
        const stage = stageRef.current
        const pointer = stage?.getPointerPosition()
        if (stage && e && isCommentNode(e.target, stage)) return
        if (pointer && e?.evt) {
          const zCommit = Math.max(minZoomRef.current, Math.min(ZOOM_MAX, fin(zoom, ZOOM_100)))
          onCanvasPrimaryClickRef.current(
            {
              x: (pointer.x - pan.x) / zCommit,
              y: (pointer.y - pan.y) / zCommit,
            },
            { clientX: e.evt.clientX, clientY: e.evt.clientY }
          )
          return
        }
      }

      if (rectSelectActive || isSelecting) {
        if (selectionDragRafRef.current != null) {
          window.cancelAnimationFrame(selectionDragRafRef.current)
          selectionDragRafRef.current = null
        }
        const stageEarly = stageRef.current
        const pointerCommit = stageEarly?.getPointerPosition()
        const liveEarly = selectionRectLiveRef.current ?? selectionRect
        if (pointerCommit && liveEarly) {
          selectionRectLiveRef.current = {
            ...liveEarly,
            endX: pointerCommit.x,
            endY: pointerCommit.y,
          }
        }
      }

      const rectForCommit = selectionRectLiveRef.current ?? selectionRect

      // Finalize selection rectangle
      if (rectSelectActive && rectForCommit && !onFindElementsInRectangle) {
        // Canvas without rect-select (e.g. PanelCanvas) — treat any stage click as a deselect
        if (!e?.evt.shiftKey && !e?.evt.altKey) {
          clearSelection()
        }
      } else if (rectSelectActive && rectForCommit && onFindElementsInRectangle) {
        const stage = stageRef.current
        if (stage) {
          const zCommit = Math.max(minZoomRef.current, Math.min(ZOOM_MAX, fin(zoom, ZOOM_100)))
          // Convert screen coordinates to canvas coordinates
          const startCanvasX = (rectForCommit.startX - pan.x) / zCommit
          const startCanvasY = (rectForCommit.startY - pan.y) / zCommit
          const endCanvasX = (rectForCommit.endX - pan.x) / zCommit
          const endCanvasY = (rectForCommit.endY - pan.y) / zCommit

          // Calculate rectangle bounds
          const rectX = Math.min(startCanvasX, endCanvasX)
          const rectY = Math.min(startCanvasY, endCanvasY)
          const rectWidth = Math.abs(endCanvasX - startCanvasX)
          const rectHeight = Math.abs(endCanvasY - startCanvasY)

          const captured = onCaptureRectangleRef.current?.(
            { x: rectX, y: rectY, width: rectWidth, height: rectHeight },
            { shiftKey: e?.evt.shiftKey || false, altKey: e?.evt.altKey || false }
          )
          if (captured) {
            // The canvas handled it; keep the synthetic tap from clearing the selection.
            ignoreNextTapClearRef.current = true
          } else if (rectWidth > 5 && rectHeight > 5) {
            // Only select if rectangle is large enough (avoid accidental clicks)
            // Find elements in rectangle
            const elements = onFindElementsInRectangle({
              x: rectX,
              y: rectY,
              width: rectWidth,
              height: rectHeight,
            })

            debugTouchLog('handleMouseUp drag-rect computed', {
              selectionRect: rectForCommit,
              canvasRect: { x: rectX, y: rectY, width: rectWidth, height: rectHeight },
              elementCount: elements.length,
              selectionBefore: selection,
            })

            // Handle modifiers (defined here so they're available in both branches)
            const shiftKey = e?.evt.shiftKey || false
            const altKey = e?.evt.altKey || false

            if (elements.length > 0) {
              // Select ALL elements regardless of type
              // Use the most common type for the selection.type (for compatibility)
              // but include ALL IDs so all elements are selected
              const elementsByType = new Map<string, Array<{ id: string; type: string }>>()
              elements.forEach((el) => {
                const type = el.type
                if (!elementsByType.has(type)) {
                  elementsByType.set(type, [])
                }
                elementsByType.get(type)!.push(el)
              })

              // Find the most common type (for selection.type compatibility)
              let mostCommonType: string | null = null
              let maxCount = 0
              for (const [type, typeElements] of elementsByType.entries()) {
                if (typeElements.length > maxCount) {
                  maxCount = typeElements.length
                  mostCommonType = type
                }
              }

              // If tied, prioritize: protection > endpoint > circuit > panel
              if (maxCount > 0) {
                const typePriority: Record<string, number> = {
                  protection: 100,
                  endpoint: 50,
                  circuit: 25,
                  panel: 10,
                }
                let highestPriority = -1
                for (const [type, typeElements] of elementsByType.entries()) {
                  if (typeElements.length === maxCount) {
                    const priority = typePriority[type] || 0
                    if (priority > highestPriority) {
                      highestPriority = priority
                      mostCommonType = type
                    }
                  }
                }
              }

              // Get ALL IDs from ALL types
              const allElementIds = elements.map((el) => el.id)

              if (altKey) {
                // Remove from selection
                const newIds = selection.ids.filter((id) => !allElementIds.includes(id))
                if (newIds.length === 0) {
                  clearSelection()
                } else {
                  setSelection({ ...selection, ids: newIds })
                }
              } else if (shiftKey) {
                // Add to selection - include all IDs regardless of type
                const existingIds = selection.ids
                const newIds = [...new Set([...existingIds, ...allElementIds])]
                setSelection(selectMultiple(mostCommonType as Selection['type'], newIds))
              } else {
                // Replace selection - include ALL elements
                setSelection(selectMultiple(mostCommonType as Selection['type'], allElementIds))
              }

              // Prevent the synthetic tap that Konva emits after touch-end
              // from immediately clearing this new selection on empty stage.
              ignoreNextTapClearRef.current = true

              debugTouchLog('handleMouseUp drag-rect applied selection', {
                mostCommonType,
                allElementIds,
                shiftKey,
                altKey,
                selectionAfter: viewportUI.getState().selection,
              })
            } else if (!shiftKey && !altKey) {
              // No elements found and no modifiers - clear selection
              clearSelection()
              debugTouchLog('handleMouseUp drag-rect found no elements; cleared selection')
            }
          } else {
            // Small rectangle - treat as click, clear selection if no modifiers
            if (!e?.evt.shiftKey && !e?.evt.altKey) {
              clearSelection()
              debugTouchLog(
                'handleMouseUp drag-rect too small; treated as click -> cleared selection'
              )
            }
          }
        }
      }

      if (mousePanWindowCleanupRef.current) {
        mousePanWindowCleanupRef.current()
        mousePanWindowCleanupRef.current = null
      }
      if (isPanningRef.current) {
        isPanningRef.current = false
        if (panUiRafRef.current != null) {
          window.cancelAnimationFrame(panUiRafRef.current)
          panUiRafRef.current = null
        }
        setIsPanningForUI(false)
        onViewportPanStateChangeRef.current?.(false)
        if (cameraSyncTimeoutRef.current != null) {
          clearTimeout(cameraSyncTimeoutRef.current)
          cameraSyncTimeoutRef.current = null
        }
        if (dragOccurredRef.current) {
          if (shouldDeferMouseButtonCameraCommit) {
            schedulePostPaintCameraCommit()
          } else {
            pushLiveCameraToStore(true)
          }
        }
      }
      if (panDisabledListeningRef.current && stageRef.current && !cameraGestureActiveRef.current) {
        stageRef.current.listening(true)
      }
      panDisabledListeningRef.current = false
      lastPanPointRef.current = { x: 0, y: 0 }
      if (rectSelectActive || isSelecting) {
        rectSelectActiveRef.current = false
        setIsSelecting(false)
        selectionRectLiveRef.current = null
        clearPreviewSelection()
        setSelectionRect(null)
      }

      if (dragOccurred || dragOccurredRef.current) {
        setTimeout(() => {
          setDragOccurred(false)
          dragOccurredRef.current = false
        }, 100)
      }
    },
    [
      clearPreviewSelection,
      isSelecting,
      selectionRect,
      onFindElementsInRectangle,
      zoom,
      pan,
      setSelection,
      clearSelection,
      dragOccurred,
      fin,
      pushLiveCameraToStore,
      schedulePostPaintCameraCommit,
      viewportUI,
      window,
      rectSelectActiveRef,
      isPanningRef,
      mousePanWindowCleanupRef,
      pendingMouseButtonPanRef,
      onCanvasPrimaryClickRef,
      dragOccurredRef,
      selectionRectLiveRef,
      panDisabledListeningRef,
      stageRef,
      cameraGestureActiveRef,
      lastPanPointRef,
      minZoomRef,
      selectionDragRafRef,
      onCaptureRectangleRef,
      ignoreNextTapClearRef,
      panUiRafRef,
      setIsPanningForUI,
      onViewportPanStateChangeRef,
      cameraSyncTimeoutRef,
      setIsSelecting,
      setSelectionRect,
      setDragOccurred,
    ]
  )

  useEffect(() => {
    handleMouseUpRef.current = handleMouseUp
  }, [handleMouseUp, handleMouseUpRef])

  return { handleMouseDown, handleMouseMove, handleMouseUp }
}
