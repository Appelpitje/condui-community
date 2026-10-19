import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { CanvasSize } from '@/types/ui'

const InitialCanvasSizeContext = createContext<CanvasSize | null>(null)

export function useInitialCanvasSize(): CanvasSize | null {
  return useContext(InitialCanvasSizeContext)
}

/** Mount the renderer once at its actual viewport size, rather than first
 * allocating/drawing an 800x600 scene and immediately resizing every layer. */
export function MeasuredCanvasViewport({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null)
  const [initialSize, setInitialSize] = useState<CanvasSize | null>(null)
  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      if (width <= 0 || height <= 0) return false
      setInitialSize({ width, height })
      return true
    }
    if (measure()) return
    // A viewport may begin hidden or have no size during its parent's layout.
    const observer = new ResizeObserver(() => {
      if (measure()) observer.disconnect()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={container} className="relative h-full w-full">
      <InitialCanvasSizeContext.Provider value={initialSize}>
        {initialSize && children}
      </InitialCanvasSizeContext.Provider>
    </div>
  )
}
