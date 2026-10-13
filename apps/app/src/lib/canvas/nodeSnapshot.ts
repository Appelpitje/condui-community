import Konva from 'konva'

const PADDING = 2
const MAX_IMAGE_PIXELS = 4_194_304

export interface CanvasNodeSnapshot {
  canvas: HTMLCanvasElement
  offset: { x: number; y: number }
  pixelRatio: number
}

type SnapshotPainter = (
  clone: Konva.Group,
  width: number,
  height: number,
  pixelRatio: number
) => HTMLCanvasElement

/** Rasterize only the artwork's bounds, at its existing camera scale and pixel ratio. */
export function createCanvasNodeSnapshot(
  node: Konva.Group,
  clipToStage = false,
  paint?: SnapshotPainter
): CanvasNodeSnapshot | null {
  const [scaleX = 0, skewY = 0, skewX = 0, scaleY = 0] = node.getAbsoluteTransform().getMatrix()
  if (Math.abs(skewY) > 1e-8 || Math.abs(skewX) > 1e-8 || scaleX <= 0 || scaleY <= 0) return null
  const ratio = node.getLayer()?.getCanvas().getPixelRatio() ?? window.devicePixelRatio
  const clone = node.clone({ x: 0, y: 0, scaleX, scaleY, rotation: 0, skewX: 0, skewY: 0 })
  try {
    const bounds = clone.getClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return null
    let left = bounds.x - PADDING
    let top = bounds.y - PADDING
    let right = bounds.x + bounds.width + PADDING
    let bottom = bounds.y + bounds.height + PADDING
    const stage = node.getStage()
    if (clipToStage && stage) {
      const point = node.getAbsolutePosition()
      left = Math.max(left, -point.x)
      top = Math.max(top, -point.y)
      right = Math.min(right, stage.width() - point.x)
      bottom = Math.min(bottom, stage.height() - point.y)
    }
    const width = Math.ceil(right - left)
    const height = Math.ceil(bottom - top)
    if (
      !Number.isFinite(width * height) ||
      width <= 0 ||
      height <= 0 ||
      width * height * ratio * ratio > MAX_IMAGE_PIXELS
    )
      return null
    const offset = { x: left, y: top }
    // Export at the origin so the temporary buffer cannot grow with world coordinates.
    clone.position({ x: -left, y: -top })
    const canvas = paint
      ? paint(clone, width, height, ratio)
      : clone.toCanvas({ x: 0, y: 0, width, height, pixelRatio: ratio })
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    return { canvas, offset, pixelRatio: ratio }
  } catch {
    return null
  } finally {
    clone.destroy()
  }
}

/** Repaint a bounded preview directly into its displayed canvas, reusing both buffers. */
export function createReusableCanvasNodeSnapshot() {
  // Detached layers provide Konva's own SceneCanvas/Context without adding a
  // Stage child or importing a second copy of Konva's canvas implementation.
  const sceneOwner = new Konva.Layer({ listening: false })
  const bufferOwner = new Konva.Layer({ listening: false })
  const scene = sceneOwner.getCanvas()
  const buffer = bufferOwner.getCanvas()
  scene.setSize(1, 1)
  buffer.setSize(1, 1)
  sceneOwner.getHitCanvas().setSize(1, 1)
  bufferOwner.getHitCanvas().setSize(1, 1)
  const resize = (canvas: typeof scene, width: number, height: number, ratio: number) => {
    if (canvas.getPixelRatio() !== ratio) canvas.setPixelRatio(ratio)
    if (canvas.getWidth() !== width * ratio || canvas.getHeight() !== height * ratio)
      canvas.setSize(width, height)
  }
  return {
    canvas: sceneOwner.getNativeCanvasElement(),
    render(node: Konva.Group) {
      return createCanvasNodeSnapshot(node, true, (clone, width, height, ratio) => {
        resize(scene, width, height, ratio)
        resize(buffer, width, height, ratio)
        scene.getContext().clear()
        clone.drawScene(scene, undefined, buffer)
        return sceneOwner.getNativeCanvasElement()
      })
    },
    dispose() {
      sceneOwner.destroy()
      bufferOwner.destroy()
    },
  }
}
