import { z } from 'zod'
import { findEndpointById, getAllEndpoints } from '@/lib/eendraad/projectElectricalDomain'
import { findPanelOwnDistributionEndpoint } from '@/lib/eendraad/panelSupplyLink'
import { findTrunkDeviceInProject } from '@/lib/eendraad/findTrunkDeviceInProject'
import { installationHasAnyEarthing } from '@/lib/eendraad/panelGround'
import { findPanelById, walkPanels } from '@/lib/panel/panelTree'
import {
  addPlacementToProject,
  addPlacementToTrunkDeviceInProject,
  movePlanPlacementsToFloorInProject,
  updatePlacementInProject,
} from '@/lib/plan/placementMutations'
import { ensurePanelDistributionPlacementInProject } from '@/lib/plan/panelPlacementMutations'
import { isAwaitingPlanPlacement } from '@/lib/plan/customPlacement'
import { collectSharedJunctions } from '@/lib/plan/sharedJunctionPlacements'
import {
  getEditableProjectElectricalInstallation,
  getEditableProjectElectricalPanels,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import {
  getBuildingFloorById,
  mutateBuildingFloorView,
  selectProjectBuildingFloors,
} from '@/lib/projectV2/buildingFloors'
import type { ProjectV2 } from '@/types/projectV2'
import type { Placement } from '@/types/schema'
import { defineProjectCommand, type EntityRef } from '../types'

const point = z.strictObject({ x: z.number().finite(), y: z.number().finite() })
const targetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('endpoint'), id: z.string().min(1) }),
  z.strictObject({ kind: z.literal('trunkDevice'), id: z.string().min(1) }),
  z.strictObject({ kind: z.literal('panel'), id: z.string().min(1) }),
  z.strictObject({ kind: z.literal('earthing') }),
  z.strictObject({ kind: z.literal('junctionPanel'), identity: z.string().min(1) }),
])

export const planPlaceExistingInputSchema = z.strictObject({
  target: targetSchema,
  floorId: z.string().min(1),
  layer: z.string().min(1),
  pos: point,
})
export type PlanPlaceExistingInput = z.input<typeof planPlaceExistingInputSchema>

function resolveTargetEndpoint(project: ProjectV2, target: PlanPlaceExistingInput['target']) {
  const panels = getProjectElectricalPanels(project)
  if (target.kind === 'endpoint') {
    for (const panel of panels) {
      const found = findEndpointById(panel, target.id)
      if (!found) continue
      const endpoint = found.endpoint
      if (endpoint.symbol !== 'panel_distribution') return endpoint
      // A feeder can contain a second electrical representation of the board. Plan
      // placement belongs to its own PANEL endpoint, not to each feeder occurrence.
      const namedBoards = endpoint.panelId
        ? []
        : [...walkPanels(panels)].filter((candidate) => candidate.name === endpoint.label)
      const board = endpoint.panelId
        ? findPanelById(panels, endpoint.panelId)
        : namedBoards.length === 1
          ? namedBoards[0]
          : null
      return (board && findPanelOwnDistributionEndpoint(board)) ?? endpoint
    }
    return null
  }
  if (target.kind !== 'panel') return null
  const panel = findPanelById(panels, target.id)
  if (!panel) return null
  return (
    findPanelOwnDistributionEndpoint(panel) ??
    [...walkPanels(panels)]
      .flatMap(getAllEndpoints)
      .find(
        (endpoint) =>
          endpoint.symbol === 'panel_distribution' &&
          (endpoint.panelId === panel.id || (!endpoint.panelId && endpoint.label === panel.name))
      ) ??
    null
  )
}

function targetExists(project: ProjectV2, target: PlanPlaceExistingInput['target']): boolean {
  if (target.kind === 'trunkDevice') return findTrunkDeviceExists(project, target.id)
  if (target.kind === 'earthing') {
    const installation = getEditableProjectElectricalInstallation(project)
    return (
      !!installation &&
      installationHasAnyEarthing(getEditableProjectElectricalPanels(project), installation)
    )
  }
  if (target.kind === 'junctionPanel')
    return [...collectSharedJunctions(project).values()].some(
      (junction) =>
        junction.symbol === 'junction_panel' &&
        junction.identity === target.identity.trim().toLocaleUpperCase('en-US')
    )
  if (target.kind === 'panel')
    return findPanelById(getProjectElectricalPanels(project), target.id) != null
  return resolveTargetEndpoint(project, target) != null
}

