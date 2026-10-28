import { useMemo, useState } from 'react'
import { useProjectStore } from '@/stores/projectStore'
import { usePlanDragVisualStore } from '@/stores/planDragVisualStore'
import {
  getSettledLabelKey,
  getPlanLabelSamplingImageKey,
  settledLabelPositionsCache,
  type PlanLabelSamplingState,
  type SettledLabelInputs,
  type SettledLabelKey,
} from '@/lib/plan/settledLabelPositionsCache'
import { wallAffectedLabelIds, type LabelSolveResume } from '@/lib/plan/labelWallInvalidation'
import { buildWallObstacleRects } from '@/lib/plan/labelWallCollision'
import { buildPlanWireObstacleRects, buildWireObstacleIndex } from '@/lib/plan/labelWireCollision'
import { getQuadrantWallScores, type QuadrantScores } from '@/utils/planAutoOrient'
import { calculateLabelPositions } from '@/utils/plan/labelPositioning'
import { useCanvasFontFamily } from '@/editions/community/communityHooks'
import type { Endpoint, Placement, PlanWireRoute, PlanWireRouteStyle, Point2, Wall } from '@/types/schema'
import { PLAN_LABEL_IMAGE_SCORE_MAX_RECOMPUTES_PER_PASS } from '@/constants/canvasConstants'

export type PlanLabelWallCollisionInput = {
  walls: Wall[]
  masterWallThickness: number
  pxPerMeter: number | null
}

export type PlanLabelWireCollisionInput = {
  routes: PlanWireRoute[]
  routeStyle: PlanWireRouteStyle
  placementPositionOverrides?: Map<string, Point2>
}

/** Trunk symbols share the endpoint label solver without becoming persisted endpoints. */
function getPlanLabelSourceById(id: string): Endpoint | null {
  const state = useProjectStore.getState()
  const endpoint = state.getEndpointById(id)
  if (endpoint) return endpoint
  const device = state.getTrunkDeviceById(id)?.device
  return device
    ? {
        id: device.id,
        type: device.type === 'switch' ? 'switch' : 'fixed_appliance',
        label: device.label,
        symbol: device.symbol,
        placements: [],
      }
    : null
}

function reuseLabelPositions(
  previous: Map<string, { x: number; y: number }>,
  next: Map<string, { x: number; y: number }>
): Map<string, { x: number; y: number }> {
  let allSame = previous.size === next.size
  const stable = new Map<string, { x: number; y: number }>()
  for (const [id, position] of next) {
    const prior = previous.get(id)
    const value = prior && prior.x === position.x && prior.y === position.y ? prior : position
    stable.set(id, value)
    if (value !== prior) allSame = false
  }
  return allSame ? previous : stable
}

type PlanLabelSolveInputs = Omit<SettledLabelInputs, 'hasLiveDrag' | 'getEndpointById'> & {
  getEndpointById: ReturnType<typeof useProjectStore.getState>['getEndpointById']
  labelContext: string
  deferRecalculation: boolean
}

type PlanLabelSolveState = {
  inputs: PlanLabelSolveInputs | null
  labelContext: string
  sampling: PlanLabelSamplingState
  positions: Map<string, Point2>
  previousSolve: { key: SettledLabelKey | null; walls: PlanLabelWallCollisionInput | null } | null
}

function emptyLabelSolveState(labelContext: string): PlanLabelSolveState {
  return { inputs: null, labelContext, positions: new Map(), previousSolve: null,
    sampling: { lastImageKey: '', lastPlacementGeomById: new Map(), wallScoresByPlacementId: new Map() } }
}

