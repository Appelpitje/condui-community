import type { Endpoint, Point2, Wall } from '@/types/schema'
import { PLAN_LABEL_FONT_SIZE_AT_FALLBACK, PLAN_SYMBOL_FALLBACK_PX } from '@/constants/planConstants'
import { getLabelBoxSize, getPlanLabelClearance } from './planLabelMetrics'
import { buildWallObstacleRects } from './labelWallCollision'
import { getPlanLabelCandidates, getPlanLabelSymbolBounds, type LabelPlacement } from './labelPlacementGeometry'

export type LabelWallSnapshot = { walls: Wall[]; masterWallThickness: number; pxPerMeter: number | null }

/**
 * Start a local greedy refresh from every candidate touched by BOTH old and new
 * wall geometry. The solver propagates actual label moves to later collision neighbours.
 */
export function wallAffectedLabelIds(
  previous: LabelWallSnapshot,
  next: LabelWallSnapshot,
  placements: LabelPlacement[],
  getEndpointById: (id: string) => Endpoint | null | undefined,
  baseSymbolSizePx: number,
  fontFamily: string
): Set<string> | null {
  if (previous.masterWallThickness !== next.masterWallThickness || previous.pxPerMeter !== next.pxPerMeter)
    return null
  const oldById = new Map(previous.walls.map((wall) => [wall.id, wall]))
  if (oldById.size !== previous.walls.length || new Set(next.walls.map((wall) => wall.id)).size !== next.walls.length)
    return null
  const changedOld: Wall[] = [], changedNew: Wall[] = []
  for (const wall of next.walls) {
    const old = oldById.get(wall.id)
    oldById.delete(wall.id)
    if (old === wall) continue
    if (old && JSON.stringify(old) === JSON.stringify(wall)) continue
    if (old) changedOld.push(old)
    changedNew.push(wall)
  }
  changedOld.push(...oldById.values())
  const changedRects = [
    ...buildWallObstacleRects(changedOld, previous.masterWallThickness, previous.pxPerMeter),
    ...buildWallObstacleRects(changedNew, next.masterWallThickness, next.pxPerMeter),
  ]
  const affected = new Set<string>()
  if (!changedRects.length) return affected
  const fontSize = PLAN_LABEL_FONT_SIZE_AT_FALLBACK * (baseSymbolSizePx / PLAN_SYMBOL_FALLBACK_PX)
  const labelGap = getPlanLabelClearance(fontSize)
  for (let index = 0; index < placements.length; index++) {
    const placement = placements[index]!
    if (!placement.pos) continue
    const endpoint = placement.endpointId ? getEndpointById(placement.endpointId) : null
    const text = endpoint?.label ?? placement.junctionPanelLabel ?? placement.planLabel
    if (!text) continue
    const { width, height } = getLabelBoxSize(text, fontSize, fontFamily)
    const bounds = getPlanLabelSymbolBounds(placement, endpoint, baseSymbolSizePx)
    const candidates = Object.values(getPlanLabelCandidates(
      placement, endpoint, bounds, baseSymbolSizePx, width, height, labelGap
    )).flat()
    for (const point of candidates) {
      // Broad-phase padding avoids losing a candidate to equivalent floating-point
      // box arithmetic; the solver retains the original exact overlap predicates.
      if (changedRects.some((rect) => point.x - width / 2 - 1e-6 <= rect.right &&
        point.x + width / 2 + 1e-6 >= rect.left && point.y - height / 2 - 1e-6 <= rect.bottom &&
        point.y + height / 2 + 1e-6 >= rect.top)) {
        affected.add(placement.id)
        break
      }
    }
  }
  return affected
}

export function firstWallAffectedLabelIndex(
  previous: LabelWallSnapshot, next: LabelWallSnapshot, placements: LabelPlacement[],
  getEndpointById: (id: string) => Endpoint | null | undefined,
  baseSymbolSizePx: number, fontFamily: string
): number {
  const ids = wallAffectedLabelIds(previous, next, placements, getEndpointById, baseSymbolSizePx, fontFamily)
  if (!ids) return 0
  const index = placements.findIndex((placement) => ids.has(placement.id))
  return index < 0 ? placements.length : index
}

export type LabelSolveResume = {
  startIndex: number
  positions: ReadonlyMap<string, Point2>
  /** Wall-only edits may reuse later labels too, unless changed earlier labels reach their candidates. */
  wallAffectedIds?: ReadonlySet<string>
}
