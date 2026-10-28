import type { WireSegment } from '@/types/schema'

/**
 * Route decorations belong to the first physical run above a protection.
 * A circuit trunk may continue past that run to higher branches, while
 * `wireLabelEndPoint` records the first branch boundary for the run.
 */
export function getVerticalRouteIndicatorEndY(wireSegment: WireSegment): number {
  const fallbackEndY = wireSegment.endPoint.y
  const boundaryY = wireSegment.wireLabelEndPoint?.y
  if (boundaryY === undefined || !Number.isFinite(boundaryY)) return fallbackEndY

  const minY = Math.min(wireSegment.startPoint.y, fallbackEndY)
  const maxY = Math.max(wireSegment.startPoint.y, fallbackEndY)
  return boundaryY >= minY && boundaryY <= maxY ? boundaryY : fallbackEndY
}

/** Default distance of the wall-route symbols from the decorated run's ends. */
export const WALL_ROUTE_SYMBOL_MARGIN = 10

/**
 * Offsets of the two wall-route symbols from the route group origin (10 above the wire start),
 * kept inside the decorated physical run even on short segments. `idealMargin` is their
 * distance from the run ends; conductor marks on a cramped run pull them closer.
 */
export function getVerticalWallRouteSymbolOffsets(
  routeIndicatorDeltaY: number,
  idealMargin = WALL_ROUTE_SYMBOL_MARGIN
): [number, number] {
  const segmentLength = Math.abs(routeIndicatorDeltaY)
  const minMargin = 3
  const marginFromEnds = Math.max(minMargin, Math.min(idealMargin, segmentLength / 2 - minMargin))
  const direction = routeIndicatorDeltaY < 0 ? -1 : 1
  return [
    10 + direction * marginFromEnds,
    10 + routeIndicatorDeltaY - direction * marginFromEnds,
  ]
}