/** Each solve owns its sampling writes; earlier completed renders remain intact. */
function solvePlanLabels(inputs: PlanLabelSolveInputs, prior: PlanLabelSolveState): PlanLabelSolveState {
  const previousState = prior.labelContext === inputs.labelContext ? prior : emptyLabelSolveState(inputs.labelContext)
  // Dimmed electrical content keeps completed positions during drawing; cold mounts do no solve.
  if (inputs.deferRecalculation) return { ...previousState, inputs }
  const { electrical, getEndpointById, placements, image: planImage,
    imagePosition: planImagePosition, baseSymbolSizePx, labelRecalcKey, fontFamily,
    enableImageWallSampling, walls: wallCollision, wires: wireCollision, allowSettledCache } = inputs
  const drag = usePlanDragVisualStore.getState()
  const settledInputs: SettledLabelInputs = {
    electrical,
    getEndpointById,
    placements,
    image: planImage,
    imagePosition: planImagePosition,
    baseSymbolSizePx,
    labelRecalcKey,
    fontFamily,
    enableImageWallSampling,
    walls: wallCollision,
    wires: wireCollision,
    hasLiveDrag: drag.positions.size > 0 || drag.rotations.size > 0 || drag.labels.size > 0,
    allowSettledCache,
  }
  const settledKey = getSettledLabelKey(settledInputs)
  const geometryKey = settledKey ? getSettledLabelKey({ ...settledInputs, walls: null }) : null
  const settled = settledLabelPositionsCache.read(settledKey)
  if (settled) {
    return {
      ...previousState, inputs, sampling: settled.sampling,
      positions: reuseLabelPositions(previousState.positions, settled.positions),
      previousSolve: { key: geometryKey, walls: wallCollision },
    }
  }
  let resume: LabelSolveResume | undefined
  const previous = previousState.previousSolve
  if (previous?.key && geometryKey && previous.walls && wallCollision &&
    previous.key.electrical === geometryKey.electrical &&
    previous.key.getEndpointById === geometryKey.getEndpointById &&
    previous.key.fingerprint === geometryKey.fingerprint) {
    const affected = wallAffectedLabelIds(
      previous.walls, wallCollision, placements, getPlanLabelSourceById, baseSymbolSizePx, fontFamily
    )
    if (affected) resume = {
      startIndex: 0, wallAffectedIds: affected, positions: previousState.positions,
    }
    if (affected?.size === 0) {
      settledLabelPositionsCache.save(settledKey, previousState.positions, previousState.sampling)
      return { ...previousState, inputs,
        previousSolve: { key: geometryKey, walls: wallCollision } }
    }
  }
  const sampling: PlanLabelSamplingState = {
    lastImageKey: previousState.sampling.lastImageKey,
    lastPlacementGeomById: new Map(previousState.sampling.lastPlacementGeomById),
    wallScoresByPlacementId: new Map([...previousState.sampling.wallScoresByPlacementId]
      .map(([id, scores]) => [id, { ...scores }])),
  }
  const wallObstacleRects =
    wallCollision && wallCollision.walls.length > 0
      ? buildWallObstacleRects(
          wallCollision.walls,
          wallCollision.masterWallThickness,
          wallCollision.pxPerMeter
        )
      : null
  const wireObstacleIndex =
    wireCollision && wireCollision.routes.length > 0
      ? buildWireObstacleIndex(
          buildPlanWireObstacleRects(
            wireCollision.routes,
            getEndpointById,
            wireCollision.placementPositionOverrides,
            2,
            wireCollision.routeStyle,
            wallCollision?.pxPerMeter
          )
        )
      : null
  let wallScoresByPlacementId: Map<string, QuadrantScores> | null = null
  if (enableImageWallSampling && planImage && planImagePosition) {
    // Cache and filter quadrant scoring aggressively: only recompute for moved placements
    // and placements near moved ones. Recompute all only when plan image or imagePosition changes.
    const imageKey = getPlanLabelSamplingImageKey(planImage, planImagePosition, baseSymbolSizePx)
    const imageChanged = sampling.lastImageKey !== imageKey
    // Placements beyond the sampling budget must fall back to geometry, rather
    // than retaining wall evidence from a different image/calibration.
    if (imageChanged) sampling.wallScoresByPlacementId.clear()
    sampling.lastImageKey = imageKey

    // Detect moved placements by geometry change.
    const movedIds: string[] = []
    const movedPts: Array<{ id: string; x: number; y: number }> = []
    const nextGeomById = new Map<string, string>()

    for (const placement of placements) {
      if (!placement.pos) continue
      const geom = `${placement.pos.x},${placement.pos.y},${placement.rotationDeg ?? 0},${placement.scale}`
      nextGeomById.set(placement.id, geom)
      const prev = sampling.lastPlacementGeomById.get(placement.id)
      if (!prev || prev !== geom) {
        movedIds.push(placement.id)
        movedPts.push({ id: placement.id, x: placement.pos.x, y: placement.pos.y })
      }
    }

    // Drop cache entries for removed placements.
    if (sampling.lastPlacementGeomById.size > 0) {
      for (const id of sampling.lastPlacementGeomById.keys()) {
        if (!nextGeomById.has(id)) sampling.wallScoresByPlacementId.delete(id)
      }
    }
    sampling.lastPlacementGeomById = nextGeomById

    // Neighbor radius: only nearby placements can have their best label side change
    // due to local collisions / proximity to the moved symbol.
    const neighborRadius = baseSymbolSizePx * 8
    const neighborRadiusSq = neighborRadius * neighborRadius

    const shouldRecompute = (placement: Placement) => {
      if (imageChanged) return true
      if (!placement.pos) return false
      if (movedIds.includes(placement.id)) return true
      if (movedPts.length === 0) return false
      const px = placement.pos.x
      const py = placement.pos.y
      for (const mp of movedPts) {
        const dx = px - mp.x
        const dy = py - mp.y
        if (dx * dx + dy * dy <= neighborRadiusSq) return true
      }
      return false
    }

    wallScoresByPlacementId = sampling.wallScoresByPlacementId

    // Only do expensive image sampling for a small subset.
    let recomputeCount = 0
    for (const placement of placements) {
      if (!placement.pos) continue
      if (!shouldRecompute(placement)) continue
      if (recomputeCount >= PLAN_LABEL_IMAGE_SCORE_MAX_RECOMPUTES_PER_PASS) continue
      const scores = getQuadrantWallScores(
        placement,
        {
          image: planImage,
          imagePosition: planImagePosition,
        },
        baseSymbolSizePx
      )
      recomputeCount++
      if (scores) wallScoresByPlacementId.set(placement.id, scores)
      else wallScoresByPlacementId.delete(placement.id)
    }
  }
  const nextLabelPositions = calculateLabelPositions(
    placements,
    getPlanLabelSourceById,
    wallScoresByPlacementId,
    baseSymbolSizePx,
    fontFamily,
    wallObstacleRects,
    wireObstacleIndex,
    resume
  )
  const stableLabelPositions = reuseLabelPositions(
    previousState.positions,
    nextLabelPositions
  )
  settledLabelPositionsCache.save(settledKey, stableLabelPositions, sampling)
  return { ...previousState, inputs, sampling, positions: stableLabelPositions,
    previousSolve: { key: geometryKey, walls: wallCollision } }
}

