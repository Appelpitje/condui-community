import type { ProjectV2 } from '@/types/projectV2'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { findPanelById } from './panelTree'
import { getDefaultPanelGridModuleRefs } from '@/lib/eendraad/projectElectricalDomain'
import { getPanelGridModulesInProject } from './panelGridModules'
import { panelGridModuleRefKey } from './panelGridLayout'

/** Includes eligible modules that have never been shown as well as explicitly hidden modules. */
export function getPanelModuleInventory(project: ProjectV2, panelId: string) {
  const panels = getProjectElectricalPanels(project)
  const panel = findPanelById(panels, panelId)
  if (!panel) return []
  const installation = getProjectElectricalInstallation(project)
  const supply = [
    ...(installation?.feedTopology?.sharedFeed.trunkDevices ??
      installation?.mainSupply.supplyTrunkDevices ??
      []),
    ...(installation?.feedTopology?.rootFeeds
      .filter((feed) => feed.panelId === panelId)
      .flatMap((feed) => feed.trunkDevices ?? []) ?? []),
  ]
  // Pass the stored supply inventory explicitly: the legacy default query may initialize topology.
  const eligible = getDefaultPanelGridModuleRefs(panel, installation, panels, supply)
  const visible = getPanelGridModulesInProject(project, panelId)
  const refs = new Map(
    [...eligible, ...visible.map(({ ref }) => ref)].map((ref) => [panelGridModuleRefKey(ref), ref])
  )
  return [...refs].map(([key, ref]) => {
    const shown = visible.find((module) => panelGridModuleRefKey(module.ref) === key)
    return {
      key,
      ref,
      visible: !!shown,
      slot: shown?.slot,
      inSupplyPanel: shown?.inSupplyPanel ?? false,
    }
  })
}
