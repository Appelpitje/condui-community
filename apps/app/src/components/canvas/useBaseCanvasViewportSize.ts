import type { BaseCanvasProps } from './baseCanvasModel'
import type { useCanvasWindow } from '@/components/viewport/ViewportContext'

import { useEffect, useCallback } from 'react'

import type { CanvasSize, Point } from '@/types/ui'

import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from 'react'

interface BaseCanvasViewportSizeOptions extends Pick<BaseCanvasProps, 'onViewportPixelSizeChange'> {
  containerRef: RefObject<HTMLDivElement | null>
  deferredViewportSizeRef: RefObject<CanvasSize | null>
  emitViewTransformPatch: (patch: { pan?: Point; zoom?: number }) => void
  panRef: RefObject<Point>
  prevSizeRef: RefObject<CanvasSize | null>
  scheduledViewportRafRef: RefObject<number | null>
  scheduledViewportSizeRef: RefObject<CanvasSize | null>
  scheduledViewportTimeoutRef: RefObject<number | null>
  setSize: Dispatch<SetStateAction<CanvasSize>>
  viewportResizePreviewActive: boolean
  window: ReturnType<typeof useCanvasWindow>
}


export function useBaseCanvasViewportSize({
  containerRef,
  deferredViewportSizeRef,
  emitViewTransformPatch,
  onViewportPixelSizeChange,
  panRef,
  prevSizeRef,
  scheduledViewportRafRef,
  scheduledViewportSizeRef,
  scheduledViewportTimeoutRef,
  setSize,
  viewportResizePreviewActive,
  window,
}: BaseCanvasViewportSizeOptions) {
  const commitViewportSize = useCallback(
    (next: CanvasSize, allowPanRecenter: boolean) => {
      const prev = prevSizeRef.current
      if (
        allowPanRecenter &&
        prev &&
        prev.width > 0 &&
        prev.height > 0 &&
        (prev.width !== next.width || prev.height !== next.height)
      ) {
        const dx = (next.width - prev.width) / 2
        const dy = (next.height - prev.height) / 2
        const newPan = { x: panRef.current.x + dx, y: panRef.current.y + dy }
        panRef.current = newPan
        emitViewTransformPatch({ pan: newPan })
      }
      prevSizeRef.current = next
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next
      )
      onViewportPixelSizeChange?.(next)
    },
    [emitViewTransformPatch, onViewportPixelSizeChange, panRef, prevSizeRef, setSize]
  )

  const cancelScheduledViewportSizeCommit = useCallback(() => {
    if (scheduledViewportRafRef.current != null) {
      window.cancelAnimationFrame(scheduledViewportRafRef.current)
      scheduledViewportRafRef.current = null
    }
    if (scheduledViewportTimeoutRef.current != null) {
      window.clearTimeout(scheduledViewportTimeoutRef.current)
      scheduledViewportTimeoutRef.current = null
    }
  }, [window, scheduledViewportRafRef, scheduledViewportTimeoutRef])

  const scheduleViewportSizeCommit = useCallback(
    (next: CanvasSize, allowPanRecenter: boolean) => {
      scheduledViewportSizeRef.current = next
      if (scheduledViewportRafRef.current != null || scheduledViewportTimeoutRef.current != null)
        return

      scheduledViewportRafRef.current = window.requestAnimationFrame(() => {
        scheduledViewportRafRef.current = null
        scheduledViewportTimeoutRef.current = window.setTimeout(() => {
          scheduledViewportTimeoutRef.current = null
          const scheduled = scheduledViewportSizeRef.current
          scheduledViewportSizeRef.current = null
          if (scheduled) commitViewportSize(scheduled, allowPanRecenter)
        }, 0)
      })
    },
    [commitViewportSize, window, scheduledViewportRafRef, scheduledViewportSizeRef, scheduledViewportTimeoutRef]
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newW = Math.round(entry.contentRect.width)
        const newH = Math.round(entry.contentRect.height)
        if (newW === 0 || newH === 0) continue
        const next = { width: newW, height: newH }
        if (viewportResizePreviewActive) {
          cancelScheduledViewportSizeCommit()
          deferredViewportSizeRef.current = next
          continue
        }
        deferredViewportSizeRef.current = null
        if (prevSizeRef.current) {
          scheduleViewportSizeCommit(next, true)
        } else {
          commitViewportSize(next, true)
        }
      }
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      cancelScheduledViewportSizeCommit()
    }
  }, [
    cancelScheduledViewportSizeCommit,
    commitViewportSize,
    scheduleViewportSizeCommit,
    viewportResizePreviewActive,
    containerRef,
    deferredViewportSizeRef,
    prevSizeRef,
  ])

  useEffect(() => {
    if (viewportResizePreviewActive) return
    const deferred = deferredViewportSizeRef.current
    if (deferred) {
      deferredViewportSizeRef.current = null
      scheduleViewportSizeCommit(deferred, true)
      return
    }
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    if (width === 0 || height === 0) return
    commitViewportSize({ width, height }, true)
  }, [commitViewportSize, scheduleViewportSizeCommit, viewportResizePreviewActive, containerRef, deferredViewportSizeRef])

}
