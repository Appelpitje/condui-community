import type { Endpoint, Installation, ProtectionDevice, TrunkDevice } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { panelHasModularChangeover } from '@/lib/panel/panelFeedOrganization'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { collectAllGroundTrunkDevices } from './panelGround'
import { getAllCircuits, getAllProtections } from './projectElectricalDomain'

export type WireRenderLookup = {
  endpoints: Map<string, Endpoint>
  protections: Map<string, ProtectionDevice>
  trunkDevices: Map<string, TrunkDevice>
  modularChangeoverPanels: Set<string>
  phaseSystem: Installation['nominalVoltage']['system'] | undefined
}

const wireRenderLookupCache = new WeakMap<ProjectV2, WireRenderLookup>()

/** Complete lookup for the immutable project snapshot used by the one-wire renderer. */
export function getWireRenderLookup(project: ProjectV2): WireRenderLookup {
  const cached = wireRenderLookupCache.get(project)
  if (cached) return cached

  const endpoints = new Map<string, Endpoint>()
  const protections = new Map<string, ProtectionDevice>()
  const trunkDevices = new Map<string, TrunkDevice>()
  const branchDevices: TrunkDevice[] = []
  const modularChangeoverPanels = new Set<string>()
  const panels = getProjectElectricalPanels(project)
  for (const rootPanel of panels) {
    for (const circuit of getAllCircuits(rootPanel)) {
      for (const endpoint of circuit.endpoints) endpoints.set(endpoint.id, endpoint)
      for (const device of circuit.trunkDevices ?? []) trunkDevices.set(device.id, device)
      for (const branch of circuit.branches ?? []) {
        branchDevices.push(...(branch.branchDevices ?? []))
      }
    }
    for (const protection of getAllProtections(rootPanel)) {
      protections.set(protection.id, protection)
    }
  }
  const installation = getProjectElectricalInstallation(project)
  for (const device of installation?.mainSupply?.supplyTrunkDevices ?? []) {
    trunkDevices.set(device.id, device)
  }
  for (const device of collectAllGroundTrunkDevices(panels, installation)) {
    trunkDevices.set(device.id, device)
  }

  // Retain the renderer's existing winners for malformed duplicate IDs. These
  // additional owners previously used the store fallback only after an index
  // miss, with supply devices taking precedence over branch devices.
  for (const device of getAllSupplyTrunkDevices(project)) {
    if (!trunkDevices.has(device.id)) trunkDevices.set(device.id, device)
  }
  for (const device of branchDevices) {
    if (!trunkDevices.has(device.id)) trunkDevices.set(device.id, device)
  }
  for (const panel of panels) {
    if (panelHasModularChangeover(project, panel.id)) modularChangeoverPanels.add(panel.id)
  }

  const lookup = {
    endpoints,
    protections,
    trunkDevices,
    modularChangeoverPanels,
    phaseSystem: installation?.nominalVoltage.system,
  }
  wireRenderLookupCache.set(project, lookup)
  return lookup
}
