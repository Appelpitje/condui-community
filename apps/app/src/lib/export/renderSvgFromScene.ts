/**
 * Render SVG from isolated export scene
 * No live stage mutations - works with isolated clones
 */

import type { ExportScene } from './types'
import { exportStageSVG } from './reactKonvaToSvgPatched'
import { fixTextAlignment } from './textAlignment'
import { applyCoordinatePrecision, formatCoordinate } from './coordinatePrecision'
import Konva from 'konva'

/**
 * Konva's perfect-draw optimization renders some semi-transparent shapes to
 * its buffer canvas first. The SVG bridge serializes that canvas as one image
 * with the full stage dimensions, which turns an otherwise vector export into
 * a huge transparent PNG. Export scenes are isolated clones, so disabling the
 * optimization here cannot affect the live editor.
 */
export function disableBufferCanvasForSvgExport(root: Konva.Container): void {
  root.find((node: Konva.Node) => node instanceof Konva.Shape).forEach((node) => {
    const shape = node as Konva.Shape
    shape.perfectDrawEnabled(false)
  })
}

/**
 * Render an isolated export scene to SVG string
 *
 * @param scene Isolated export scene
 * @returns SVG string
 */
export async function renderSvgFromScene(
  scene: ExportScene
): Promise<string> {
  const tempStageWidth = Math.max(
    1,
    Math.ceil(scene.bounds.width + Math.abs(scene.bounds.x) * 2),
  )
  const tempStageHeight = Math.max(
    1,
    Math.ceil(scene.bounds.height + Math.abs(scene.bounds.y) * 2),
  )

  // Create temporary stage with scene root
  const tempStage = new Konva.Stage({
    container: document.createElement('div'),
    width: tempStageWidth,
    height: tempStageHeight,
  })

  try {
    const tempLayer = new Konva.Layer()
    tempStage.add(tempLayer)

    // Add scene root to temp layer
    tempLayer.add(scene.rootNode)
    disableBufferCanvasForSvgExport(scene.rootNode)
    tempStage.draw()

    // Export using react-konva-to-svg (patched version)
    const svgResult = await exportStageSVG(tempStage, false, {
      layerIndex: 0, // Only one layer in temp stage
    })
    let svgString = typeof svgResult === 'string' ? svgResult : await svgResult.text()

    // Set viewBox to match scene bounds
    const parser = new DOMParser()
    const svgDoc = parser.parseFromString(svgString, 'image/svg+xml')
    const svgElement = svgDoc.documentElement

    // Set viewBox to match scene bounds exactly - this ensures content is clipped to bounds
    // Use formatted coordinates for precision
    svgElement.setAttribute('viewBox',
      `${formatCoordinate(scene.bounds.x)} ${formatCoordinate(scene.bounds.y)} ${formatCoordinate(scene.bounds.width)} ${formatCoordinate(scene.bounds.height)}`
    )
    svgElement.setAttribute('width', formatCoordinate(scene.bounds.width))
    svgElement.setAttribute('height', formatCoordinate(scene.bounds.height))
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet')

    // Ensure overflow is hidden (viewBox should handle this, but be explicit)
    svgElement.setAttribute('overflow', 'hidden')

    // Get updated SVG string
    svgString = new XMLSerializer().serializeToString(svgDoc)

    // Apply fidelity improvements
    svgString = applyCoordinatePrecision(svgString)
    svgString = fixTextAlignment(svgString)

    return svgString
  } finally {
    // The isolated scene is consumed even if SVG conversion or parsing fails.
    scene.rootNode.destroy()
    tempStage.destroy()
  }
}
