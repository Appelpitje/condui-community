import type { Endpoint, Installation, JunctionPanelPlacement, Placement } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import {
  collectAllGroundTrunkDevices,
  installationHasAnyEarthing,
} from '@/lib/eendraad/panelGround'
import {
  buildDefaultEarthingSitplanPlacement,
  findEarthingPlacementOnFloor,
  getEarthingPlacements,
} from '@/lib/plan/earthingSitplanPlacement'
import {
  findEndpointById,
  getAllCircuits,
  getAllEndpoints,
} from '@/lib/eendraad/projectElectricalDomain'
import { findTrunkDeviceInProject } from '@/lib/eendraad/findTrunkDeviceInProject'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { logger } from '@/lib/logger'
import { isMainPanelDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import { removeSupplyDevicePlacements } from '@/lib/supplyAssembly/inverterMultipliers'
import { withCustomPlacementFlag } from '@/lib/plan/customPlacement'
import { healPlanWiring } from '@/lib/plan/planWiring'
import { syncPanelAndSituationPlanDeviceVisibility } from '@/lib/plan/panelPlanPlacementVisibility'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import {
  getEditableProjectElectricalInstallation,
  getEditableProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import {
  replacePlanWireRoutesForProject,
  selectProjectPlanWireRoutes,
} from '@/lib/projectV2/planWiring'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'
import { generateId } from '@/utils/id'
import { findCircuitForEndpointInPanel } from '@/utils/project'

/**
 * Situation-plan placement edits on a mutable project (an Immer draft in the store or in a
 * project command). Shared by the store actions and `lib/commands/project` so both run the
 * same rules.
 */

type EarthingPlacement = NonNullable<Installation['earthingPlacements']>[number]

/** Preserve draft identity for equal coordinates supplied by a drag-end event. */
function applyPlacementPatch<T extends { pos: Placement['pos'] }>(
  placement: T,
  patch: Partial<T>
): boolean {
  let changed = false
  for (const key of Object.keys(patch) as Array<keyof T>) {
    const value = patch[key]
    if (Object.is(placement[key], value)) continue
    if (key === 'pos') {
      const pos = value as Placement['pos'] | undefined
      if (pos && placement.pos.x === pos.x && placement.pos.y === pos.y) continue
    }
    placement[key] = value as T[keyof T]
    changed = true
  }
  return changed
}

export type MutablePlacementOwner = {
  placement: Placement
  circuitId?: string
  /** Set when the placement belongs to a circuit endpoint. */
  endpointId?: string
}

/** Resolve every standard situation-plan placement, independent of its electrical owner. */
export function findMutablePlacementOwner(
  project: ProjectV2,
  placementId: string
): MutablePlacementOwner | null {
  const installation = getEditableProjectElectricalInstallation(project)
  const installationTrunkDevices = [
    ...queryAllSupplyTrunkDevices(project),
    ...collectAllGroundTrunkDevices(getEditableProjectElectricalPanels(project), installation),
  ]
  for (const device of installationTrunkDevices) {
    const placement = device.placements?.find((candidate) => candidate.id === placementId)
    if (placement) return { placement }
  }
  for (const enclosure of project.disciplines?.electrical?.auxiliaryEnclosures ?? []) {
    const placement = enclosure.placements?.find((candidate) => candidate.id === placementId)
    if (placement) return { placement }
  }

  for (const panel of getEditableProjectElectricalPanels(project)) {
    for (const endpoint of getAllEndpoints(panel)) {
      const placement = endpoint.placements.find((candidate) => candidate.id === placementId)
      if (!placement) continue
      const owner = findCircuitForEndpointInPanel(panel, endpoint.id)
      return { placement, circuitId: owner?.circuit?.id, endpointId: endpoint.id }
    }
    for (const circuit of getAllCircuits(panel)) {
      for (const device of [
        ...(circuit.trunkDevices ?? []),
        ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
      ]) {
        const placement = device.placements?.find((candidate) => candidate.id === placementId)
        if (placement) return { placement, circuitId: circuit.id }
      }
    }
  }

  return null
}

export type ResolvedPlanPlacement =
  | { kind: 'junctionPanel'; placement: JunctionPanelPlacement }
  | { kind: 'earthing'; placement: EarthingPlacement }
  | { kind: 'standard'; placement: Placement; circuitId?: string; endpointId?: string }

/** Any situation-plan placement by id: junction panel, earthing or standard placement. */
export function resolvePlanPlacement(
  project: ProjectV2,
  placementId: string
): ResolvedPlanPlacement | null {
  const installation = getEditableProjectElectricalInstallation(project)
  const junctionPanel = installation?.junctionPanelPlacements?.find(
    (placement) => placement.id === placementId
  )
  if (junctionPanel) return { kind: 'junctionPanel', placement: junctionPanel }
  const earthing = installation?.earthingPlacements?.find(
    (placement) => placement.id === placementId
  )
  if (earthing) return { kind: 'earthing', placement: earthing }
  const owner = findMutablePlacementOwner(project, placementId)
  return owner ? { kind: 'standard', ...owner } : null
}

/** Adds a placement to an endpoint. Returns the endpoint's circuit id, or null when not found. */
export function addPlacementToProject(
  project: ProjectV2,
  endpointId: string,
  placement: Placement
): string | null {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const result = findEndpointById(panel, endpointId)
    if (!result) continue
    result.endpoint.placements.push(placement)
    syncPanelAndSituationPlanDeviceVisibility(project)
    return result.circuit.id
  }
  return null
}

/** Adds a plan placement to an existing trunk device without changing its electrical owner. */
export function addPlacementToTrunkDeviceInProject(
  project: ProjectV2,
  deviceId: string,
  placement: Placement
): boolean {
  const device = findTrunkDeviceInProject(project, deviceId)
  if (!device) return false
  device.placements = [...(device.placements ?? []), placement]
  syncPanelAndSituationPlanDeviceVisibility(project)
  return true
}

/** Applies a standard placement patch. Returns its owner, or null for a missing/unchanged placement. */
export function updatePlacementInProject(
  project: ProjectV2,
  placementId: string,
  updates: Partial<Placement>
): { circuitId?: string } | null {
  const owner = findMutablePlacementOwner(project, placementId)
  if (!owner) return null
  if (!applyPlacementPatch(owner.placement, withCustomPlacementFlag(owner.placement, updates)))
    return null
  return { circuitId: owner.circuitId }
}

export function updateJunctionPanelPlacementInProject(
  project: ProjectV2,
  placementId: string,
  updates: Partial<JunctionPanelPlacement>
): boolean {
  const list = getEditableProjectElectricalInstallation(project)?.junctionPanelPlacements
  const index = list?.findIndex((placement) => placement.id === placementId) ?? -1
  if (!list || index === -1) return false
  return applyPlacementPatch(list[index]!, updates)
}

export function updateEarthingPlacementInProject(
  project: ProjectV2,
  placementId: string,
  updates: Partial<EarthingPlacement>
): boolean {
  const list = getEditableProjectElectricalInstallation(project)?.earthingPlacements
  const index = list?.findIndex((placement) => placement.id === placementId) ?? -1
  if (!list || index === -1) return false
  return applyPlacementPatch(list[index]!, updates)
}

/**
 * Moves placements to another floor, optionally to new positions. Manual wires travel along
 * when both their ends move; routes left with one moved end are healed away. Returns false
 * without changes when the floor or any placement is missing.
 */
export function movePlanPlacementsToFloorInProject(
  project: ProjectV2,
  moves: ReadonlyArray<{ id: string; pos?: Placement['pos'] }>,
  floorId: string
): boolean {
  if (moves.length === 0) return false
  if (!selectProjectBuildingFloors(project).some((floor) => floor.id === floorId)) return false

  const uniqueMoves = new Map(moves.map((move) => [move.id, move]))
  const resolved: Array<{ target: ResolvedPlanPlacement; pos?: Placement['pos'] }> = []
  for (const move of uniqueMoves.values()) {
    const target = resolvePlanPlacement(project, move.id)
    if (!target) return false
    resolved.push({ target, pos: move.pos })
  }

  if (
    !resolved.some(
      ({ target, pos }) =>
        target.placement.floorId !== floorId ||
        (pos &&
          (target.placement.pos.x !== pos.x ||
            target.placement.pos.y !== pos.y ||
            (target.kind === 'standard' &&
              (target.placement.style as { awaitingPlacement?: boolean } | undefined)
                ?.awaitingPlacement)))
    )
  )
    return true

  // Preserve a manual wire when both of its placement endpoints travel together. Routes
  // with only one moved endpoint are removed by healing below instead of becoming stale.
  const movedPlacementIds = new Set(uniqueMoves.keys())
  const planWireRoutes = selectProjectPlanWireRoutes(project)
  planWireRoutes.forEach((route) => {
    const fromPlacementId = route.from.placementId
    const toPlacementId = route.to.placementId
    if (
      fromPlacementId &&
      toPlacementId &&
      movedPlacementIds.has(fromPlacementId) &&
      movedPlacementIds.has(toPlacementId)
    ) {
      route.floorId = floorId
    }
  })
  replacePlanWireRoutesForProject(project, planWireRoutes)

  resolved.forEach(({ target, pos }) => {
    const patch = { floorId, ...(pos ? { pos } : {}) }
    if (target.kind === 'standard') {
      applyPlacementPatch(target.placement, withCustomPlacementFlag(target.placement, patch))
    } else {
      applyPlacementPatch(target.placement, patch)
    }
  })

  healPlanWiring(project)
  syncPanelAndSituationPlanDeviceVisibility(project)
  return true
}

/**
 * Removes placements from their owners (endpoints, circuit and supply devices, earthing) and
 * heals plan wiring. Main-board distribution symbols are kept. Returns false when nothing
 * matched.
 */
export function deletePlacementsFromProject(project: ProjectV2, ids: readonly string[]): boolean {
  const installation = getEditableProjectElectricalInstallation(project)
  const panels = getEditableProjectElectricalPanels(project)
  const blocked = new Set<string>()
  for (const panel of panels) {
    for (const endpoint of getAllEndpoints(panel)) {
      if (!isMainPanelDistributionEndpoint(project, endpoint)) continue
      for (const placement of endpoint.placements) {
        if (ids.includes(placement.id)) blocked.add(placement.id)
      }
    }
  }
  const idsSet = new Set(ids.filter((id) => !blocked.has(id)))
  // Enclosures own their automatic plan symbols. Their visibility has a separate action;
  // deleting one would just cause the enclosure healer to create it again.
  for (const enclosure of project.disciplines.electrical?.auxiliaryEnclosures ?? []) {
    for (const placement of enclosure.placements ?? []) idsSet.delete(placement.id)
  }
  for (const id of idsSet) {
    const target = resolvePlanPlacement(project, id)
    if (!target || target.kind === 'junctionPanel') idsSet.delete(id)
  }
  const earthingIds =
    idsSet.size > 0
      ? (installation?.earthingPlacements ?? [])
          .filter((placement) => idsSet.has(placement.id))
          .map((placement) => placement.id)
      : []
  if (idsSet.size === 0 && earthingIds.length === 0) {
    if (blocked.size > 0) {
      logger.warn('[projectStore] deletePlacements skipped main panel distribution placement(s)')
    }
    return false
  }
  for (const panel of panels) {
    for (const endpoint of getAllEndpoints(panel)) {
      if (endpoint.placements.some((placement) => idsSet.has(placement.id))) {
        endpoint.placements = endpoint.placements.filter((placement) => !idsSet.has(placement.id))
      }
    }
    for (const circuit of getAllCircuits(panel)) {
      for (const device of [
        ...(circuit.trunkDevices ?? []),
        ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
      ]) {
        if (device.placements?.some((placement) => idsSet.has(placement.id))) {
          device.placements = device.placements.filter((placement) => !idsSet.has(placement.id))
        }
      }
    }
  }
  for (const device of queryAllSupplyTrunkDevices(project)) {
    if (
      device.placements?.some((placement) => idsSet.has(placement.id)) &&
      !removeSupplyDevicePlacements(device, idsSet)
    ) {
      device.placements = device.placements.filter((placement) => !idsSet.has(placement.id))
    }
  }
  for (const device of collectAllGroundTrunkDevices(panels, installation)) {
    if (device.placements?.some((placement) => idsSet.has(placement.id))) {
      device.placements = device.placements.filter((placement) => !idsSet.has(placement.id))
    }
  }
  if (earthingIds.length > 0 && installation?.earthingPlacements) {
    const removeSet = new Set(earthingIds)
    installation.earthingPlacements = installation.earthingPlacements.filter(
      (placement) => !removeSet.has(placement.id)
    )
  }
  healPlanWiring(project)
  return true
}

export interface PlanPlacementDeletion {
  /** Placements removed while their owner stays (multiplier endpoints, devices, earthing). */
  placementIds: string[]
  /** Endpoints deleted with their dependents, because all their placements are removed. */
  endpointIds: string[]
  /** Kept: main-board distribution, junction panel and enclosure-owned placements. */
  blockedPlacementIds: string[]
  missingPlacementIds: string[]
}

/**
 * What deleting these situation-plan placements does. A multiplier-capable endpoint keeps its
 * one-wire endpoint until every one of its placements is deleted; any other endpoint goes with
 * its placement.
 */
export function resolvePlanPlacementDeletion(
  project: ProjectV2,
  placementIds: readonly string[]
): PlanPlacementDeletion {
  const deletion: PlanPlacementDeletion = {
    placementIds: [],
    endpointIds: [],
    blockedPlacementIds: [],
    missingPlacementIds: [],
  }
  const selectedByEndpoint = new Map<string, string[]>()
  for (const placementId of new Set(placementIds)) {
    const target = resolvePlanPlacement(project, placementId)
    if (!target) {
      deletion.missingPlacementIds.push(placementId)
    } else if (
      target.kind === 'junctionPanel' ||
      project.disciplines.electrical?.auxiliaryEnclosures?.some((enclosure) =>
        enclosure.placements?.some((placement) => placement.id === placementId)
      )
    ) {
      deletion.blockedPlacementIds.push(placementId)
    } else if (target.kind === 'standard' && target.endpointId) {
      const selected = selectedByEndpoint.get(target.endpointId) ?? []
      selectedByEndpoint.set(target.endpointId, [...selected, placementId])
    } else {
      deletion.placementIds.push(placementId)
    }
  }
  for (const [endpointId, selected] of selectedByEndpoint) {
    const endpoint = findEndpointInProject(project, endpointId)
    if (!endpoint || isMainPanelDistributionEndpoint(project, endpoint)) {
      deletion.blockedPlacementIds.push(...selected)
      continue
    }
    const deleteWholeEndpoint =
      !endpointSupportsMultiplier(endpoint) ||
      endpoint.placements.every((placement) => selected.includes(placement.id))
    if (deleteWholeEndpoint) deletion.endpointIds.push(endpointId)
    else deletion.placementIds.push(...selected)
  }
  return deletion
}

function findEndpointInProject(project: ProjectV2, endpointId: string): Endpoint | undefined {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const endpoint = getAllEndpoints(panel).find((candidate) => candidate.id === endpointId)
    if (endpoint) return endpoint
  }
  return undefined
}

