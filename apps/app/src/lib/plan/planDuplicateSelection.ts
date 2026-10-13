/**
 * Sitplan duplicate binding: resolves the plan selection to endpoints/placements and runs
 * `plan.duplicate` (logic in `planDuplicateCore.ts`, ADR 0003).
 */

import { getViewportCenterPlanSpaceIfApplicable } from '@/lib/plan/autoSitplanPlacement'
import { canDuplicatePlanItems } from '@/lib/plan/planDuplicateCore'
import type { Endpoint, Panel, Placement } from '@/types/schema'
import type { Point, Selection } from '@/types/ui'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import {
  selectProjectBuildingFloors,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import type { ProjectV2 } from '@/types/projectV2'

type PlanDuplicateProject = ProjectWithOptionalV2Building & ProjectWithOptionalV2Electrical

export type PlanDuplicateItem = {
  endpointId: string
  placementId?: string
  placement?: Placement
}

export type PlanDuplicateGetters = {
  getEndpointById: (id: string) => Endpoint | undefined
  getPlacementById: (id: string) => (Placement & { endpointId?: string }) | undefined
  getPlacementsByFloor: (
    floorId: string
  ) => Array<Placement & { endpointId?: string; junctionPanelLabel?: string; isEarthing?: boolean }>
  findCircuitForEndpoint: (
    endpointId: string
  ) =>
    | {
        circuit: {
          id: string
          endpoints: Endpoint[]
          branches?: Array<{ id: string; label: string; endpointIds: string[] }>
        }
      }
    | undefined
  getPanelById: (id: string) => Panel | undefined
  getPanelByName: (name: string) => Panel | undefined
  getAllEndpoints: () => Endpoint[]
  getCurrentProject: () => PlanDuplicateProject | null
}

export function resolvePlanDuplicateFloorId(
  project: PlanDuplicateProject,
  activeFloorId: string | null,
  refPlacement?: Pick<Placement, 'floorId'>
): string | undefined {
  return activeFloorId ?? refPlacement?.floorId ?? selectProjectBuildingFloors(project)[0]?.id
}

function resolvePanelToEndpointId(
  getters: PlanDuplicateGetters,
  panelId: string
): string | undefined {
  const panel = getters.getPanelById(panelId)
  if (!panel) return undefined
  const endpoint = getters.getAllEndpoints().find((e) => {
    if (e.symbol !== 'panel_distribution') return false
    if (e.panelId === panel.id) return true
    const labelPanel = e.label ? getters.getPanelByName(e.label) : null
    return labelPanel?.id === panel.id
  })
  return endpoint?.id
}

/** Map global selection to endpoint/placement rows on the active floor. */
export function resolvePlanDuplicateItems(
  selection: Selection,
  activeFloorId: string | null,
  getters: PlanDuplicateGetters
): PlanDuplicateItem[] {
  const result: PlanDuplicateItem[] = []
  if (selection.ids.length === 0) return result

  if (selection.type === 'placement') {
    for (const placementId of selection.ids) {
      const row = getters.getPlacementById(placementId)
      if (!row) continue
      if (!row.endpointId) continue
      const endpoint = getters.getEndpointById(row.endpointId)
      if (!endpoint) continue
      const placement = endpoint.placements.find((p) => p.id === placementId)
      result.push({
        endpointId: endpoint.id,
        placementId,
        placement,
      })
    }
    return result
  }

  let endpointIds: string[] = []
  if (selection.type === 'endpoint') {
    endpointIds = selection.ids
  } else if (selection.type === 'panel') {
    endpointIds = selection.ids
      .map((panelId) => resolvePanelToEndpointId(getters, panelId))
      .filter((id): id is string => !!id)
  } else {
    return result
  }

  for (const endpointId of endpointIds) {
    const endpoint = getters.getEndpointById(endpointId)
    if (!endpoint) continue
    const placement =
      (activeFloorId ? endpoint.placements.find((p) => p.floorId === activeFloorId) : undefined) ??
      (endpoint.placements.length === 1 ? endpoint.placements[0] : undefined)
    result.push({
      endpointId,
      placementId: placement?.id,
      placement,
    })
  }
  return result
}

/** Whether Duplicate should run for this sitplan selection. */
export function canDuplicatePlanSelection(
  selection: Selection,
  getters: PlanDuplicateGetters,
  activeFloorId: string | null = useUIStore.getState().activeFloorId
): boolean {
  if (selection.ids.length === 0) return false
  if (
    selection.type !== 'placement' &&
    selection.type !== 'endpoint' &&
    selection.type !== 'panel'
  ) {
    return false
  }

  const items = resolvePlanDuplicateItems(selection, activeFloorId, getters)
  if (items.length === 0) return false

  const project = getters.getCurrentProject()
  return project != null && canDuplicatePlanItems(project as ProjectV2, items)
}

export type PlanDuplicateResult = Selection | null

/**
 * Duplicates the plan selection through `plan.duplicate` as one undo step and returns the
 * selection of the copies, or null when nothing was duplicated.
 */
export function runPlanDuplicate(
  selection: Selection,
  activeFloorId: string | null,
  options?: { fallbackPosition?: Point; baseSymbolSizePx?: number }
): PlanDuplicateResult {
  const getters: PlanDuplicateGetters = {
    getEndpointById: (id) => useProjectStore.getState().getEndpointById(id),
    getPlacementById: (id) => useProjectStore.getState().getPlacementById(id),
    getPlacementsByFloor: (floorId) => useProjectStore.getState().getPlacementsByFloor(floorId),
    findCircuitForEndpoint: (id) => useProjectStore.getState().findCircuitForEndpoint(id),
    getPanelById: (id) => useProjectStore.getState().getPanelById(id),
    getPanelByName: (name) => useProjectStore.getState().getPanelByName(name),
    getAllEndpoints: () => useProjectStore.getState().getAllEndpoints(),
    getCurrentProject: () => useProjectStore.getState().currentProject,
  }
  const items = resolvePlanDuplicateItems(selection, activeFloorId, getters)
  if (items.length === 0) return null

  const ui = useUIStore.getState()
  const viewportCenter = activeFloorId
    ? getViewportCenterPlanSpaceIfApplicable(
        ui.viewportLayout,
        ui.planCanvasViewportPx,
        activeFloorId,
        activeFloorId,
        ui.planView
      )
    : null
  const outcome = runProjectCommand(
    'plan.duplicate',
    {
      items: items.map(({ endpointId, placementId }) => ({ endpointId, placementId })),
      activeFloorId,
      ...(options?.fallbackPosition ? { fallbackPosition: options.fallbackPosition } : {}),
      viewportCenter,
      ...(options?.baseSymbolSizePx != null ? { symbolBaseSizePx: options.baseSymbolSizePx } : {}),
    },
    { label: 'duplicate plan selection' }
  )
  const select = outcome?.results[0]?.select ?? []
  if (select.length === 0) return null
  return {
    type: select[0]!.kind === 'endpoint' ? 'endpoint' : 'placement',
    ids: select.map((ref) => ref.id),
  }
}
