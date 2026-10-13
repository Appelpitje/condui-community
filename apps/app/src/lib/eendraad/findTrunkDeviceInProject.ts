import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { walkPanels } from '@/lib/panel/panelTree'
import { findGroundTrunkDeviceOwner } from '@/lib/eendraad/panelGround'
import type { TrunkDevice } from '@/types/schema'

/** Trunk device anywhere in the canonical electrical project graph. */
export function findTrunkDeviceInProject(
  project: ProjectWithOptionalV2Electrical,
  id: string
): TrunkDevice | null {
  const supply = queryAllSupplyTrunkDevices(project).find((device) => device.id === id)
  if (supply) return supply

  const ground = findGroundTrunkDeviceOwner(
    getProjectElectricalPanels(project),
    getProjectElectricalInstallation(project),
    id
  )
  if (ground) return ground.devices[ground.index] ?? null

  for (const panel of walkPanels(getProjectElectricalPanels(project))) {
    const circuits = [
      ...(panel.circuits ?? []),
      ...(panel.protections ?? []).flatMap((protection) => protection.circuits ?? []),
    ]
    for (const circuit of circuits) {
      const device =
        circuit.trunkDevices?.find((candidate) => candidate.id === id) ??
        circuit.branches
          ?.flatMap((branch) => branch.branchDevices ?? [])
          .find((candidate) => candidate.id === id)
      if (device) return device
    }
  }
  return null
}
