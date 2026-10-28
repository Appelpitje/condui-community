import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type Konva from 'konva'
import { Group } from 'react-konva'

export interface CanvasSvgOverlayItem {
  id: string
  bounds: { x: number; y: number; width: number; height: number }
  opacity?: number
  /** World-space point used for pointer-distance feedback; defaults to the item's centre. */
  pointerAnchor?: { x: number; y: number }
  content: ReactNode
}

type PointerOpacity = (item: CanvasSvgOverlayItem, distancePx: number | null) => number

let nextOverlayId = 0

/** Keep local vector decorations off the viewport-sized Konva scene canvas. */
export function LocalSvgCanvasOverlay({
  name,
  items,
  pointerOpacity,
}: {
  name: string
  items: CanvasSvgOverlayItem[]
  /** Optional paint-only feedback. Distances include the live canvas/CSS camera scale. */
  pointerOpacity?: PointerOpacity
}) {
  const anchorRef = useRef<Konva.Group>(null)
  const itemsRef = useRef(items)
  const pointerOpacityRef = useRef(pointerOpacity)
  useLayoutEffect(() => {
    itemsRef.current = items
    pointerOpacityRef.current = pointerOpacity
  }, [items, pointerOpacity])
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
    let pointerFrame: number | null = null
    let clientPointer: { x: number; y: number } | null = null
    const svgItems = new Map<string, SVGSVGElement>()
    let disposed = false

    const paintPointerOpacity = () => {
      if (disposed || !pointerOpacityRef.current) return
      const rect = stage.content.getBoundingClientRect()
      const inside = clientPointer && clientPointer.x >= rect.left && clientPointer.x <= rect.right &&
        clientPointer.y >= rect.top && clientPointer.y <= rect.bottom
      const camera = new DOMMatrix(sourceCanvas.style.transform || undefined).multiply(
        new DOMMatrix(anchor.getAbsoluteTransform().getMatrix())
      )
      const anchorOpacity = anchor.getAbsoluteOpacity()
      for (const item of itemsRef.current) {
        const svg = svgItems.get(item.id)
        if (!svg) continue
        const origin = item.pointerAnchor ?? {
          x: item.bounds.x + item.bounds.width / 2,
          y: item.bounds.y + item.bounds.height / 2,
        }
        const distance = inside && clientPointer ? Math.hypot(
          clientPointer.x - rect.left - (camera.a * origin.x + camera.c * origin.y + camera.e),
          clientPointer.y - rect.top - (camera.b * origin.x + camera.d * origin.y + camera.f)
        ) : null
        const opacity = String(pointerOpacityRef.current(item, distance) * anchorOpacity)
        if (svg.getAttribute('opacity') !== opacity) svg.setAttribute('opacity', opacity)
      }
    }
    const schedulePointerPaint = () => {
      if (disposed || !pointerOpacityRef.current || pointerFrame !== null) return
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = null
        paintPointerOpacity()
      })
    }
    const trackPointer = (event: MouseEvent | PointerEvent) => {
      clientPointer = { x: event.clientX, y: event.clientY }
      schedulePointerPaint()
    }
    const trackTouch = (event: TouchEvent) => {
      const touch = event.touches[0]
      clientPointer = touch ? { x: touch.clientX, y: touch.clientY } : null
      schedulePointerPaint()
    }
    const trackLibraryTouch = (event: Event) => {
      const detail = (event as CustomEvent<{ x?: number; y?: number }>).detail
      clientPointer = detail && typeof detail.x === 'number' && typeof detail.y === 'number' &&
        Number.isFinite(detail.x) && Number.isFinite(detail.y)
        ? { x: detail.x, y: detail.y } : null
      schedulePointerPaint()
    }
    const clearPointer = () => {
      clientPointer = null
      schedulePointerPaint()
    }

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
                ref={(svg) => {
                  if (svg) svgItems.set(item.id, svg)
                  else svgItems.delete(item.id)
                  schedulePointerPaint()
                }}
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
      schedulePointerPaint()
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
    // Native library drags, existing Konva moves and touch-library gestures share
    // this small DOM-only paint path; none of them redraw the diagram or React tree.
    const passiveCapture = { passive: true, capture: true }
    window.addEventListener('pointermove', trackPointer, passiveCapture)
    window.addEventListener('dragover', trackPointer, passiveCapture)
    window.addEventListener('touchmove', trackTouch, passiveCapture)
    window.addEventListener('touchdragmove', trackLibraryTouch)
    window.addEventListener('pointercancel', clearPointer)
    window.addEventListener('touchend', clearPointer)
    window.addEventListener('touchcancel', clearPointer)
    window.addEventListener('blur', clearPointer)
    return () => {
      disposed = true
      renderRef.current = null
      if (scheduled !== null) cancelAnimationFrame(scheduled)
      if (pointerFrame !== null) cancelAnimationFrame(pointerFrame)
      window.removeEventListener('pointermove', trackPointer, true)
      window.removeEventListener('dragover', trackPointer, true)
      window.removeEventListener('touchmove', trackTouch, true)
      window.removeEventListener('touchdragmove', trackLibraryTouch)
      window.removeEventListener('pointercancel', clearPointer)
      window.removeEventListener('touchend', clearPointer)
      window.removeEventListener('touchcancel', clearPointer)
      window.removeEventListener('blur', clearPointer)
      svgItems.clear()
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
  }, [items, name, pointerOpacity])

  return <Group ref={anchorRef} name={name} listening={false} />
}
