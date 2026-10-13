import { getJunctionPanelGridView, getJunctionPanelIdentity } from './grid'
import { getJunctionPanelModulesInProject } from '@/lib/panel/panelGridModules'
import { getPanelGridPlacements, panelGridModuleRefKey } from '@/lib/panel/panelGridLayout'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { getOwnPanelCircuits } from '@/lib/panel/circuitModuleMountingRules'
import { walkPanels } from '@/lib/panel/panelTree'
import type { Panel, PanelGridConfig, PanelGridSlot, TrunkDevice } from '@/types/schema'

/** Modules use row zero below the junction terminals when those have no separate rail. */
export function getJunctionPanelModuleRowOffset(grid: PanelGridConfig): number {
  return grid.terminalStripTopRail || grid.terminalStripBottomRail ? 0 : 1
}

/** The drawn module positions, including automatic slots, for an editable junction frame. */
export function getJunctionPanelModuleLayout(
  project: ProjectWithOptionalV2Electrical,
  device: TrunkDevice
) {
  const identity = getJunctionPanelIdentity(device)
  const configured = device.junctionPanelGridView
    ? device
    : [...walkPanels(getProjectElectricalPanels(project))]
        .flatMap((panel) =>
          getOwnPanelCircuits(panel).flatMap((circuit) => circuit.trunkDevices ?? [])
        )
        .find(
          (candidate) =>
            identity &&
            getJunctionPanelIdentity(candidate) === identity &&
            candidate.junctionPanelGridView
        )
  const grid = getJunctionPanelGridView(configured ?? device)
  const modules = getJunctionPanelModulesInProject(project, identity ?? '', grid.slots)
  // Match the scene's expandable junction grid instead of clamping its automatic rows.
  const placements = getPanelGridPlacements(
    { gridView: { ...grid, rows: 50, feedFromTop: true } } as Panel,
    project,
    modules
  )
  const moduleRowOffset = modules.length ? getJunctionPanelModuleRowOffset(grid) : 0
  const rows = Math.max(
    1,
    grid.rows,
    ...placements.map((placement) => placement.row + 1 + moduleRowOffset)
  )
  const slots: PanelGridSlot[] = placements.map((placement) => ({
    ...grid.slots.find(
      (slot) => panelGridModuleRefKey(slot.module) === panelGridModuleRefKey(placement.ref)
    ),
    module: placement.ref,
    row: placement.row,
    col: placement.col,
    ...(placement.terminalStripRail ? { terminalStripRail: placement.terminalStripRail } : {}),
  }))
  return { grid: { ...grid, rows }, slots, moduleRowOffset }
}
