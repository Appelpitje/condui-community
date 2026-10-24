import {
  WIRE_LABEL_DISTANCE_FROM_WIRE,
  WIRE_LABEL_FONT_SIZE,
} from '@/lib/wireTextLabel'

/** Extra gap past the outer edge of the vertical wire-property label. */
const ENDPOINT_NOTE_WIRE_LABEL_GAP = 2

/**
 * Clear the branch trunk stroke and the vertical wire-property label beside it
 * (anchor at distanceFromWire, ±fontSize/2 after −90° rotation).
 */
export const ENDPOINT_NOTE_WIRE_CLEARANCE =
  WIRE_LABEL_DISTANCE_FROM_WIRE + WIRE_LABEL_FONT_SIZE / 2 + ENDPOINT_NOTE_WIRE_LABEL_GAP

/** Minimum label-left X relative to an endpoint, keeping the note clear of the trunk wire label. */
export function getEndpointNoteMinimumLeftX(endpointX: number, branchWireX: number): number {
  return branchWireX - endpointX + ENDPOINT_NOTE_WIRE_CLEARANCE
}

/**
 * Keep a short label centered, but shift a wide label right when its left edge
 * would cross the branch-wire clearance boundary.
 */
export function getCollisionSafeCenteredLabelLeftX(
  labelWidth: number,
  minimumLeftX?: number,
): number {
  const centeredLeftX = -labelWidth / 2
  return minimumLeftX == null ? centeredLeftX : Math.max(centeredLeftX, minimumLeftX)
}

/** Available rendered width before a shifted label reaches its right boundary. */
export function getCollisionSafeLabelWidth(
  labelWidth: number,
  leftX: number,
  maximumRightX?: number,
): number {
  return maximumRightX == null
    ? labelWidth
    : Math.max(0, Math.min(labelWidth, maximumRightX - leftX))
}
