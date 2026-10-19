import type { DropZoneHint } from './collectDropZoneHints'

function destinationKey(hint: DropZoneHint): string {
  const match = hint.match
  // A circuit id alone does not identify a slot: separate branches can share it.
  const hasConcreteSlot = match && [
    match.endpointId, match.protectionId, match.mainBusInsertIndex,
    match.secondaryBusInsertIndex, match.circuitTrunkSegmentIndex,
    match.branchDeviceInsertIndex, match.supplyDeviceInsertIndex,
    match.supplyConverterDcConnectionIndex,
  ].some((value) => value !== undefined)
  return hasConcreteSlot
    ? JSON.stringify(Object.entries(match).filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)))
    : hint.nodeId
}

/**
 * Merge nearby circles only when they describe the same destination. Distinct actions
 * (continuing a branch, inserting on its wire, multiplying a symbol) stay discoverable,
 * including beside the active preview and when zoomed out.
 */
export function declutterDropZoneHints(
  hints: DropZoneHint[],
  activeHint: DropZoneHint | null,
  minDistance: number
): DropZoneHint[] {
  const minDistanceSquared = minDistance * minDistance
  const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < minDistanceSquared
  const destinations = new Map<DropZoneHint, string>()
  const destination = (hint: DropZoneHint) => {
    if (!destinations.has(hint)) destinations.set(hint, destinationKey(hint))
    return destinations.get(hint)
  }
  const duplicates = (a: DropZoneHint, b: DropZoneHint) =>
    !a.outline && !b.outline && a.targetType === b.targetType &&
    overlaps(a, b) && destination(a) === destination(b)

  const kept: DropZoneHint[] = []
  for (const hint of hints) {
    if (hint.outline) {
      kept.push(hint)
      continue
    }
    if (activeHint && hint.nodeId !== activeHint.nodeId && duplicates(hint, activeHint)) continue
    if (kept.some((other) => duplicates(hint, other))) continue
    kept.push(hint)
  }
  return kept
}

/** The prototype reveals zones fully inside 90 units; keep that immediate reveal in screen pixels. */
export const DROP_ZONE_HINT_NEAR_PX = 90
/** Screen distance (px) beyond which a hint stays at its faint resting state. */
export const DROP_ZONE_HINT_FAR_PX = 110

/** A short spatial edge softens the prototype's hard cutoff without delaying the reveal. */
export function getDropZoneHintProximityForDistance(distancePx: number): number {
  if (!Number.isFinite(distancePx)) return 0
  const linear = Math.max(
    0,
    Math.min(1, (DROP_ZONE_HINT_FAR_PX - distancePx) / (DROP_ZONE_HINT_FAR_PX - DROP_ZONE_HINT_NEAR_PX))
  )
  return linear * linear * (3 - 2 * linear)
}

/**
 * 0 (far, faint) to 1 (near, full) for a hint relative to the pointer, measured in screen
 * pixels so the reveal feels the same at every zoom level. Fully shown throughout the
 * nearby neighbourhood; only its narrow outer edge fades.
 */
export function getDropZoneHintProximity(
  hint: { x: number; y: number },
  pointer: { x: number; y: number } | null,
  zoom: number
): number {
  if (!pointer || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return 0
  const distancePx = Math.hypot(hint.x - pointer.x, hint.y - pointer.y) * zoom
  return getDropZoneHintProximityForDistance(distancePx)
}

/**
 * Scale factor that keeps a canvas-sized mark at least `minScreenPx` on screen. Zoomed in, marks
 * scale with the diagram (factor 1); zoomed out, they stop shrinking at the minimum.
 */
export function getMinimumScreenSizeScale(
  canvasSize: number,
  zoom: number,
  minScreenPx: number
): number {
  if (!(zoom > 0) || !(canvasSize > 0)) return 1
  return Math.max(1, minScreenPx / (canvasSize * zoom))
}
