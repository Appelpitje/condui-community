import type { FloorPlan, Point2, Wall } from '@/types/schema'
import { computeOpeningDragPlacement, fitOpeningPlacementForPreview,
  type OpeningDragPlacementOptions } from './openingPlacementDrag'

export interface OpeningDragGesture {
  kind: 'door' | 'window'
  wall: Wall
  anchor: Point2
  pointer: Point2
  dragSizingLatched: boolean
}

/** Resolve the active drag against its floor's complete opening configuration. */
export function computeOpeningDragPreview(
  floorPlan: FloorPlan,
  gesture: OpeningDragGesture,
  defaultWidth: number,
  options: OpeningDragPlacementOptions,
) {
  const placement = computeOpeningDragPlacement(gesture.wall, gesture.anchor, gesture.pointer,
    defaultWidth, 6, { ...options, forceDragSizing: gesture.dragSizingLatched })
  const fitted = fitOpeningPlacementForPreview(gesture.wall, placement,
    floorPlan.doors ?? [], floorPlan.windows ?? [])
  return { kind: gesture.kind, wall: gesture.wall, pointer: gesture.pointer, placement, fitted }
}
