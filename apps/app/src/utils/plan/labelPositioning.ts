import type { Endpoint } from '@/types/schema'
import type { QuadrantScores } from '@/utils/planAutoOrient'
import type { WallObstacleRect } from '@/lib/plan/labelWallCollision'
import type {
  WireObstacleBounds,
  WireObstacleIndex,
  WireObstacleRect,
} from '@/lib/plan/labelWireCollision'
import {
  PLAN_SYMBOL_FALLBACK_PX,
  PLAN_LABEL_FONT_SIZE_AT_FALLBACK,
} from '@/constants/planConstants'
import {
  getPlanLabelCandidates, getPlanLabelSymbolBounds,
  type LabelDirection, type LabelPlacement,
} from '@/lib/plan/labelPlacementGeometry'
import type { LabelSolveResume } from '@/lib/plan/labelWallInvalidation'
import { getLabelBoxSize, getPlanLabelClearance } from '@/lib/plan/planLabelMetrics'
import { createLabelCollisionIndex } from '@/lib/plan/labelCollisionIndex'
export { getLabelBoxSize } from '@/lib/plan/planLabelMetrics'

export type { LabelDirection } from '@/lib/plan/labelPlacementGeometry'

const OPPOSITE_DIR: Record<LabelDirection, LabelDirection> = {
  right: 'left',
  left: 'right',
  above: 'below',
  below: 'above',
}

function centerToBox(
  centerX: number,
  centerY: number,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  }
}

function queryWireObstacles(
  obstacles: WireObstacleRect[] | WireObstacleIndex | null,
  bounds: WireObstacleBounds
): WireObstacleRect[] {
  if (!obstacles) return []
  if (Array.isArray(obstacles)) return obstacles
  return obstacles.query(bounds)
}

/**
 * Calculate label positions with collision detection.
 * Rules:
 * 1. No wall scores (no plan image): default to RIGHT, then try others with collision avoidance.
 * 2. Wall scores available: find the quadrant with the MOST opaque pixels (the wall).
 *    Place label on the OPPOSITE side. Still do collision avoidance.
 */
