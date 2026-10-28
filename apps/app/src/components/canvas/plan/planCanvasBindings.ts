import type { KonvaEventObject } from 'konva/lib/Node'
import { liveProjectSession } from '@/stores/liveProjectCommandSession'
import { CommandError, type CommandInvocation } from '@/lib/commands/project'
import type { Point, Selection } from '@/types/ui'
import { type QuickPlacerItem } from '@/lib/plan/quickPlacer'
import { type ClientPoint } from '@/lib/plan/crossFloorDragContinuation'

export const PLAN_IMAGE_ROTATION_SNAPS = [0, 45, 90, 135, 180, 225, 270, 315]

export function executePlanGeometryBatch(invocations: CommandInvocation[], label: string): boolean {
  try {
    return liveProjectSession.execute(invocations, { label, source: 'plan-canvas-geometry' })
      .changed
  } catch (error) {
    if (error instanceof CommandError) return false
    throw error
  }
}

export type PlanCanvasInputEvent = KonvaEventObject<
  MouseEvent | TouchEvent | PointerEvent | DragEvent
>

export type CrossFloorDragSession = {
  floorId: string
  clientOffsets: Map<string, ClientPoint>
  lastPositions: Map<string, Point>
}

export const QUICK_PLACER_FLOOR_KEYS = '123456789'

export const EMPTY_WALL_SELECTION_IDS: string[] = []

export const EMPTY_PLAN_OVERLAY_FLOOR_IDS: string[] = []

export const EMPTY_POINT_SELECTION = new Map<string, number[]>()

export type ContentBounds = { minX: number; minY: number; maxX: number; maxY: number }

export function includePointInBounds(
  bounds: ContentBounds | null,
  x: number,
  y: number
): ContentBounds {
  if (!bounds) return { minX: x, minY: y, maxX: x, maxY: y }
  return {
    minX: Math.min(bounds.minX, x),
    minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x),
    maxY: Math.max(bounds.maxY, y),
  }
}

export function includeRectInBounds(
  bounds: ContentBounds | null,
  rect: { left: number; top: number; right: number; bottom: number }
): ContentBounds {
  let next = includePointInBounds(bounds, rect.left, rect.top)
  next = includePointInBounds(next, rect.right, rect.bottom)
  return next
}

export function findQuickPlacerStartIndexForSelection(
  sequence: QuickPlacerItem[],
  selection: Selection
): number {
  if (sequence.length === 0) return -1
  if (
    selection.type !== 'placement' &&
    selection.type !== 'endpoint' &&
    selection.type !== 'trunkDevice'
  )
    return -1

  const selectedIds = new Set(selection.ids)
  return sequence.findIndex((item) =>
    selection.type === 'placement'
      ? selectedIds.has(item.placement.id)
      : selection.type === 'trunkDevice'
        ? item.trunkDeviceId != null && selectedIds.has(item.trunkDeviceId)
        : selectedIds.has(item.endpoint.id)
  )
}
