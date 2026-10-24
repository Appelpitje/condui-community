/**
 * Alt-drag duplicate on the situation plan: new endpoint with source properties,
 * placement at drop position, and sitplan orphan guard.
 */

import {
  duplicateEndpointOnCircuit,
  endpointSymbolCanBeDuplicated,
} from '@/lib/eendraad/duplicateEndpoint'
import { ensureSitplanPlacementsForEndpoints } from '@/lib/eendraad/duplicateSitplanHelpers'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'
import {
  createSyncSupplyInverterMultiplierDeps,
  syncSupplyDeviceMultiplierCount,
} from '@/lib/eendraad/syncSupplyInverterMultiplier'
import {
  getSupplyDeviceMultiplier,
  supportsSupplyDeviceMultiplier,
} from '@/lib/supplyAssembly/inverterMultipliers'
import type { Endpoint, Placement, TrunkDevice } from '@/types/schema'
import type { Point } from '@/types/ui'
import { generateId } from '@/utils'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { getEndpointPlanWallFacingSide } from './planWallOrientation'

/** Initial nudge so the copy is visible while dragging; pointer updates position live. */
export const PLAN_ALT_DRAG_COPY_OFFSET = { x: 24, y: 24 } as const

export type PlanAltDuplicateSource = {
  endpoint?: Endpoint | null
  trunkDevice?: TrunkDevice | null
}

/** Whether this plan symbol has a duplication strategy. */
export function canPlanAltDuplicate(source: PlanAltDuplicateSource): boolean {
  if (source.trunkDevice) return supportsSupplyDeviceMultiplier(source.trunkDevice)
  if (!source.endpoint) return false
  return endpointSupportsMultiplier(source.endpoint) || endpointSymbolCanBeDuplicated(source.endpoint)
}

/**
 * Create the placement that the shared Alt-drag handoff will move.  Every
 * eligible symbol uses this one entry point; only its domain creation rule
 * differs (another occurrence versus another physical endpoint).
 */
export function createPlanAltDuplicatePlacement(
  source: PlanAltDuplicateSource,
  refPlacement: Placement,
): string | null {
  const trunkDevice = source.trunkDevice
  if (trunkDevice && supportsSupplyDeviceMultiplier(trunkDevice)) {
    const store = useProjectStore.getState()
    const incremented = store.withSingleUndoEntry(
      () =>
        syncSupplyDeviceMultiplierCount(
          createSyncSupplyInverterMultiplierDeps(),
          trunkDevice.id,
          getSupplyDeviceMultiplier(trunkDevice) + 1,
          { placement: refPlacement }
        ),
      { sessionLabel: 'add supply device multiplier via alt-drag' }
    )
    if (!incremented) return null
    const placementId = store.getTrunkDeviceById(trunkDevice.id)?.device.placements?.at(-1)?.id
    if (!placementId) return null
    useUIStore.getState().setSelection({ type: 'placement', ids: [placementId] })
    return placementId
  }

  const endpoint = source.endpoint
  if (!endpoint) return null
  if (endpointSupportsMultiplier(endpoint)) {
    return createPlanMultiplierAltDuplicatePlacement(endpoint, refPlacement)
  }
  return endpointSymbolCanBeDuplicated(endpoint)
    ? createPlanPropertyAltDuplicatePlacement(endpoint.id, refPlacement)
    : null
}

/** Add another placement on the same endpoint (lights / multiplier symbols). */
export function createPlanMultiplierAltDuplicatePlacement(
  endpoint: Endpoint,
  refPlacement: Placement,
): string | null {
  const newPlacementId = generateId()
  useProjectStore.getState().addPlacement(endpoint.id, {
    ...refPlacement,
    id: newPlacementId,
    pos: {
      x: refPlacement.pos.x + PLAN_ALT_DRAG_COPY_OFFSET.x,
      y: refPlacement.pos.y + PLAN_ALT_DRAG_COPY_OFFSET.y,
    },
    ...(getEndpointPlanWallFacingSide(endpoint) && refPlacement.rotationMode !== 'explicit'
      ? { rotationDeg: 0 }
      : {}),
    locked: false,
  })
  useUIStore.getState().setSelection({ type: 'placement', ids: [newPlacementId] })
  return newPlacementId
}