/** Gives a junction panel label its plan placement once, on the given or first floor. */
export function ensureJunctionPanelPlacementForLabelInProject(
  project: ProjectV2,
  label: string,
  floorId?: string
): boolean {
  const installation = getEditableProjectElectricalInstallation(project)
  if (!installation) return false
  if ((installation.junctionPanelPlacements ?? []).some((jp) => jp.label === label)) return false
  const targetFloorId = floorId ?? selectProjectBuildingFloors(project)[0]?.id
  if (!targetFloorId) return false
  const placement: JunctionPanelPlacement = {
    id: generateId(),
    label,
    floorId: targetFloorId,
    pos: { x: 200, y: 200 },
    rotationDeg: 0,
    scale: 1,
    layer: 'default',
  }
  installation.junctionPanelPlacements = [
    ...(installation.junctionPanelPlacements ?? []),
    placement,
  ]
  return true
}

/**
 * Puts the earthing symbol on a floor when the installation has earthing: moves an existing one
 * on that floor to `pos`, keeps an existing one on another floor, or adds a default placement.
 * Returns the placement id and whether anything changed, or null without earthing.
 */
export function ensureEarthingSitplanPlacementInProject(
  project: ProjectV2,
  floorId: string,
  pos?: Placement['pos']
): { placementId: string; changed: boolean } | null {
  const installation = getEditableProjectElectricalInstallation(project)
  if (
    !installation ||
    !installationHasAnyEarthing(getEditableProjectElectricalPanels(project), installation)
  ) {
    return null
  }
  const existing = findEarthingPlacementOnFloor(project, floorId)
  if (existing) {
    const moved = pos ? updateEarthingPlacementInProject(project, existing.id, { pos }) : false
    return { placementId: existing.id, changed: moved }
  }
  const anyExisting = getEarthingPlacements(installation)
  if (anyExisting.length > 0) return { placementId: anyExisting[0]!.id, changed: false }
  const placement = buildDefaultEarthingSitplanPlacement(project, floorId, pos)
  installation.earthingPlacements = [...(installation.earthingPlacements ?? []), placement]
  return { placementId: placement.id, changed: true }
}
