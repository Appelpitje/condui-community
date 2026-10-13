import { panelGridModuleRefKey } from '@/lib/eendraad/projectElectricalDomain'
import { isPanelGridSlotModuleCurrent } from '@/lib/panel/panelGridMutations'
import { findPanelById } from '@/lib/panel/panelTree'
import {
  getProjectElectricalPanels,
  selectProjectAuxiliaryElectricalEnclosures,
} from '@/lib/projectV2/electrical'
import type { ProjectV2 } from '@/types/projectV2'

/**
 * Repairs virtual enclosures left behind by older deletions: an enclosure whose owner board
 * no longer exists moves to a main board, and slots of modules that no longer exist go.
 * Without an owner the panel canvas could show the enclosure but never accept a drop on it.
 */
export function healOrphanedAuxiliaryEnclosuresInProject(project: ProjectV2): boolean {
  const panels = getProjectElectricalPanels(project)
  const fallbackOwnerId = panels.find((panel) => panel.isMain)?.id ?? panels[0]?.id
  let changed = false
  for (const enclosure of selectProjectAuxiliaryElectricalEnclosures(project)) {
    if (
      fallbackOwnerId &&
      (!enclosure.ownerPanelId || !findPanelById(panels, enclosure.ownerPanelId))
    ) {
      enclosure.ownerPanelId = fallbackOwnerId
      changed = true
    }
    const slots = enclosure.gridView.slots.filter((slot) =>
      isPanelGridSlotModuleCurrent(project, slot.module)
    )
    if (slots.length !== enclosure.gridView.slots.length) {
      const removed = new Set(
        enclosure.gridView.slots
          .filter((slot) => !slots.includes(slot))
          .map((slot) => panelGridModuleRefKey(slot.module))
      )
      enclosure.gridView.slots = slots
      if (enclosure.gridView.shownModuleKeys) {
        enclosure.gridView.shownModuleKeys = enclosure.gridView.shownModuleKeys.filter(
          (key) => !removed.has(key)
        )
      }
      changed = true
    }
  }
  return changed
}
