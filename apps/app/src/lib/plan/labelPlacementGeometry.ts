import type { Endpoint, Placement, Point2 } from '@/types/schema'
import { getPlacementWorldBounds } from '@/utils/plan/placementBounds'

export type LabelDirection = 'right' | 'left' | 'below' | 'above'
export type LabelPlacement = Placement & {
  endpointId?: string
  junctionPanelLabel?: string
  planLabel?: string
}
export type LabelSymbolBounds = { left: number; right: number; top: number; bottom: number }

export function getPlanLabelSymbolBounds(
  placement: LabelPlacement, endpoint: Endpoint | null | undefined, baseSymbolSizePx: number
): LabelSymbolBounds | null {
  if (!placement.pos) return null
  const socketCount =
    endpoint && endpoint.socketProps && typeof endpoint.socketProps.socketCount === 'number'
      ? endpoint.socketProps.socketCount : 1
  const symbolType = endpoint?.symbol ??
    (placement.junctionPanelLabel != null ? 'junction_panel' :
      placement.planLabel != null ? 'panel_distribution' : undefined)
  return getPlacementWorldBounds(
    placement.pos, placement.rotationDeg ?? 0, placement.scale, socketCount, symbolType,
    baseSymbolSizePx
  )
}

/** All finite candidates considered by the label solver, in its existing direction order. */
export function getPlanLabelCandidates(
  placement: LabelPlacement,
  endpoint: Endpoint | null | undefined,
  bounds: LabelSymbolBounds | null,
  baseSymbolSizePx: number,
  labelWidth: number,
  labelHeight: number,
  labelGap: number
): Record<LabelDirection, Point2[]> {
  const cx = placement.pos.x, cy = placement.pos.y
  const halfLabelWidth = labelWidth / 2, halfLabelHeight = labelHeight / 2
  const isPanelLike = endpoint?.symbol === 'panel_distribution' ||
    placement.junctionPanelLabel != null || placement.planLabel != null
  const extentRight = bounds ? bounds.right - cx : (baseSymbolSizePx * placement.scale) / 2
  const extentLeft = bounds ? cx - bounds.left : (baseSymbolSizePx * placement.scale) / 2
  const extentTop = bounds ? cy - bounds.top : (baseSymbolSizePx * placement.scale) / 2
  const extentBottom = bounds ? bounds.bottom - cy : (baseSymbolSizePx * placement.scale) / 2
  const avgHorizontalExtent = (extentLeft + extentRight) / 2
  const avgVerticalExtent = (extentTop + extentBottom) / 2
  const panelHorizontalAspectBoost = isPanelLike
    ? Math.max(0, (avgHorizontalExtent - avgVerticalExtent) * 0.9) : 0
  const panelExtraGapX = isPanelLike ? 12 + panelHorizontalAspectBoost : 0
  const panelExtraGapY = isPanelLike ? 6 : 0
  const offsetRight = extentRight + labelGap + panelExtraGapX + halfLabelWidth
  const offsetLeft = extentLeft + labelGap + panelExtraGapX + halfLabelWidth
  const offsetAbove = extentTop + labelGap + panelExtraGapY + halfLabelHeight
  const offsetBelow = extentBottom + labelGap + panelExtraGapY + halfLabelHeight
  return {
    right: [
      { x: cx + offsetRight, y: cy },
      { x: cx + offsetRight, y: cy - halfLabelHeight },
      { x: cx + offsetRight, y: cy + halfLabelHeight },
    ],
    left: [
      { x: cx - offsetLeft, y: cy },
      { x: cx - offsetLeft, y: cy - halfLabelHeight },
      { x: cx - offsetLeft, y: cy + halfLabelHeight },
    ],
    below: [
      { x: cx, y: cy + offsetBelow },
      { x: cx - halfLabelWidth, y: cy + offsetBelow },
      { x: cx + halfLabelWidth, y: cy + offsetBelow },
    ],
    above: [
      { x: cx, y: cy - offsetAbove },
      { x: cx - halfLabelWidth, y: cy - offsetAbove },
      { x: cx + halfLabelWidth, y: cy - offsetAbove },
    ],
  }
}
