import { useCallback, useLayoutEffect } from 'react'
import type { BaseCanvasProps, BaseCanvasHandle } from './baseCanvasModel'
import type { useCanvasWindow } from '@/components/viewport/ViewportContext'
import { useViewportUIStore as useCanvasUIStore, type useViewportUIApi } from '@/components/viewport/ViewportUIStore'

import {
  useRef,
  useId,
  useEffect,
} from 'react'

import type Konva from 'konva'

import type { Point } from '@/types/ui'

import type { RefObject } from 'react'
import { DEFERRED_MOUSE_PAN_THRESHOLD_PX } from './baseCanvasGestureTiming'

interface BaseCanvasLibraryPlacementOptions extends Pick<BaseCanvasProps, 'onDragOver' | 'onDrop'> {
  armedLibrarySymbol: ReturnType<ReturnType<typeof useViewportUIApi>['getState']>['armedLibrarySymbol']
  armedPlacementActive: boolean
  beginDeferredMousePan: (clientX: number, clientY: number, button: number,
    modifiers?: { shiftKey?: boolean; altKey?: boolean }) => void
  containerRef: RefObject<HTMLDivElement | null>
  getLiveViewTransform: BaseCanvasHandle['getLiveViewTransform']
  stageRef: RefObject<Konva.Stage | null>
  suppressNextContextMenuRef: RefObject<boolean>
  updateCanvasCursorRef: RefObject<(preserveResize?: boolean) => void>
  viewportUI: ReturnType<typeof useViewportUIApi>
  window: ReturnType<typeof useCanvasWindow>
}

