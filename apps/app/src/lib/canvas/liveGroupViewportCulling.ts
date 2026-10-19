import Konva from 'konva'

type GroupBounds = { x: number; y: number; width: number; height: number }

/** Skip raster/hit work for offscreen groups without hiding their scene geometry. */
export function installLiveGroupViewportCulling(
  group: Konva.Group,
  bounds: GroupBounds,
  overscanPx = 160
): () => void {
  const originalDrawScene = group.drawScene
  const originalDrawHit = group.drawHit

  const outsideViewport = () => {
    const stage = group.getStage()
    // Dragged artwork may extend beyond its group's original bounds.
    if (!stage || Konva.isDragging() || stage.width() <= 0 || stage.height() <= 0) return false
    // Read the live transform at draw time: React's pan/zoom props can trail an
    // imperative mouse/touch/wheel gesture by several frames.
    const transform = group.getAbsoluteTransform()
    const corners = [
      transform.point({ x: bounds.x, y: bounds.y }),
      transform.point({ x: bounds.x + bounds.width, y: bounds.y }),
      transform.point({ x: bounds.x, y: bounds.y + bounds.height }),
      transform.point({ x: bounds.x + bounds.width, y: bounds.y + bounds.height }),
    ]
    return (
      Math.max(...corners.map((point) => point.x)) < -overscanPx ||
      Math.min(...corners.map((point) => point.x)) > stage.width() + overscanPx ||
      Math.max(...corners.map((point) => point.y)) < -overscanPx ||
      Math.min(...corners.map((point) => point.y)) > stage.height() + overscanPx
    )
  }

  const drawScene: Konva.Group['drawScene'] = function (
    this: Konva.Group,
    canvas,
    top,
    bufferCanvas
  ) {
    const layer = this.getLayer()
    // Only the live layer is culled. Node snapshots/caches and export canvases
    // must draw the complete scene, regardless of the editor's current camera.
    if (!top && layer && (!canvas || canvas === layer.getCanvas()) && outsideViewport()) return this
    return originalDrawScene.call(this, canvas, top, bufferCanvas)
  }
  const drawHit: Konva.Group['drawHit'] = function (this: Konva.Group, canvas, top) {
    const layer = this.getLayer()
    if (!top && layer && (!canvas || canvas === layer.getHitCanvas()) && outsideViewport())
      return this
    return originalDrawHit.call(this, canvas, top)
  }
  group.drawScene = drawScene
  group.drawHit = drawHit

  // These are instance methods, not serialized attrs or event handlers: cloning
  // a Group for PDF/SVG export leaves the original Konva drawing methods intact.
  // visible/getClientRect are untouched, so fit/selection still see all artwork.
  return () => {
    if (group.drawScene === drawScene) group.drawScene = originalDrawScene
    if (group.drawHit === drawHit) group.drawHit = originalDrawHit
  }
}
