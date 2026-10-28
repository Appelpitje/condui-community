import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { clamp } from '@/lib/geometry'
import { logger } from '@/lib/logger'

type UseDraggableFloatingWindowOptions = {
  initialTop: number
  initialRight: number
  initialWidth?: number
  margin?: number
  dockLeftThreshold?: number
  onDockLeft?: () => void
  onDockPreviewChange?: (active: boolean) => void
  debugName?: string
  externalDragStart?: {
    pointerId: number
    pointerType: string
    clientX: number
    clientY: number
    initialLeft: number
    initialTop: number
    offsetX: number
    offsetY: number
    token: number
  } | null
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}

type DragState = {
  pointerId: number
  offsetX: number
  offsetY: number
  pointerType: string
  moveCount: number
}

type ResizeState = {
  pointerId: number
  edge: 'left' | 'right' | 'bottomRight'
  startX: number
  startY: number
  startLeft: number
  startTop: number
  startWidth: number
  startHeight: number
}

export function useDraggableFloatingWindow({
  initialTop,
  initialRight,
  initialWidth,
  margin = 16,
  dockLeftThreshold = 24,
  onDockLeft,
  onDockPreviewChange,
  debugName = 'unknown',
  externalDragStart,
  minWidth = 280,
  maxWidth = 720,
  minHeight = 220,
  maxHeight = Number.POSITIVE_INFINITY,
}: UseDraggableFloatingWindowOptions) {
  const window = useCanvasWindow()
  const dragDebugEnabled = import.meta.env.DEV
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const resizeRef = useRef<ResizeState | null>(null)
  const lastExternalDragTokenRef = useRef<number | null>(null)
  const onDockLeftRef = useRef(onDockLeft)
  const onDockPreviewChangeRef = useRef(onDockPreviewChange)
  const dockPreviewActiveRef = useRef(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [size, setSize] = useState<{ width: number; height: number | null } | null>(
    initialWidth ? { width: initialWidth, height: null } : null
  )

  useEffect(() => {
    onDockLeftRef.current = onDockLeft
  }, [onDockLeft])

  useEffect(() => {
    onDockPreviewChangeRef.current = onDockPreviewChange
  }, [onDockPreviewChange])

  const setDockPreviewActive = useCallback((active: boolean) => {
    if (dockPreviewActiveRef.current === active) return
    dockPreviewActiveRef.current = active
    onDockPreviewChangeRef.current?.(active)
  }, [])

  const logDrag = useCallback(
    (message: string, details?: Record<string, unknown>) => {
      if (!dragDebugEnabled) return

      logger.debug(`[FloatingWindowDrag:${debugName}]`, message, details ?? {})
    },
    [debugName, dragDebugEnabled]
  )

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const container = containerRef.current
      const drag = dragRef.current
      const resize = resizeRef.current
      if (container && resize && event.pointerId === resize.pointerId) {
        if (resize.edge === 'right') {
          const nextWidth = clamp(event.clientX - resize.startLeft, minWidth, maxWidth)
          setPosition({ left: resize.startLeft, top: resize.startTop })
          setSize((prev) => ({ width: nextWidth, height: prev?.height ?? resize.startHeight }))
          return
        }
        if (resize.edge === 'left') {
          const unclampedLeft = event.clientX
          const nextLeft = clamp(
            unclampedLeft,
            margin,
            resize.startLeft + resize.startWidth - minWidth
          )
          const nextWidth = clamp(
            resize.startWidth + (resize.startLeft - nextLeft),
            minWidth,
            maxWidth
          )
          setPosition({ left: nextLeft, top: resize.startTop })
          setSize((prev) => ({ width: nextWidth, height: prev?.height ?? resize.startHeight }))
          return
        }
        if (resize.edge === 'bottomRight') {
          const nextWidth = clamp(event.clientX - resize.startLeft, minWidth, maxWidth)
          const nextHeight = clamp(event.clientY - resize.startTop, minHeight, maxHeight)
          setPosition({ left: resize.startLeft, top: resize.startTop })
          setSize({ width: nextWidth, height: nextHeight })
          return
        }
      }
      if (!container || !drag) return
      if (event.pointerId !== drag.pointerId) {
        logDrag('pointermove ignored (pointerId mismatch)', {
          eventPointerId: event.pointerId,
          dragPointerId: drag.pointerId,
        })
        return
      }

      const rect = container.getBoundingClientRect()
      const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin)
      const maxTop = Math.max(margin, window.innerHeight - rect.height - margin)
      const nextLeft = clamp(event.clientX - drag.offsetX, margin, maxLeft)
      const nextTop = clamp(event.clientY - drag.offsetY, margin, maxTop)

      drag.moveCount += 1
      setPosition({ left: nextLeft, top: nextTop })
      setDockPreviewActive(nextLeft <= dockLeftThreshold)
    },
    [dockLeftThreshold, logDrag, margin, maxHeight, maxWidth, minHeight, minWidth, setDockPreviewActive, window]
  )

  const onMouseMove = useCallback(
    (event: MouseEvent) => {
      const container = containerRef.current
      const drag = dragRef.current
      if (!container || !drag) return
      if (drag.pointerType !== 'mouse') return

      const rect = container.getBoundingClientRect()
      const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin)
      const maxTop = Math.max(margin, window.innerHeight - rect.height - margin)
      const nextLeft = clamp(event.clientX - drag.offsetX, margin, maxLeft)
      const nextTop = clamp(event.clientY - drag.offsetY, margin, maxTop)

      drag.moveCount += 1
      setPosition({ left: nextLeft, top: nextTop })
      setDockPreviewActive(nextLeft <= dockLeftThreshold)
    },
    [dockLeftThreshold, margin, setDockPreviewActive, window]
  )

  const stopDragging = useCallback(function finishDragging(event?: PointerEvent | MouseEvent) {
    const dragSnapshot = dragRef.current
    if (
      event && 'pointerId' in event &&
      dragSnapshot &&
      event.pointerId !== dragSnapshot.pointerId
    ) {
      logDrag('stop ignored (pointerId mismatch)', {
        reason: event.type,
        eventPointerId: event.pointerId,
        dragPointerId: dragSnapshot.pointerId,
      })
      return
    }
    const container = containerRef.current
    const activePointerId = dragSnapshot?.pointerId ?? null
    resizeRef.current = null
    setDockPreviewActive(false)
    logDrag('stop dragging', {
      reason: event?.type ?? 'manual/cleanup',
      pointerType: dragSnapshot?.pointerType ?? null,
      activePointerId,
      moveCount: dragSnapshot?.moveCount ?? 0,
    })
    if (container && activePointerId !== null && 'hasPointerCapture' in container && container.hasPointerCapture(activePointerId)) {
      try {
        container.releasePointerCapture(activePointerId)
      } catch {
        // Ignore release failures from stale capture state.
      }
    }
    const onDockLeftHandler = onDockLeftRef.current
    if (container && onDockLeftHandler) {
      const rect = container.getBoundingClientRect()
      if (rect.left <= dockLeftThreshold) {
        logDrag('dock-left threshold reached', {
          left: rect.left,
          threshold: dockLeftThreshold,
        })
        dragRef.current = null
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', finishDragging)
        window.removeEventListener('pointercancel', finishDragging)
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', finishDragging)
        onDockLeftHandler()
        return
      }
    }
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', finishDragging)
    window.removeEventListener('pointercancel', finishDragging)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', finishDragging)
  }, [dockLeftThreshold, logDrag, onMouseMove, onPointerMove, setDockPreviewActive, window])

  const startDragging = useCallback(
    (
      pointerId: number,
      clientX: number,
      clientY: number,
      pointerType: string,
      explicitOffset?: { x: number; y: number }
    ) => {
      const container = containerRef.current
      if (!container) return
      resizeRef.current = null

      const rect = container.getBoundingClientRect()
      dragRef.current = {
        pointerId,
        offsetX: explicitOffset?.x ?? clientX - rect.left,
        offsetY: explicitOffset?.y ?? clientY - rect.top,
        pointerType,
        moveCount: 0,
      }
      logDrag('start dragging', {
        pointerId,
        pointerType,
        clientX,
        clientY,
        offsetX: explicitOffset?.x ?? clientX - rect.left,
        offsetY: explicitOffset?.y ?? clientY - rect.top,
      })
      setDockPreviewActive(rect.left <= dockLeftThreshold)

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', stopDragging)
      window.addEventListener('pointercancel', stopDragging)
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', stopDragging)
    },
    [dockLeftThreshold, logDrag, onMouseMove, onPointerMove, setDockPreviewActive, stopDragging, window]
  )

  const onResizeHandlePointerDown = useCallback(
    (edge: 'left' | 'right' | 'bottomRight') =>
      (event: ReactPointerEvent) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        const container = containerRef.current
        if (!container) return
        dragRef.current = null
        const rect = container.getBoundingClientRect()
        resizeRef.current = {
          pointerId: event.pointerId,
          edge,
          startX: event.clientX,
          startY: event.clientY,
          startLeft: rect.left,
          startTop: rect.top,
          startWidth: rect.width,
          startHeight: rect.height,
        }
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', stopDragging)
        window.addEventListener('pointercancel', stopDragging)
      },
    [onPointerMove, stopDragging, window]
  )

  const onHeaderPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      if ('setPointerCapture' in event.currentTarget) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Ignore capture failures; window listeners still provide fallback dragging.
        }
      }
      startDragging(event.pointerId, event.clientX, event.clientY, event.pointerType)
    },
    [startDragging]
  )

  const onWindowPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      if ('setPointerCapture' in event.currentTarget) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Ignore capture failures; window listeners still provide fallback dragging.
        }
      }
      startDragging(event.pointerId, event.clientX, event.clientY, event.pointerType)
    },
    [startDragging]
  )

  const windowStyle = useMemo<CSSProperties>(() => {
    const next: CSSProperties = {}
    if (position) {
      next.left = position.left
      next.top = position.top
    } else {
      next.top = initialTop
      next.right = initialRight
    }
    if (size?.width != null) next.width = size.width
    if (size?.height != null) next.height = size.height
    return next
  }, [position, initialRight, initialTop, size])

  useLayoutEffect(() => {
    if (!externalDragStart) return
    if (
      lastExternalDragTokenRef.current === externalDragStart.token &&
      dragRef.current?.pointerId === externalDragStart.pointerId
    ) {
      return
    }
    const container = containerRef.current
    if (!container) return

    lastExternalDragTokenRef.current = externalDragStart.token
    const detachedOffset = { x: externalDragStart.offsetX, y: externalDragStart.offsetY }
    // Temporary instrumentation for dock-to-floating handoff debugging.

    logger.debug(`[FloatingWindowDrag:${debugName}] external drag seed received`, {
      pointerId: externalDragStart.pointerId,
      pointerType: externalDragStart.pointerType,
      clientX: externalDragStart.clientX,
      clientY: externalDragStart.clientY,
      initialLeft: externalDragStart.initialLeft,
      initialTop: externalDragStart.initialTop,
      offsetX: detachedOffset.x,
      offsetY: detachedOffset.y,
      containerPresent: !!container,
    })
    setPosition({
      left: externalDragStart.initialLeft,
      top: externalDragStart.initialTop,
    })
    startDragging(
      externalDragStart.pointerId,
      externalDragStart.clientX,
      externalDragStart.clientY,
      externalDragStart.pointerType,
      detachedOffset
    )
    return () => {
      if (lastExternalDragTokenRef.current === externalDragStart.token) {
        lastExternalDragTokenRef.current = null
      }
    }
  }, [debugName, externalDragStart, margin, startDragging])

  useEffect(() => {
    logDrag('hook mounted')
    return () => {
      logDrag('hook cleanup (unmount)')
      setDockPreviewActive(false)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', stopDragging)
    }
  }, [logDrag, onMouseMove, onPointerMove, setDockPreviewActive, stopDragging, window])

  return {
    containerRef,
    onHeaderPointerDown,
    onWindowPointerDown,
    onResizeHandlePointerDown,
    windowStyle,
  }
}
