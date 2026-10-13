import Konva from 'konva'
import { createCanvasNodeSnapshot } from './nodeSnapshot'

export interface CanvasDragImage {
  update: () => void
  dispose: () => void
}

let nextImageId = 0

/** Keep Konva's drag owner, but present its moving artwork on a tightly cropped DOM canvas. */
export function createCanvasDragImage(node: Konva.Node): CanvasDragImage | null {
  const stage = node.getStage()
  const parent = node.getParent()
  const sourceLayer = node.getLayer()
  const dragLayer = stage?.findOne('.canvas-drag-layer')
  if (
    !stage ||
    !parent ||
    !sourceLayer ||
    !(node instanceof Konva.Group) ||
    !(dragLayer instanceof Konva.Layer) ||
    dragLayer === sourceLayer ||
    dragLayer.getChildren().length !== 0
  )
    return null

  if (sourceLayer.getNativeCanvasElement().style.transform) return null
  const snapshot = createCanvasNodeSnapshot(node)
  if (!snapshot) return null
  const { canvas: image, offset, pixelRatio: ratio } = snapshot

  const namespace = `.canvasDragImage${++nextImageId}`
  const scene = dragLayer.getCanvas()
  const hit = dragLayer.getHitCanvas()
  const original = {
    visible: dragLayer.visible(),
    listening: dragLayer.listening(),
    sceneWidth: scene.getWidth() / scene.getPixelRatio(),
    sceneHeight: scene.getHeight() / scene.getPixelRatio(),
    hitWidth: hit.getWidth() / hit.getPixelRatio(),
    hitHeight: hit.getHeight() / hit.getPixelRatio(),
    stageWidth: stage.width(),
    stageHeight: stage.height(),
  }
  let active = true
  const position = node.getAbsolutePosition()
  image.dataset.canvasDragImage = ''
  image.style.position = 'absolute'
  image.style.left = '0'
  image.style.top = '0'
  image.style.pointerEvents = 'none'
  image.style.willChange = 'transform'
  image.setAttribute('aria-hidden', 'true')
  stage.content.appendChild(image)

  // An invisible one-pixel layer retains the original Stage/event pipeline without
  // clearing or uploading a viewport-sized scene or hit canvas on every movement.
  dragLayer.visible(false)
  dragLayer.listening(false)
  scene.setSize(1, 1)
  hit.setSize(1, 1)
  node.moveTo(dragLayer)
  node.setAbsolutePosition(position)

  const dispose = () => {
    if (!active) return
    active = false
    image.remove()
    observer.disconnect()
    stage.off(namespace)
    sourceLayer.off(namespace)
    node.off(namespace)
    node.find('*').forEach((child) => child.off(namespace))
    if (node.getStage() === stage && parent.getStage() === stage) {
      const currentPosition = node.getAbsolutePosition()
      node.moveTo(parent)
      node.setAbsolutePosition(currentPosition)
    }
    const resized = stage.width() !== original.stageWidth || stage.height() !== original.stageHeight
    scene.setSize(
      resized ? stage.width() : original.sceneWidth,
      resized ? stage.height() : original.sceneHeight
    )
    hit.setSize(
      resized ? stage.width() : original.hitWidth,
      resized ? stage.height() : original.hitHeight
    )
    dragLayer.visible(original.visible)
    dragLayer.listening(original.listening)
    // Release the snapshot backing store as soon as the gesture ends.
    image.width = image.height = 0
  }
  const update = () => {
    if (!active) return
    if (node.getStage() !== stage || parent.getStage() !== stage) {
      dispose()
      return
    }
    const point = node.getAbsolutePosition()
    const x = Math.round((point.x + offset.x) * ratio) / ratio
    const y = Math.round((point.y + offset.y) * ratio) / ratio
    image.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }
  const observer = new MutationObserver(() => {
    if (sourceLayer.getNativeCanvasElement().style.transform) dispose()
  })
  observer.observe(sourceLayer.getNativeCanvasElement(), {
    attributes: true,
    attributeFilter: ['style'],
  })
  stage.on(`widthChange${namespace} heightChange${namespace}`, dispose)
  sourceLayer.on(
    `xChange${namespace} yChange${namespace} scaleXChange${namespace} scaleYChange${namespace}`,
    dispose
  )
  node.on(`add${namespace}`, dispose)
  // A newly loaded symbol image or changed label must remain visible during the drag.
  node
    .find('*')
    .forEach((child) =>
      child.on(
        `imageChange${namespace} textChange${namespace} fontFamilyChange${namespace} fontSizeChange${namespace} visibleChange${namespace}`,
        dispose
      )
    )
  update()
  return { update, dispose }
}
