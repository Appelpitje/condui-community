import { isModuleRefValid } from '@/lib/eendraad/projectElectricalDomain'
import { getPanelGridModulesInProject } from './panelGridModules'
import {
  getPanelGridPlacements,
  getSupplyPanelPlacements,
  panelGridModuleRefKey,
  resolveModuleWidthCols,
} from './panelGridLayout'
import { getSupplyPanelLayout, rebalanceSupplyOverflowIntoMain } from './panelSupplySlots'
import {
  updatePanelGridSlotsInProject,
  updateSupplyPanelSlotsInProject,
} from './panelGridMutations'
import { findPanelById } from './panelTree'
import {
  getProjectElectricalPanels,
  getProjectElectricalInstallation,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { ProjectV2 } from '@/types/projectV2'
import type { Panel, PanelGridSlot } from '@/types/schema'
import { isTerminalStripModuleRef } from './panelGridModuleWidth'

/** Freeze the layout's initial positions without moving any already positioned module. */
export function getMissingPanelGridSlots(
  project: ProjectWithOptionalV2Electrical,
  panel: Panel
): { mainAdds: PanelGridSlot[]; supplyAdds: PanelGridSlot[] } {
  const modules = getPanelGridModulesInProject(project, panel.id).filter(
    (item) => !(item.ref.kind === 'trunkDevice' && item.ref.scope === 'ground')
  )
  const installation = getProjectElectricalInstallation(project)
  const sharedKeys = new Set(
    (panel.isMain
      ? (installation?.mainSupply.supplyTrunkDevices ??
        installation?.feedTopology?.sharedFeed.trunkDevices ??
        [])
      : []
    ).map((device) =>
      panelGridModuleRefKey({ kind: 'trunkDevice', id: device.id, scope: 'supply' })
    )
  )
  const missing = (supply: boolean) => {
    const existing = new Set(
      (supply ? (panel.gridView?.supplyPanelSlots ?? []) : (panel.gridView?.slots ?? [])).map(
        (slot) => panelGridModuleRefKey(slot.module)
      )
    )
    const items = modules.filter((item) => (item.inSupplyPanel === true) === supply)
    const placements = supply
      ? getSupplyPanelPlacements(panel, project, items)
      : getPanelGridPlacements(panel, project, items)
    return placements
      .filter((placement) => {
        const key = panelGridModuleRefKey(placement.ref)
        if (existing.has(key) || (!supply && panel.isMain && sharedKeys.has(key))) return false
        try {
          return isModuleRefValid(placement.ref, project)
        } catch {
          return false
        }
      })
      .map((placement) => ({
        row: placement.row,
        col: placement.col,
        module: placement.ref,
        ...(placement.terminalStripRail ? { terminalStripRail: placement.terminalStripRail } : {}),
      }))
  }
  return { mainAdds: missing(false), supplyAdds: missing(true) }
}

/** Recover terminal slots whose automatic rail placement was persisted as a DIN slot. */
export function getPanelTerminalSlotRepair(
  project: ProjectWithOptionalV2Electrical,
  panel: Panel
): PanelGridSlot[] | null {
  const grid = panel.gridView
  if (!grid || (!grid.terminalStripTopRail && !grid.terminalStripBottomRail)) return null
  const modules = getPanelGridModulesInProject(project, panel.id).filter(
    (item) => !item.inSupplyPanel
  )
  const terminals = modules.filter(
    (item) =>
      item.slot &&
      !item.slot.terminalStripRail &&
      item.slot.moduleWidthManual !== true &&
      isTerminalStripModuleRef(item.ref, project)
  )
  const affectedKeys = new Set<string>()
  for (const item of terminals) {
    if (
      terminals.some(
        (other) =>
          other !== item &&
          other.slot!.row === item.slot!.row &&
          item.slot!.col <
            other.slot!.col + resolveModuleWidthCols(other.ref, project, other.slot) - 1e-8 &&
          other.slot!.col <
            item.slot!.col + resolveModuleWidthCols(item.ref, project, item.slot) - 1e-8
      )
    )
      affectedKeys.add(panelGridModuleRefKey(item.ref))
  }
  if (!affectedKeys.size) return null
  const placements = getPanelGridPlacements(
    panel,
    project,
    modules.map((item) =>
      affectedKeys.has(panelGridModuleRefKey(item.ref)) ? { ...item, slot: undefined } : item
    )
  )
  const repairs = new Map(
    placements
      .filter(
        (placement) =>
          placement.terminalStripRail && affectedKeys.has(panelGridModuleRefKey(placement.ref))
      )
      .flatMap((placement) =>
        (placement.terminalStripMemberRefs ?? [placement.ref]).map(
          (ref) => [panelGridModuleRefKey(ref), placement] as const
        )
      )
  )
  if (!repairs.size) return null
  return grid.slots.map((slot) => {
    const placement = repairs.get(panelGridModuleRefKey(slot.module))
    return placement
      ? {
          ...slot,
          row: placement.row,
          col: placement.col,
          terminalStripRail: placement.terminalStripRail,
        }
      : slot
  })
}

/** A pole/width edit can make an existing shared supply strip overlap or overflow. */
export function getPanelSupplySlotRepair(project: ProjectWithOptionalV2Electrical, panel: Panel) {
  const supplySlots = panel.gridView?.supplyPanelSlots ?? []
  if (!panel.isMain || supplySlots.length === 0) return null
  const { rows, cols } = getSupplyPanelLayout(panel)
  const mainKeys = new Set(
    (panel.gridView?.slots ?? []).map((slot) => panelGridModuleRefKey(slot.module))
  )
  const occupied: Array<{ row: number; start: number; end: number }> = []
  for (const slot of supplySlots) {
    const width = Math.max(1, resolveModuleWidthCols(slot.module, project, slot))
    const end = slot.col + width
    if (
      slot.row < 0 ||
      slot.row >= rows ||
      slot.col < 0 ||
      end > cols ||
      mainKeys.has(panelGridModuleRefKey(slot.module)) ||
      occupied.some((other) => other.row === slot.row && slot.col < other.end && other.start < end)
    ) {
      return rebalanceSupplyOverflowIntoMain(panel, project)
    }
    occupied.push({ row: slot.row, start: slot.col, end })
  }
  return null
}

/** Run canvas layout follow-ups inside the electrical gesture's draft and undo snapshot. */
export function persistAutomaticPanelSlotsInProject(project: ProjectV2, panelId: string): boolean {
  const panel = findPanelById(getProjectElectricalPanels(project), panelId)
  // Panels with no persisted grid retain lazy initialization when first opened.
  if (!panel?.gridView) return false
  let changed = false
  const terminalRepair = getPanelTerminalSlotRepair(project, panel)
  if (terminalRepair)
    changed = updatePanelGridSlotsInProject(project, panelId, terminalRepair) || changed
  const { mainAdds, supplyAdds } = getMissingPanelGridSlots(project, panel)
  if (mainAdds.length)
    changed =
      updatePanelGridSlotsInProject(project, panelId, [
        ...(panel.gridView.slots ?? []),
        ...mainAdds,
      ]) || changed
  if (supplyAdds.length)
    changed =
      updateSupplyPanelSlotsInProject(project, panelId, [
        ...(panel.gridView.supplyPanelSlots ?? []),
        ...supplyAdds,
      ]) || changed
  const repair = getPanelSupplySlotRepair(project, panel)
  if (repair) {
    changed = updatePanelGridSlotsInProject(project, panelId, repair.mainSlots) || changed
    changed = updateSupplyPanelSlotsInProject(project, panelId, repair.supplySlots) || changed
  }
  return changed
}
