/**
 * Patched version of react-konva-to-svg with layer selection support
 * 
 * Original library: https://github.com/dendrofen/react-konva-to-svg
 * 
 * Changes:
 * - Added `layerIndex` option to select which layer to export (defaults to 0 for backward compatibility)
 * - Supports exporting any layer, not just the first one
 */

import { Context } from "svgcanvas";
import type Konva from "konva";

type SvgExportLayer = Konva.Layer & {
  canvas: {
    context: SvgCanvasContextSlot;
  };
};

type SvgExportStage = Konva.Stage & {
  getLayers(): SvgExportLayer[];
};

type SvgCanvasContextSlot = {
  _context: CanvasRenderingContext2D | Context;
};

type SvgExportCallbackArgs = [SvgExportStage, SvgExportLayer];

/**
 * Asynchronously sleeps for a specified time.
 * @param {number} time - The time to sleep in milliseconds.
 * @returns {Promise<void>} A Promise that resolves after sleeping.
 */
export const sleep = async (time: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, time));

/**
 * Exports the SVG representation of a Konva stage.
 * @param {Stage} stage - The Konva stage to export.
 * @param {boolean} [blob=false] - Whether to return a Blob object instead of a string.
 * @param {Object} [options] - Additional options.
 * @param {number} [options.layerIndex=0] - Index of the layer to export (defaults to 0 for backward compatibility).
 * @param {Function} [options.onBefore] - A callback function to execute before exporting.
 * @param {Function} [options.onAfter] - A callback function to execute after exporting.
 * @returns {string|Blob} The SVG data or a Blob object.
 */
export async function exportStageSVG(
  stage: SvgExportStage,
  blob: boolean = false,
  { layerIndex = 0, onBefore, onAfter }: {
    layerIndex?: number;
    onBefore?: (args: SvgExportCallbackArgs) => void;
    onAfter?: (args: SvgExportCallbackArgs) => void;
  } = {}
): Promise<string | Blob> {
  // Get the specified layer (or first layer by default)
  const layers = stage.getLayers();
  if (layers.length === 0) {
    throw new Error('Stage has no layers');
  }
  
  if (layerIndex < 0 || layerIndex >= layers.length) {
    throw new Error(
      `Layer index ${layerIndex} is out of bounds. Stage has ${layers.length} layer(s).`
    );
  }
  
  const layer = layers[layerIndex]!;

  // Call the 'onBefore' callback function if provided, passing in the stage and layer
  onBefore?.([stage, layer]);

  // Asynchronously sleep for 200 milliseconds
  await sleep(200);

  // Create a new context for rendering the SVG
  const canvasContext = layer.canvas.context as SvgCanvasContextSlot;
  const oldContext = canvasContext._context;
  const c2s = canvasContext._context = new Context({
    height: stage.height(),
    width: stage.width(),
    ctx: oldContext as CanvasRenderingContext2D
  });

  // Draw the stage on the new context
  stage.draw();

  // Get the serialized SVG data
  let out: string | Blob = c2s.getSerializedSvg();

  // If 'blob' is true, create a Blob object with the SVG data and specify the MIME type
  out = blob ? new Blob([out], { type: "image/svg+xml;charset=utf-8" }) : out;

  // Restore the original context
  canvasContext._context = oldContext;

  // Call the 'onAfter' callback function if provided, passing in the stage and layer
  onAfter?.([stage, layer]);

  // Asynchronously sleep for 200 milliseconds
  await sleep(200);

  // Redraw the stage
  stage.draw();

  // Return the SVG data or Blob object
  return out;
}
