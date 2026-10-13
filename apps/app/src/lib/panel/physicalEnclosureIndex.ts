import {
  indexCircuitElementEnclosures,
  isFieldEnclosureKey,
} from '@/lib/layout/circuitEnclosureTransitions'
import {
  getKnownSupplyDeviceIds,
  resolveSupplyDeviceMounting,
} from '@/lib/panel/auxiliarySupplyEnclosures'
import {
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { getSupplyNodePhysicalDeviceId } from '@/lib/supplyAssembly/electricalTopology'
import type { ElectricalEnclosureRef } from '@/types/supplyAssembly'

/** Enclosure key of the grid connection (supply devices mounted before any board). */
export const GRID_ENCLOSURE_KEY = 'grid'

const enclosureKey = (mounting: ElectricalEnclosureRef): string =>
  mounting.kind === 'grid'
    ? GRID_ENCLOSURE_KEY
    : mounting.kind === 'panel'
      ? `panel:${mounting.panelId}`
      : `auxiliary:${mounting.enclosureId}`

/**
 * Where every protection, circuit element and supply device physically hangs, keyed by its id:
 * `panel:<id>`, `auxiliary:<id>` (a virtual enclosure), `junction:<identity>` (a junction panel)
 * or `grid`. Field elements (lights, switches, junction boxes) are absent.
 */
export function indexPhysicalEnclosures(
  project: ProjectWithOptionalV2Electrical
): Map<string, string> {
  const result = new Map<string, string>()
  for (const [elementId, key] of indexCircuitElementEnclosures(getProjectElectricalPanels(project)))
    if (!isFieldEnclosureKey(key)) result.set(elementId, key)
  for (const deviceId of getKnownSupplyDeviceIds(project)) {
    if (result.has(deviceId)) continue
    const mounting = resolveSupplyDeviceMounting(project, deviceId)
    if (mounting) result.set(deviceId, enclosureKey(mounting))
  }
  // Inverters, batteries and other supply assembly devices hang where their node is mounted.
  for (const assembly of selectProjectSupplyAssemblies(project)) {
    for (const node of assembly.nodes) {
      const deviceId = getSupplyNodePhysicalDeviceId(node)
      const mounting = node.mounting?.enclosure
      if (deviceId && mounting && !result.has(deviceId))
        result.set(deviceId, enclosureKey(mounting))
    }
  }
  return result
}
