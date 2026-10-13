import { useLayoutEffect, useRef, type ReactNode } from 'react'
import Konva from 'konva'
import { Group } from 'react-konva'
import { createReusableCanvasNodeSnapshot } from '@/lib/canvas/nodeSnapshot'

let nextPreviewId = 0
const previewLayers = new WeakMap<Konva.Layer, Konva.Layer>()

const minimizePreviewLayer = (layer: Konva.Layer) => {
  layer.getCanvas().setSize(1, 1)
  layer.getHitCanvas().setSize(1, 1)
}

function getPreviewLayer(sourceLayer: Konva.Layer, stage: Konva.Stage) {
  const existing = previewLayers.get(sourceLayer)
  if (existing?.getStage() === stage) return existing
  const layer = new Konva.Layer({
    visible: false,
    listening: false,
    name: 'canvas-preview-source',
  })
  // Adding/removing a Stage child schedules every layer, including the dense
  // diagram. Keep this tiny source owned by the Stage across preview switches.
  stage.add(layer)
  minimizePreviewLayer(layer)
  const namespace = `.boundedPreviewSource${++nextPreviewId}`
  stage.on(`widthChange${namespace} heightChange${namespace}`, () => minimizePreviewLayer(layer))
  previewLayers.set(sourceLayer, layer)
  // Stage.destroy() destroys its children. The weak key needs no independent
  // ownership or cleanup when the canvas is unmounted.
  return layer
}

/** Present non-interactive preview artwork on a cropped canvas, keeping world-space Konva nodes. */
export function BoundedCanvasPreview({ children }: { children: ReactNode }) {
  const groupRef = useRef<Konva.Group>(null)
  const scheduleRef = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    const group = groupRef.current
    const stage = group?.getStage()
    const parent = group?.getParent()
    const sourceLayer = group?.getLayer()
    if (!group || !stage || !parent || !sourceLayer) return
    const namespace = `.boundedPreview${++nextPreviewId}`
    const layer = getPreviewLayer(sourceLayer, stage)
    const painter = createReusableCanvasNodeSnapshot()
    const image = painter.canvas
    image.dataset.canvasBoundedPreview = ''
    image.style.position = 'absolute'
    image.style.left = '0'
    image.style.top = '0'
    image.style.pointerEvents = 'none'
    image.setAttribute('aria-hidden', 'true')
    // Preserve the ordering: above the diagram, below hints and the selected symbol.
    stage.content.insertBefore(image, sourceLayer.getNativeCanvasElement())
    let scheduled: number | null = null
    const render = () => {
      layer.position(sourceLayer.position())
      layer.scale(sourceLayer.scale())
      const snapshot = painter.render(group)
      if (!snapshot) {
        // Large, empty or unsupported artwork retains the normal Konva path.
        image.style.display = 'none'
        if (group.getParent() !== parent) group.moveTo(parent)
        return
      }
      if (group.getParent() !== layer) group.moveTo(layer)
      image.style.display = ''
      const point = group.getAbsolutePosition()
      const ratio = snapshot.pixelRatio
      const x = Math.round((point.x + snapshot.offset.x) * ratio) / ratio
      const y = Math.round((point.y + snapshot.offset.y) * ratio) / ratio
      image.style.transformOrigin = '0 0'
      image.style.transform = `${sourceLayer.getNativeCanvasElement().style.transform} translate3d(${x}px, ${y}px, 0)`
    }
    const schedule = () => {
      if (scheduled !== null) return
      scheduled = requestAnimationFrame(() => {
        scheduled = null
        render()
      })
    }
    const observer = new MutationObserver(schedule)
    observer.observe(sourceLayer.getNativeCanvasElement(), {
      attributes: true,
      attributeFilter: ['style'],
    })
    sourceLayer.on(
      `xChange${namespace} yChange${namespace} scaleXChange${namespace} scaleYChange${namespace}`,
      schedule
    )
    // Child components can load symbol images after the parent's layout effect.
    // A hidden one-pixel draw is also the signal for such artwork changes.
    layer.on(`draw${namespace}`, schedule)
    sourceLayer.on(`draw${namespace}`, () => {
      if (group.getParent() === parent) schedule()
    })
    stage.on(`widthChange${namespace} heightChange${namespace}`, () => {
      schedule()
    })
    scheduleRef.current = schedule
    return () => {
      scheduleRef.current = null
      if (scheduled !== null) cancelAnimationFrame(scheduled)
      observer.disconnect()
      layer.off(namespace)
      sourceLayer.off(namespace)
      stage.off(namespace)
      image.remove()
      painter.dispose()
      if (group.getStage() === stage && parent.getStage() === stage) group.moveTo(parent)
    }
  }, [])
  useLayoutEffect(() => {
    // Child props also schedule a hidden-layer draw. Coalesce that signal and
    // React's update so a target change paints once after its nodes are settled.
    scheduleRef.current?.()
  }, [children])
  return (
    <Group ref={groupRef} name="bounded-preview-artwork" listening={false}>
      {children}
    </Group>
  )
}