/** New endpoint + placement (properties from source, new label on 1-wire). */
export function createPlanPropertyAltDuplicatePlacement(
  sourceEndpointId: string,
  refPlacement: Placement,
): string | null {
  const store = useProjectStore.getState()
  const source = store.getEndpointById(sourceEndpointId)
  if (!source || !endpointSymbolCanBeDuplicated(source)) return null

  const circuitInfo = store.findCircuitForEndpoint(sourceEndpointId)
  const project = store.currentProject
  if (!circuitInfo || !project) return null

  const r = duplicateEndpointOnCircuit(
    project,
    {
      circuitId: circuitInfo.circuit.id,
      sourceEndpointId,
      context: 'plan',
    },
    {
      getCircuitById: store.getCircuitById,
      getEndpointById: store.getEndpointById,
      addEndpoint: store.addEndpoint,
      updateCircuit: store.updateCircuit,
      setSelection: undefined,
    },
  )
  if (!r.ok || !r.newEndpointId) return null

  const newEndpointId = r.newEndpointId
  const newEp = store.getEndpointById(newEndpointId)
  if (!newEp) return null

  for (const p of [...(newEp.placements ?? [])]) {
    store.deletePlacement(p.id)
  }

  const newPlacementId = generateId()
  store.addPlacement(newEndpointId, {
    id: newPlacementId,
    floorId: refPlacement.floorId,
    layer: refPlacement.layer ?? 'electrical',
    pos: {
      x: refPlacement.pos.x + PLAN_ALT_DRAG_COPY_OFFSET.x,
      y: refPlacement.pos.y + PLAN_ALT_DRAG_COPY_OFFSET.y,
    },
    rotationDeg:
      getEndpointPlanWallFacingSide(source) && refPlacement.rotationMode !== 'explicit'
        ? 0
        : refPlacement.rotationDeg ?? 0,
    rotationMode: refPlacement.rotationMode,
    scale: refPlacement.scale ?? 1,
    locked: false,
  })

  const ui = useUIStore.getState()
  ensureSitplanPlacementsForEndpoints(
    store.currentProject!,
    [newEndpointId],
    (id) => store.getEndpointById(id),
    (endpointId, placement) => store.addPlacement(endpointId, placement),
    {
      activeFloorId: ui.activeFloorId,
      viewportLayout: ui.viewportLayout,
      planCanvasViewportPx: ui.planCanvasViewportPx,
      planView: ui.planView,
    },
  )

  useUIStore.getState().setSelection({ type: 'placement', ids: [newPlacementId] })
  return newPlacementId
}

export function runPlanEndpointAltDragDuplicate(
  sourceEndpointId: string,
  dropPos: Point,
  refPlacement: Placement | undefined,
): boolean {
  const store = useProjectStore.getState()
  const source = store.getEndpointById(sourceEndpointId)
  if (!source || !endpointSymbolCanBeDuplicated(source)) return false

  const circuitInfo = store.findCircuitForEndpoint(sourceEndpointId)
  const project = store.currentProject
  if (!circuitInfo || !project) return false

  const r = duplicateEndpointOnCircuit(
    project,
    {
      circuitId: circuitInfo.circuit.id,
      sourceEndpointId,
      context: 'plan',
    },
    {
      getCircuitById: store.getCircuitById,
      getEndpointById: store.getEndpointById,
      addEndpoint: store.addEndpoint,
      updateCircuit: store.updateCircuit,
      setSelection: undefined,
    },
  )
  if (!r.ok || !r.newEndpointId) return false

  const newEndpointId = r.newEndpointId
  const newEp = store.getEndpointById(newEndpointId)
  if (!newEp) return false

  // Drop behavior clones placements with a fixed offset; replace with the dragged position.
  for (const p of [...(newEp.placements ?? [])]) {
    store.deletePlacement(p.id)
  }

  const ui = useUIStore.getState()
  const floorId =
    refPlacement?.floorId ??
    ui.activeFloorId ??
    selectProjectBuildingFloors(project)[0]?.id
  if (!floorId) return false

  const newPlacementId = generateId()
  store.addPlacement(newEndpointId, {
    id: newPlacementId,
    floorId,
    layer: refPlacement?.layer ?? 'electrical',
    pos: { x: dropPos.x, y: dropPos.y },
    rotationDeg:
      getEndpointPlanWallFacingSide(source) && refPlacement?.rotationMode !== 'explicit'
        ? 0
        : refPlacement?.rotationDeg ?? 0,
    rotationMode: refPlacement?.rotationMode,
    scale: refPlacement?.scale ?? 1,
    locked: false,
  })

  ensureSitplanPlacementsForEndpoints(
    store.currentProject!,
    [newEndpointId],
    (id) => store.getEndpointById(id),
    (endpointId, placement) => store.addPlacement(endpointId, placement),
    {
      activeFloorId: ui.activeFloorId,
      viewportLayout: ui.viewportLayout,
      planCanvasViewportPx: ui.planCanvasViewportPx,
      planView: ui.planView,
    },
  )

  useUIStore.getState().setSelection({ type: 'placement', ids: [newPlacementId] })
  return true
}
