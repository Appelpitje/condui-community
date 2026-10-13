import type { ProjectV2 } from '@/types/projectV2'
import type { Placement } from '@/types/schema'
import { findEndpointById } from '@/lib/eendraad/projectElectricalDomain'
import { deletePlacementsFromProject } from '@/lib/plan/placementMutations'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { getAllCircuits, panelGridModuleRefKey } from '@/lib/eendraad/projectElectricalDomain'
import { findPanelById } from '@/lib/panel/panelTree'
import { unhideModuleFromPanelInProject } from '@/lib/panel/panelGridMutations'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import { isModularSocket } from '@/lib/socket/modularSocket'
import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { setSupplyDevicePanelVisibility } from '@/lib/panel/supplyPanelVisibility'
import { syncPanelAndSituationPlanDeviceVisibility } from '@/lib/plan/panelPlanPlacementVisibility'

export function getEndpointMultiplierPlacementChanges(
  placements: readonly Placement[],
  count: number,
  floorId: string | undefined,
  newId: () => string
): { add: Placement[]; removeIds: string[] } | null {
  if (!Number.isInteger(count) || count < 1) return null
  if (count < placements.length) {
    return { add: [], removeIds: placements.slice(count).map((placement) => placement.id) }
  }
  if (count === placements.length) return { add: [], removeIds: [] }
  const resolvedFloorId = floorId ?? placements[0]?.floorId
  const base =
    placements.find((placement) => placement.floorId === resolvedFloorId) ?? placements[0]
  if (!resolvedFloorId || !base) return null
  const startCount = placements.length
  const add: Placement[] = []
  for (let index = startCount; index < count; index += 1) {
    const step = index - startCount + 1
    add.push({
      ...base,
      id: newId(),
      floorId: resolvedFloorId,
      pos: { x: base.pos.x + 24 * step, y: base.pos.y + 24 * step },
    })
  }
  return { add, removeIds: [] }
}

/** Resizes a multiplied endpoint using deterministic command IDs and plan placement data. */
export function applyEndpointMultiplierCountInProject(
  project: ProjectV2,
  endpointId: string,
  count: number,
  activeFloorId: string | null | undefined,
  newId: () => string
): boolean {
  if (!Number.isInteger(count) || count < 1) return false
  let owner: ReturnType<typeof findEndpointById> | null = null
  for (const panel of getEditableProjectElectricalPanels(project)) {
    owner = findEndpointById(panel, endpointId) ?? null
    if (owner) break
  }
  if (!owner) return false
  const placements = owner.endpoint.placements ?? []
  if (count === placements.length) return false
  const floorId =
    activeFloorId ?? placements[0]?.floorId ?? selectProjectBuildingFloors(project)[0]?.id
  const changes = getEndpointMultiplierPlacementChanges(placements, count, floorId, newId)
  if (!changes) return false
  if (changes.removeIds.length) return deletePlacementsFromProject(project, changes.removeIds)
  owner.endpoint.placements.push(...changes.add)
  return true
}

/** Applies the panel view state and synchronizes the corresponding plan visibility. */
export function setPanelModuleVisibilityInProject(
  project: ProjectV2,
  panelId: string,
  moduleRefKey: string,
  visible: boolean
): boolean {
  if (visible) return unhideModuleFromPanelInProject(project, panelId, moduleRefKey)
  const supplyDevice = getAllSupplyTrunkDevices(project).find(
    (device) => `trunkDevice:${device.id}:supply` === moduleRefKey
  )
  if (supplyDevice) {
    const changed = setSupplyDevicePanelVisibility(project, supplyDevice.id, false)
    return (
      syncPanelAndSituationPlanDeviceVisibility(project, { kind: 'hide', panelId, moduleRefKey }) ||
      changed
    )
  }
  const panel = findPanelById(getEditableProjectElectricalPanels(project), panelId)
  if (!panel) return false
  for (const circuit of getAllCircuits(panel)) {
    for (const endpoint of circuit.endpoints) {
      const key = panelGridModuleRefKey({
        kind: 'domotica',
        endpointId: endpoint.id,
        circuitId: circuit.id,
      })
      if (key === moduleRefKey && isModularSocket(endpoint)) return false
    }
  }
  panel.gridView ??= {
    rows: DEFAULT_PANEL_GRID_ROWS,
    columns: DEFAULT_PANEL_GRID_COLUMNS,
    feedFromTop: false,
    slots: [],
  }
  const hidden = panel.gridView.hiddenModuleKeys ?? []
  const shown = panel.gridView.shownModuleKeys ?? []
  let changed = false
  if (!hidden.includes(moduleRefKey)) {
    panel.gridView.hiddenModuleKeys = [...hidden, moduleRefKey]
    changed = true
  }
  if (shown.includes(moduleRefKey)) {
    panel.gridView.shownModuleKeys = shown.filter((key) => key !== moduleRefKey)
    if (panel.gridView.shownModuleKeys.length === 0) panel.gridView.shownModuleKeys = undefined
    changed = true
  }
  if (!changed) return false
  syncPanelAndSituationPlanDeviceVisibility(project, { kind: 'hide', panelId, moduleRefKey })
  return true
}