/**
 * Hook to calculate label positions with collision detection
 */
export function usePlanLabelPositions(
  placements: Array<Placement & { endpointId?: string; trunkDeviceId?: string; junctionPanelLabel?: string }>,
  planImage: HTMLImageElement | null,
  planImagePosition: { x: number; y: number },
  baseSymbolSizePx: number,
  labelRecalcKey: number,
  enableImageWallSampling = true,
  wallCollision: PlanLabelWallCollisionInput | null = null,
  wireCollision: PlanLabelWireCollisionInput | null = null,
  allowSettledCache = true,
  deferRecalculation = false,
  contextKey?: string
): Map<string, { x: number; y: number }> {
  const getEndpointById = useProjectStore(
    (s: ReturnType<typeof useProjectStore.getState>) => s.getEndpointById
  )
  const fontFamily = useCanvasFontFamily()
  const electrical = useProjectStore((state) => state.currentProject?.disciplines.electrical)
  const projectId = useProjectStore((state) => state.currentProject?.project.id)
  const labelContext = contextKey ?? `${projectId ?? ''}:${[...new Set(placements.map((row) => row.floorId))].join(',')}`

  const inputs = useMemo<PlanLabelSolveInputs>(() => ({
    placements, getEndpointById, labelRecalcKey, image: planImage, imagePosition: planImagePosition,
    baseSymbolSizePx, fontFamily, enableImageWallSampling, walls: wallCollision, wires: wireCollision,
    electrical, allowSettledCache, deferRecalculation, labelContext,
  }), [
    placements,
    getEndpointById,
    labelRecalcKey,
    planImage,
    planImagePosition,
    baseSymbolSizePx,
    fontFamily,
    enableImageWallSampling,
    wallCollision,
    wireCollision,
    electrical,
    allowSettledCache,
    deferRecalculation,
    labelContext,
  ])
  const [solve, setSolve] = useState(() => emptyLabelSolveState(labelContext))
  if (solve.inputs !== inputs) setSolve(solvePlanLabels(inputs, solve))
  return solve.positions
}
