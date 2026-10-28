import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useInitialCanvasSize } from '@/components/layout/initialCanvasSize'
import { useCanvasWindow } from '@/components/viewport/ViewportContext'

/** Keep DOM viewport geometry in committed state for surface culling and HTML overlays. */
export function usePanelViewportRect(containerRef: RefObject<HTMLDivElement | null>) {
  const initialSize = useInitialCanvasSize()
  const window = useCanvasWindow()
  const [rect, setRect] = useState(() => ({
    left: 0,
    top: 0,
    width: initialSize?.width ?? window.innerWidth,
    height: initialSize?.height ?? window.innerHeight,
  }))
  const subscription = useRef<{
    element: HTMLDivElement
    measure: () => void
    dispose: () => void
  } | null>(null)
  // Layout can move the container without resizing it; retain native subscriptions
  // across those commits and replace them only when the actual DOM node changes.
  useLayoutEffect(() => {
    const element = containerRef.current
    if (subscription.current?.element !== element) {
      subscription.current?.dispose()
      subscription.current = null
    }
    if (!element) return
    if (!subscription.current) {
      const measure = () => {
        const next = element.getBoundingClientRect()
        const width = element.clientWidth,
          height = element.clientHeight
        setRect((previous) =>
          previous.left === next.left &&
          previous.top === next.top &&
          previous.width === width &&
          previous.height === height
            ? previous
            : { left: next.left, top: next.top, width, height }
        )
      }
      const observer = new ResizeObserver(measure)
      observer.observe(element)
      const ownerWindow = element.ownerDocument.defaultView
      ownerWindow?.addEventListener('scroll', measure, true)
      subscription.current = {
        element,
        measure,
        dispose: () => {
          observer.disconnect()
          ownerWindow?.removeEventListener('scroll', measure, true)
        },
      }
    }
    subscription.current.measure()
  })
  useLayoutEffect(
    () => () => {
      subscription.current?.dispose()
      subscription.current = null
    },
    []
  )
  return rect
}
