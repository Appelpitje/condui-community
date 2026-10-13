import type { Point } from '@/types/ui'
import {
  SYMBOL_SIZE,
  MULTI_SOCKET_OFFSET,
  PANEL_SYMBOL_WIDTH,
  PANEL_SYMBOL_HEIGHT,
  PLAN_PANEL_VISUAL_SCALE,
} from '@/lib/canvas/symbolGeometry'

/**
 * Compute world-space axis-aligned bounding box for a placement,
 * accounting for scale, rotation, and multi-socket extra width
 */
export function getPlacementWorldBounds(
  pos: Point,
  rotationDeg: number,
  scale: number,
  socketCount: number,
  symbolType: string | undefined,
  baseSymbolSizePx: number
): { left: number; right: number; top: number; bottom: number } {
  const symbolSize = baseSymbolSizePx * scale
  
  // Panel-like symbols (regular panels + junction panels) share visual sizing on the plan canvas.
  const isPanelLike = symbolType === 'panel_distribution' || symbolType === 'junction_panel'
  const panelScaleFactor = PANEL_SYMBOL_HEIGHT / SYMBOL_SIZE
  const symbolHeight = isPanelLike
    ? (baseSymbolSizePx * panelScaleFactor * PLAN_PANEL_VISUAL_SCALE * scale)
    : symbolSize
  const panelAspectRatio = PANEL_SYMBOL_WIDTH / PANEL_SYMBOL_HEIGHT
  const symbolWidth = isPanelLike ? symbolHeight * panelAspectRatio : symbolSize
  
  const halfWidth = symbolWidth / 2
  const halfHeight = symbolHeight / 2
  const socketOffset = MULTI_SOCKET_OFFSET * (symbolSize / SYMBOL_SIZE)
  const socketExtraWidth = Math.max(0, socketCount - 1) * socketOffset

  // Local-space corners (symbol centered at origin, sockets extend in +X)
  const localCorners = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth + socketExtraWidth, y: -halfHeight },
    { x: halfWidth + socketExtraWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]

  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const c of localCorners) {
    const wx = c.x * cos - c.y * sin + pos.x
    const wy = c.x * sin + c.y * cos + pos.y
    minX = Math.min(minX, wx)
    minY = Math.min(minY, wy)
    maxX = Math.max(maxX, wx)
    maxY = Math.max(maxY, wy)
  }

  return { left: minX, right: maxX, top: minY, bottom: maxY }
}
