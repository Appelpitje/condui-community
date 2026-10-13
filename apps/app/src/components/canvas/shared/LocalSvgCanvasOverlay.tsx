import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type Konva from 'konva'
import { Group } from 'react-konva'

export interface CanvasSvgOverlayItem {
  id: string
  bounds: { x: number; y: number; width: number; height: number }
  opacity?: number
  content: ReactNode
}

let nextOverlayId = 0

/** Keep local vector decorations off the viewport-sized Konva scene canvas. */
export function LocalSvgCanvasOverlay({
  name,
  items,
}: {
  name: string
  items: CanvasSvgOverlayItem[]
}) {
  const anchorRef = useRef<Konva.Group>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const renderRef = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const stage = anchor?.getStage()
    const layer = anchor?.getLayer()
    if (!anchor || !stage || !layer) return

    const sourceCanvas = layer.getNativeCanvasElement()
    const namespace = `.localSvgOverlay${++nextOverlayId}`
    const host = document.createElement('div')
    host.dataset.canvasSvgOverlay = name
    Object.assign(host.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
    })
    host.setAttribute('aria-hidden', 'true')
    // Each SVG has its own small bounds; the clipping host has no camera transform
    // or promoted backing surface. The native overlay/proxy stays above these hints.
    stage.content.insertBefore(host, sourceCanvas)
    const root: Root = createRoot(host)
    let scheduled: number | null = null
    let disposed = false

    const render = () => {
      if (disposed) return
      host.style.width = `${stage.width()}px`
      host.style.height = `${stage.height()}px`
      const [a = NaN, b = NaN, c = NaN, d = NaN, e = NaN, f = NaN] = anchor
        .getAbsoluteTransform()
        .getMatrix()
      const scaleX = Math.hypot(a, b)
      const scaleY = Math.hypot(c, d)
      const visible =
        anchor.isVisible() &&
        sourceCanvas.style.display !== 'none' &&
        [a, b, c, d, e, f, scaleX, scaleY].every(Number.isFinite) &&
        scaleX > 0 &&
        scaleY > 0
      host.style.display = visible ? '' : 'none'
      if (!visible) return
      const cssCamera = sourceCanvas.style.transform
      const anchorOpacity = anchor.getAbsoluteOpacity()
      root.render(
        <>
          {itemsRef.current.map((item) => {
            const { x, y, width, height } = item.bounds
            // Bake camera scale into SVG size so native vector rasterization stays
            // sharp; the normalized matrix also preserves rotation/skew if present.
            const matrix = `matrix(${a / scaleX}, ${b / scaleX}, ${c / scaleY}, ${d / scaleY}, ${a * x + c * y + e}, ${b * x + d * y + f})`
            return (
              <svg
                key={item.id}
                data-canvas-svg-item={item.id}
                aria-hidden="true"
                focusable="false"
                width={width * scaleX}
                height={height * scaleY}
                viewBox={`${x} ${y} ${width} ${height}`}
                preserveAspectRatio="none"
                opacity={(item.opacity ?? 1) * anchorOpacity}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  pointerEvents: 'none',
                  transformOrigin: '0 0',
                  transform: `${cssCamera} ${matrix}`.trim(),
                }}
              >
                {item.content}
              </svg>
            )
          })}
        </>
      )
    }
    const schedule = () => {
      if (disposed || scheduled !== null) return
      scheduled = requestAnimationFrame(() => {
        scheduled = null
        render()
      })
    }
    const observer = new MutationObserver(schedule)
    observer.observe(sourceCanvas, { attributes: true, attributeFilter: ['style'] })
    const cameraEvents = [
      'xChange',
      'yChange',
      'scaleXChange',
      'scaleYChange',
      'rotationChange',
      'skewXChange',
      'skewYChange',
      'visibleChange',
      'opacityChange',
    ]
      .map((event) => `${event}${namespace}`)
      .join(' ')
    anchor.on(cameraEvents, schedule)
    layer.on(cameraEvents, schedule)
    stage.on(`${cameraEvents} widthChange${namespace} heightChange${namespace}`, schedule)
    renderRef.current = render
    return () => {
      disposed = true
      renderRef.current = null
      if (scheduled !== null) cancelAnimationFrame(scheduled)
      observer.disconnect()
      anchor.off(namespace)
      layer.off(namespace)
      stage.off(namespace)
      host.remove()
      // This component runs in the Konva reconciler. Finish the independent DOM
      // root outside its commit so React does not attempt a nested root unmount.
      queueMicrotask(() => root.unmount())
    }
  }, [name])

  useLayoutEffect(() => {
    renderRef.current?.()
  }, [items, name])

  return <Group ref={anchorRef} name={name} listening={false} />
}