export function calculateLabelPositions(
  placements: LabelPlacement[],
  getEndpointById: (id: string) => Endpoint | null | undefined,
  wallScoresByPlacementId?: Map<string, QuadrantScores> | null,
  baseSymbolSizePx: number = PLAN_SYMBOL_FALLBACK_PX,
  fontFamily: string = 'Figtree',
  /** Vector floor-plan walls (plan space); labels avoid overlapping their painted thickness. */
  wallObstacleRects: WallObstacleRect[] | null = null,
  /** Plan wire routes (plan space); labels prefer not to overlap wires (soft constraint). */
  wireObstacleRects: WireObstacleRect[] | WireObstacleIndex | null = null,
  /** Reuse unchanged labels in greedy order; local wall edits propagate only actual label moves. */
  resume?: LabelSolveResume
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  type LabelBox = { id: string; x: number; y: number; width: number; height: number }
  const labelBoxes = createLabelCollisionIndex<LabelBox>(baseSymbolSizePx * 4)
  const symbolBoxes = createLabelCollisionIndex<WireObstacleBounds>(baseSymbolSizePx * 4)
  const addLabelBox = (box: LabelBox) => labelBoxes.insert(box, {
    left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height,
  })
  const labelFontSize =
    PLAN_LABEL_FONT_SIZE_AT_FALLBACK * (baseSymbolSizePx / PLAN_SYMBOL_FALLBACK_PX)
  const labelGap = getPlanLabelClearance(labelFontSize)
  const labelSpacing = labelFontSize / 3
  const changedLabelBoxes = createLabelCollisionIndex<WireObstacleBounds>(baseSymbolSizePx * 4)
  const recordPosition = (id: string, point: { x: number; y: number }, width: number, height: number) => {
    positions.set(id, point)
    const box = centerToBox(point.x, point.y, width, height)
    addLabelBox({ id, ...box })
    const prior = resume?.positions.get(id)
    if (resume?.wallAffectedIds && (!prior || point.x !== prior.x || point.y !== prior.y)) {
      for (const center of prior ? [prior, point] : [point]) {
        const bounds = {
          left: center.x - width / 2 - labelSpacing - 1e-6, right: center.x + width / 2 + labelSpacing + 1e-6,
          top: center.y - height / 2 - labelSpacing - 1e-6, bottom: center.y + height / 2 + labelSpacing + 1e-6,
        }
        changedLabelBoxes.insert(bounds, bounds)
      }
    }
  }

  const placementInfoById = new Map<
    string,
    {
      endpoint: Endpoint | null | undefined
      bounds: { left: number; right: number; top: number; bottom: number } | null
    }
  >()

  placements.forEach((placement) => {
    const sourceId = placement.endpointId ?? placement.trunkDeviceId
    const endpoint = sourceId ? getEndpointById(sourceId) : null
    if (!placement.pos) {
      placementInfoById.set(placement.id, { endpoint, bounds: null })
      return
    }
    const bounds = getPlanLabelSymbolBounds(placement, endpoint, baseSymbolSizePx)
    placementInfoById.set(placement.id, { endpoint, bounds })
  })

  for (const placement of placements) {
    const bounds = placementInfoById.get(placement.id)?.bounds
    if (bounds) {
      const padded = { left: bounds.left - labelGap, top: bounds.top - labelGap,
        right: bounds.right + labelGap, bottom: bounds.bottom + labelGap }
      symbolBoxes.insert(padded, padded)
    }
  }

  placements.forEach((placement, placementIndex) => {
    const info = placementInfoById.get(placement.id)
    const endpoint = info?.endpoint
    const labelText: string | undefined =
      endpoint?.label ?? placement.junctionPanelLabel ?? placement.planLabel
    if (!labelText || !placement.pos) return
    const { width: labelWidth, height: labelHeight } = getLabelBoxSize(
      labelText,
      labelFontSize,
      fontFamily
    )
    const candidatesByDir = getPlanLabelCandidates(
      placement, endpoint, info?.bounds ?? null, baseSymbolSizePx, labelWidth, labelHeight, labelGap
    )
    const prior = resume?.positions.get(placement.id)
    const touchedByChangedLabel = resume?.wallAffectedIds && Object.values(candidatesByDir).some((points) =>
      points.some((point) => {
        const box = { left: point.x - labelWidth / 2, right: point.x + labelWidth / 2,
          top: point.y - labelHeight / 2, bottom: point.y + labelHeight / 2 }
        return changedLabelBoxes.query(box).some((changed) => box.left < changed.right &&
          box.right > changed.left && box.top < changed.bottom && box.bottom > changed.top)
      })
    )
    const reusable = resume?.wallAffectedIds
      ? !resume.wallAffectedIds.has(placement.id) && !touchedByChangedLabel
      : !!resume && placementIndex < resume.startIndex
    if (prior && reusable) {
      recordPosition(placement.id, prior, labelWidth, labelHeight)
      return
    }
    // Determine preferred direction order
    let dirOrder: LabelDirection[]
    const scores = wallScoresByPlacementId?.get(placement.id)
    const maxScore = scores ? Math.max(scores.top, scores.right, scores.bottom, scores.left) : 0
    // Only use wall scores when there is a real wall (opaque content); in empty/transparent
    // image areas scores can be tiny but non-zero, which would wrongly force labels to one side.
    const minWallScoreForLabel = 0.07
    if (scores && maxScore >= minWallScoreForLabel) {
      // Find the quadrant with the MOST opaque pixels — that's the wall
      const entries: Array<{ dir: LabelDirection; score: number }> = [
        { dir: 'right', score: scores.right },
        { dir: 'left', score: scores.left },
        { dir: 'above', score: scores.top },
        { dir: 'below', score: scores.bottom },
      ]
      entries.sort((a, b) => b.score - a.score)
      const wallDir = entries[0]!.dir
      const awayDir = OPPOSITE_DIR[wallDir]
      // Order: away from wall first, then the two perpendicular, then toward wall last
      const perpendicular = (['right', 'left', 'above', 'below'] as LabelDirection[]).filter(
        (d) => d !== wallDir && d !== awayDir
      )
      dirOrder = [awayDir, ...perpendicular, wallDir]
    } else {
      // No wall data or empty/transparent area: prefer right, then below/above; avoid left until last
      // so two symbols side-by-side don't force the left one's label far left
      dirOrder = ['right', 'below', 'above', 'left']
    }

    // Flatten candidates in preferred order
    const candidatePositions: Array<{ x: number; y: number }> = []
    for (const dir of dirOrder) {
      for (const pos of candidatesByDir[dir]) {
        candidatePositions.push(pos)
      }
    }

    // Prefer a position free of label/symbol/wall overlap; among those, minimize wire overlap.
    let foundPosition = false
    let bestCleanCandidate: { x: number; y: number; wireOverlap: number } | null = null
    let bestCandidate = candidatePositions[0]!
    let minPenalty = Infinity

    for (const candidate of candidatePositions) {
      const boxBase = centerToBox(candidate.x, candidate.y, labelWidth, labelHeight)
      const box = {
        id: placement.id,
        x: boxBase.x,
        y: boxBase.y,
        width: boxBase.width,
        height: boxBase.height,
      }

      let hasCollision = false
      let labelOverlapArea = 0

      const expandedBox = {
          x: box.x - labelSpacing,
          y: box.y - labelSpacing,
          width: box.width + labelSpacing * 2,
          height: box.height + labelSpacing * 2,
        }
      for (const existingBox of labelBoxes.query({ left: expandedBox.x, top: expandedBox.y,
        right: expandedBox.x + expandedBox.width, bottom: expandedBox.y + expandedBox.height })) {
        const overlaps =
          expandedBox.x < existingBox.x + existingBox.width &&
          expandedBox.x + expandedBox.width > existingBox.x &&
          expandedBox.y < existingBox.y + existingBox.height &&
          expandedBox.y + expandedBox.height > existingBox.y

        if (overlaps) {
          hasCollision = true
          const overlapX = Math.max(
            0,
            Math.min(expandedBox.x + expandedBox.width, existingBox.x + existingBox.width) -
              Math.max(expandedBox.x, existingBox.x)
          )
          const overlapY = Math.max(
            0,
            Math.min(expandedBox.y + expandedBox.height, existingBox.y + existingBox.height) -
              Math.max(expandedBox.y, existingBox.y)
          )
          labelOverlapArea += overlapX * overlapY
        }
      }

      let hasSymbolCollision = false
      let symbolOverlapArea = 0
      for (const expandedSymbol of symbolBoxes.query({ left: box.x, top: box.y,
        right: box.x + box.width, bottom: box.y + box.height })) {
        const overlaps =
          box.x < expandedSymbol.right &&
          box.x + box.width > expandedSymbol.left &&
          box.y < expandedSymbol.bottom &&
          box.y + box.height > expandedSymbol.top
        if (overlaps) {
          hasSymbolCollision = true
          const overlapX = Math.max(
            0,
            Math.min(box.x + box.width, expandedSymbol.right) - Math.max(box.x, expandedSymbol.left)
          )
          const overlapY = Math.max(
            0,
            Math.min(box.y + box.height, expandedSymbol.bottom) -
              Math.max(box.y, expandedSymbol.top)
          )
          symbolOverlapArea += overlapX * overlapY
        }
      }

      let hasWallCollision = false
      let wallOverlapArea = 0
      if (wallObstacleRects && wallObstacleRects.length > 0) {
        for (const wr of wallObstacleRects) {
          const overlaps =
            box.x < wr.right &&
            box.x + box.width > wr.left &&
            box.y < wr.bottom &&
            box.y + box.height > wr.top
          if (overlaps) {
            hasWallCollision = true
            const overlapX = Math.max(
              0,
              Math.min(box.x + box.width, wr.right) - Math.max(box.x, wr.left)
            )
            const overlapY = Math.max(
              0,
              Math.min(box.y + box.height, wr.bottom) - Math.max(box.y, wr.top)
            )
            wallOverlapArea += overlapX * overlapY
          }
        }
      }

      let wireOverlapArea = 0
      if (wireObstacleRects) {
        const nearbyWireObstacleRects = queryWireObstacles(wireObstacleRects, {
          left: box.x,
          right: box.x + box.width,
          top: box.y,
          bottom: box.y + box.height,
        })
        for (const wr of nearbyWireObstacleRects) {
          const overlaps =
            box.x < wr.right &&
            box.x + box.width > wr.left &&
            box.y < wr.bottom &&
            box.y + box.height > wr.top
          if (!overlaps) continue
          const overlapX = Math.max(
            0,
            Math.min(box.x + box.width, wr.right) - Math.max(box.x, wr.left)
          )
          const overlapY = Math.max(
            0,
            Math.min(box.y + box.height, wr.bottom) - Math.max(box.y, wr.top)
          )
          wireOverlapArea += overlapX * overlapY
        }
      }

      if (!hasCollision && !hasSymbolCollision && !hasWallCollision) {
        if (!bestCleanCandidate || wireOverlapArea < bestCleanCandidate.wireOverlap) {
          bestCleanCandidate = {
            x: candidate.x,
            y: candidate.y,
            wireOverlap: wireOverlapArea,
          }
        }
        continue
      }

      // Symbol/wall overlap is hard; wire overlap is soft (acceptable fallback).
      const hardPenalty =
        (hasSymbolCollision ? symbolOverlapArea * 10_000 + 1_000_000 : 0) +
        (hasWallCollision ? wallOverlapArea * 10_000 + 1_000_000 : 0)
      const penalty = labelOverlapArea + hardPenalty + wireOverlapArea * 80

      if (penalty < minPenalty) {
        minPenalty = penalty
        bestCandidate = candidate
      }
    }

    if (bestCleanCandidate) {
      recordPosition(placement.id, { x: bestCleanCandidate.x, y: bestCleanCandidate.y }, labelWidth, labelHeight)
      foundPosition = true
    }

    if (!foundPosition) {
      recordPosition(placement.id, { x: bestCandidate.x, y: bestCandidate.y }, labelWidth, labelHeight)
    }
  })

  return positions
}