function findTrunkDeviceExists(project: ProjectV2, id: string): boolean {
  return findTrunkDeviceInProject(project, id) != null
}

function unhidePlacementInProject(project: ProjectV2, placementId: string): string[] {
  const changed: string[] = []
  for (const floor of selectProjectBuildingFloors(project)) {
    if (!getBuildingFloorById(project, floor.id)?.hiddenSitplanElementIds?.includes(placementId))
      continue
    mutateBuildingFloorView(project, floor.id, (view) => {
      const hidden = view.hiddenSitplanPlacementIds ?? []
      const next = hidden.filter((id) => id !== placementId)
      if (next.length === hidden.length) return
      view.hiddenSitplanPlacementIds = next.length ? next : undefined
      changed.push(floor.id)
    })
  }
  return changed
}

/** Adds or places an existing electrical identity on the plan, without creating circuit data. */
export const planPlaceExisting = defineProjectCommand({
  id: 'plan.placeExisting',
  version: 1,
  input: planPlaceExistingInputSchema,
  check(project, input) {
    const floor = selectProjectBuildingFloors(project).find(
      (candidate) => candidate.id === input.floorId
    )
    if (!floor) return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    if ('layers' in floor && floor.layers?.length && !floor.layers.includes(input.layer))
      return { ok: false, code: 'layer_not_found', message: 'Plan layer not found' }
    if (!targetExists(project as ProjectV2, input.target))
      return { ok: false, code: 'target_not_found', message: 'Electrical item not found' }
    return { ok: true }
  },
  apply(draft, input, env) {
    const project = draft as ProjectV2
    const installation = getEditableProjectElectricalInstallation(project)
    if (input.target.kind === 'earthing') {
      if (!installation) return { created: [], changed: [], removed: [] }
      if ((installation.earthingPlacements ?? []).length)
        return { created: [], changed: [], removed: [] }
      const placement: Placement = {
        id: env.newId(),
        floorId: input.floorId,
        layer: input.layer,
        pos: input.pos,
        rotationDeg: 0,
        scale: 1,
      }
      installation.earthingPlacements = [placement]
      return { created: [{ kind: 'placement', id: placement.id }], changed: [], removed: [] }
    }
    if (input.target.kind === 'junctionPanel') {
      if (!installation) return { created: [], changed: [], removed: [] }
      const identity = input.target.identity.trim().toLocaleUpperCase('en-US')
      const junction = [...collectSharedJunctions(project).values()].find(
        (candidate) => candidate.symbol === 'junction_panel' && candidate.identity === identity
      )
      if (!junction || junction.panelPlacements?.length)
        return { created: [], changed: [], removed: [] }
      const placement: Placement = {
        id: env.newId(),
        floorId: input.floorId,
        layer: input.layer,
        pos: input.pos,
        rotationDeg: 0,
        scale: 1,
      }
      installation.junctionPanelPlacements = [
        ...(installation.junctionPanelPlacements ?? []),
        { ...placement, label: junction.occurrences[0]?.entity.label ?? junction.identity },
      ]
      return { created: [{ kind: 'placement', id: placement.id }], changed: [], removed: [] }
    }
    if (input.target.kind === 'panel' && !resolveTargetEndpoint(project, input.target)) {
      const panel = findPanelById(getEditableProjectElectricalPanels(project), input.target.id)
      if (!panel) return { created: [], changed: [], removed: [] }
      const placement: Placement = {
        id: env.newId(),
        floorId: input.floorId,
        layer: input.layer,
        pos: input.pos,
        rotationDeg: 0,
        scale: 1,
      }
      const mutation = ensurePanelDistributionPlacementInProject(panel, placement, {
        newId: env.newId,
      })
      const created: EntityRef[] = []
      if (mutation.createdCircuitId)
        created.push({ kind: 'circuit', id: mutation.createdCircuitId })
      if (mutation.createdEndpointId)
        created.push({ kind: 'endpoint', id: mutation.createdEndpointId })
      const placementRef: EntityRef = { kind: 'placement', id: placement.id }
      if (mutation.placementAdded) created.push(placementRef)
      return {
        created,
        changed: [
          { kind: 'panel', id: panel.id },
          ...(!mutation.createdCircuitId
            ? [{ kind: 'circuit' as const, id: mutation.circuitId }]
            : []),
        ],
        removed: [],
        related: [{ kind: 'circuit', id: mutation.circuitId }],
        select: mutation.placementAdded ? [placementRef] : [],
      }
    }
    const endpoint = resolveTargetEndpoint(project, input.target)
    const ownerPlacements =
      input.target.kind === 'trunkDevice'
        ? (findTrunkDeviceInProject(project, input.target.id)?.placements ?? [])
        : (endpoint?.placements ?? [])
    const existingOnFloor = ownerPlacements.find((placement) => placement.floorId === input.floorId)
    const awaiting = ownerPlacements.find(isAwaitingPlanPlacement)
    // A board is one physical item. Its automatic placement may already be on the
    // default floor even when the caller has not supplied a plan location yet.
    const boardPlacement = endpoint?.symbol === 'panel_distribution' ? ownerPlacements[0] : undefined

    // A user may start from a selected item's auto-generated pending placement. Move that
    // placement (or a board on another floor) instead of adding a second physical copy.
    const placementToComplete = existingOnFloor ?? awaiting ?? boardPlacement
    if (placementToComplete) {
      let moved = false
      let circuitId: string | undefined
      if (
        !placementToComplete.locked &&
        (isAwaitingPlanPlacement(placementToComplete) ||
          (boardPlacement && placementToComplete.floorId !== input.floorId))
      ) {
        if (placementToComplete.floorId === input.floorId) {
          const updated = updatePlacementInProject(project, placementToComplete.id, {
            floorId: input.floorId,
            layer: input.layer,
            pos: input.pos,
          })
          moved = !!updated
          circuitId = updated?.circuitId
        } else {
          moved = movePlanPlacementsToFloorInProject(
            project,
            [{ id: placementToComplete.id, pos: input.pos }],
            input.floorId
          )
          const updated = updatePlacementInProject(project, placementToComplete.id, {
            layer: input.layer,
          })
          circuitId = updated?.circuitId
        }
      }
      if (placementToComplete.locked && placementToComplete.floorId !== input.floorId)
        return { created: [], changed: [], removed: [] }
      const unhiddenFloorIds = unhidePlacementInProject(project, placementToComplete.id)
      if (!moved && unhiddenFloorIds.length === 0) return { created: [], changed: [], removed: [] }
      return {
        created: [],
        changed: [
          ...(moved ? [{ kind: 'placement' as const, id: placementToComplete.id }] : []),
          ...unhiddenFloorIds.map((id) => ({ kind: 'floor' as const, id })),
        ],
        removed: [],
        related: circuitId ? [{ kind: 'circuit', id: circuitId }] : [],
        select: [{ kind: 'placement', id: placementToComplete.id }],
      }
    }

    const placement: Placement = {
      id: env.newId(),
      floorId: input.floorId,
      layer: input.layer,
      pos: input.pos,
      rotationDeg: 0,
      scale: 1,
    }
    const added =
      input.target.kind === 'trunkDevice'
        ? addPlacementToTrunkDeviceInProject(project, input.target.id, placement)
        : endpoint
          ? addPlacementToProject(project, endpoint.id, placement) != null
          : false
    if (!added) return { created: [], changed: [], removed: [] }
    const placementRef: EntityRef = { kind: 'placement', id: placement.id }
    return {
      created: [placementRef],
      changed: [],
      removed: [],
      select: [placementRef],
    }
  },
})