export function useBaseCanvasLibraryPlacement({
  armedLibrarySymbol,
  armedPlacementActive,
  beginDeferredMousePan,
  containerRef,
  getLiveViewTransform,
  onDragOver,
  onDrop,
  stageRef,
  suppressNextContextMenuRef,
  updateCanvasCursorRef,
  viewportUI,
  window,
}: BaseCanvasLibraryPlacementOptions) {
  // Handle touch drag from symbol library (custom events)
  useEffect(() => {
    const handleTouchDragMove = (e: Event) => {
      const customEvent = e as CustomEvent<{ symbol: unknown; x: number; y: number }>
      if (!containerRef.current || !onDragOver) return

      const rect = containerRef.current.getBoundingClientRect()
      const x = customEvent.detail.x - rect.left
      const y = customEvent.detail.y - rect.top
      const { pan: livePan, zoom: liveZoom } = getLiveViewTransform()
      const canvasX = (x - livePan.x) / liveZoom
      const canvasY = (y - livePan.y) / liveZoom

      onDragOver({ x: canvasX, y: canvasY }, customEvent.detail.symbol)
    }

    const handleTouchDragEnd = (e: Event) => {
      const customEvent = e as CustomEvent<{ symbol: unknown; x: number; y: number }>
      if (!containerRef.current || !onDrop) return

      const rect = containerRef.current.getBoundingClientRect()
      const x = customEvent.detail.x - rect.left
      const y = customEvent.detail.y - rect.top

      // Check if drop is within canvas bounds
      if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
        const { pan: livePan, zoom: liveZoom } = getLiveViewTransform()
        const canvasX = (x - livePan.x) / liveZoom
        const canvasY = (y - livePan.y) / liveZoom

        onDrop({ x: canvasX, y: canvasY }, customEvent.detail.symbol, {
          clientX: customEvent.detail.x,
          clientY: customEvent.detail.y,
        })
      }

      // Clear preview
      if (onDragOver) {
        onDragOver({ x: -Infinity, y: -Infinity }, null)
      }
    }

    window.addEventListener('touchdragmove', handleTouchDragMove)
    window.addEventListener('touchdragend', handleTouchDragEnd)

    return () => {
      window.removeEventListener('touchdragmove', handleTouchDragMove)
      window.removeEventListener('touchdragend', handleTouchDragEnd)
    }
  }, [onDrop, onDragOver, getLiveViewTransform, window, containerRef])

  // Armed library symbol: hover previews through onDragOver and each left click drops a
  // copy through onDrop, exactly like a library drag. Left/right button events on the stage
  // are swallowed in the capture phase so Konva selection, marquee and element drags never
  // start. A left press that moves becomes a pan (like the middle button); a still one places.
  const armedLibraryCanvasId = useCanvasUIStore((state) => state.armedLibraryCanvasId)
  const armedCanvasInstanceId = useId()
  const armedPlacementRef = useRef({ symbol: armedLibrarySymbol, onDrop, onDragOver })
  const armedPointerClientRef = useRef<{ x: number; y: number } | null>(null)
  const beginDeferredMousePanRef = useRef(beginDeferredMousePan)
  useLayoutEffect(() => {
    armedPlacementRef.current = { symbol: armedLibrarySymbol, onDrop, onDragOver }
    beginDeferredMousePanRef.current = beginDeferredMousePan
  }, [armedLibrarySymbol, onDrop, onDragOver, beginDeferredMousePan])

  const refreshCanvasCursor = useCallback(() => {
    updateCanvasCursorRef.current()
  }, [updateCanvasCursorRef])

  useEffect(() => {
    const container = containerRef.current
    if (!armedPlacementActive || !container) return

    let previewFrame: number | null = null
    let swallowPointerSequence = false
    let pendingRightClickDisarm = false
    let leftPress: { x: number; y: number } | null = null

    const getStageContainer = () => stageRef.current?.container() ?? null
    const isOnStage = (target: EventTarget | null) => {
      const stageContainer = getStageContainer()
      return !!stageContainer && target instanceof Node && stageContainer.contains(target)
    }
    const toCanvasPoint = (clientX: number, clientY: number): Point => {
      const rect = container.getBoundingClientRect()
      const { pan: livePan, zoom: liveZoom } = getLiveViewTransform()
      return {
        x: (clientX - rect.left - livePan.x) / liveZoom,
        y: (clientY - rect.top - livePan.y) / liveZoom,
      }
    }
    const clearPreview = () => {
      armedPlacementRef.current.onDragOver?.({ x: -Infinity, y: -Infinity }, null)
    }
    const renderPreview = () => {
      previewFrame = null
      const client = armedPointerClientRef.current
      const { symbol, onDragOver: preview } = armedPlacementRef.current
      if (!client || !symbol || !preview) return
      preview(toCanvasPoint(client.x, client.y), symbol)
    }
    const schedulePreview = () => {
      if (previewFrame == null) previewFrame = window.requestAnimationFrame(renderPreview)
    }

    const hidePreview = () => {
      if (previewFrame != null) {
        window.cancelAnimationFrame(previewFrame)
        previewFrame = null
      }
      if (armedPointerClientRef.current) {
        armedPointerClientRef.current = null
        clearPreview()
      }
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      // A held button means a pan is running: drop-target previews are expensive on the
      // one-wire and panel canvases, so hide the ghost until the button is released.
      if (event.buttons !== 0 || !isOnStage(event.target)) {
        hidePreview()
        return
      }
      armedPointerClientRef.current = { x: event.clientX, y: event.clientY }
      const stageContainer = getStageContainer()
      if (stageContainer) stageContainer.style.cursor = 'crosshair'
      const ui = viewportUI.getState()
      if (ui.armedLibraryCanvasId !== armedCanvasInstanceId) {
        ui.setArmedLibraryCanvasId(armedCanvasInstanceId)
      }
      schedulePreview()
      // Keep Konva hover effects quiet while armed.
      event.stopPropagation()
    }
    const handleMouseMove = (event: MouseEvent) => {
      if (event.buttons === 0 && isOnStage(event.target)) event.stopPropagation()
    }
    const handlePointerLeave = () => {
      armedPointerClientRef.current = null
      clearPreview()
    }
    const handlePointerDown = (event: PointerEvent) => {
      // A pan can end off-canvas without a click; never let that sequence swallow later UI clicks.
      swallowPointerSequence = false
      leftPress = null
      if (event.pointerType === 'touch' || !isOnStage(event.target)) return
      if (event.button !== 0 && event.button !== 2) return
      event.stopPropagation()
      swallowPointerSequence = true
      if (event.button === 2) {
        event.preventDefault()
        // Disarm once the menu event is swallowed; on platforms that fire contextmenu
        // after pointerup (Windows), the stage's own suppression flag catches it instead.
        pendingRightClickDisarm = true
        suppressNextContextMenuRef.current = true
        return
      }
      // Not preventDefault: the deferred pan listens to the compatibility mouse events.
      // Button 1 semantics: a press that never moves must not clear the selection.
      leftPress = { x: event.clientX, y: event.clientY }
      beginDeferredMousePanRef.current(event.clientX, event.clientY, 1)
    }
    const placeAt = (clientX: number, clientY: number) => {
      const { symbol, onDrop: drop } = armedPlacementRef.current
      if (!symbol || !drop) return
      armedPointerClientRef.current = { x: clientX, y: clientY }
      drop(toCanvasPoint(clientX, clientY), symbol, { clientX, clientY })
      viewportUI.getState().noteArmedPlacement()
      // Drops clear the canvas preview; bring the ghost back for the next placement.
      schedulePreview()
    }
    const handleLeftPointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || !leftPress) return
      const press = leftPress
      leftPress = null
      const moved =
        Math.abs(event.clientX - press.x) > DEFERRED_MOUSE_PAN_THRESHOLD_PX ||
        Math.abs(event.clientY - press.y) > DEFERRED_MOUSE_PAN_THRESHOLD_PX
      if (!moved) placeAt(press.x, press.y)
    }
    const disarm = () => {
      pendingRightClickDisarm = false
      viewportUI.getState().setArmedLibrarySymbol(null)
    }
    const swallowButtonEvent = (event: MouseEvent) => {
      if (event.button !== 0 && event.button !== 2) return
      if (!swallowPointerSequence && !isOnStage(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'click' || event.type === 'contextmenu') swallowPointerSequence = false
      if (event.type === 'contextmenu' && pendingRightClickDisarm) {
        suppressNextContextMenuRef.current = false
        disarm()
      } else if (event.type === 'pointerup' && event.button === 0) {
        handleLeftPointerUp(event as PointerEvent)
      } else if (event.type === 'pointerup' && pendingRightClickDisarm) {
        window.setTimeout(() => {
          if (pendingRightClickDisarm) disarm()
        }, 0)
      }
    }
    const handleWheel = () => {
      if (armedPointerClientRef.current) schedulePreview()
    }

    const captureOptions = { capture: true }
    const passiveCaptureOptions = { capture: true, passive: true }
    container.addEventListener('pointermove', handlePointerMove, captureOptions)
    container.addEventListener('mousemove', handleMouseMove, captureOptions)
    container.addEventListener('pointerleave', handlePointerLeave)
    container.addEventListener('pointerdown', handlePointerDown, captureOptions)
    container.addEventListener('mousedown', swallowButtonEvent, captureOptions)
    container.addEventListener('pointerup', swallowButtonEvent, captureOptions)
    container.addEventListener('mouseup', swallowButtonEvent, captureOptions)
    container.addEventListener('click', swallowButtonEvent, captureOptions)
    container.addEventListener('dblclick', swallowButtonEvent, captureOptions)
    container.addEventListener('contextmenu', swallowButtonEvent, captureOptions)
    container.addEventListener('wheel', handleWheel, passiveCaptureOptions)

    // A canvas remount while the pointer rests on it (e.g. after a drop) keeps the ghost.
    schedulePreview()

    return () => {
      if (previewFrame != null) window.cancelAnimationFrame(previewFrame)
      container.removeEventListener('pointermove', handlePointerMove, captureOptions)
      container.removeEventListener('mousemove', handleMouseMove, captureOptions)
      container.removeEventListener('pointerleave', handlePointerLeave)
      container.removeEventListener('pointerdown', handlePointerDown, captureOptions)
      container.removeEventListener('mousedown', swallowButtonEvent, captureOptions)
      container.removeEventListener('pointerup', swallowButtonEvent, captureOptions)
      container.removeEventListener('mouseup', swallowButtonEvent, captureOptions)
      container.removeEventListener('click', swallowButtonEvent, captureOptions)
      container.removeEventListener('dblclick', swallowButtonEvent, captureOptions)
      container.removeEventListener('contextmenu', swallowButtonEvent, captureOptions)
      container.removeEventListener('wheel', handleWheel, passiveCaptureOptions)
      const stageContainer = getStageContainer()
      if (stageContainer) refreshCanvasCursor()
    }
  }, [
    armedPlacementActive,
    armedCanvasInstanceId,
    getLiveViewTransform,
    window,
    viewportUI,
    containerRef,
    stageRef,
    suppressNextContextMenuRef,
    refreshCanvasCursor,
  ])

  // Disarming (Esc, right click, another tool) removes the ghost from this canvas.
  useEffect(() => {
    if (armedPlacementActive) return
    if (!armedPointerClientRef.current) return
    armedPointerClientRef.current = null
    onDragOver?.({ x: -Infinity, y: -Infinity }, null)
  }, [armedPlacementActive, onDragOver])

  return { armedLibraryCanvasId, armedCanvasInstanceId }
}
