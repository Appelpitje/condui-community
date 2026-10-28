import { findGroundTrunkDeviceOwner } from '@/lib/eendraad/panelGround'
import { findSupplyDeviceContainer, getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from './electrical'

/** Shared read order for editor selectors and captured electrical snapshots. */
export function findProjectTrunkDevice(project: ProjectWithOptionalV2Electrical, deviceId: string) {
  // Check shared/root supply trunk devices first.
  const supplyContainer = findSupplyDeviceContainer(project, deviceId)
  const supplyDevice = supplyContainer?.devices.find((device) => device.id === deviceId)
  if (supplyDevice) {
    return { device: supplyDevice, circuit: null, isSupplyDevice: true,
      supplyFeedScope: supplyContainer?.scope, supplyPanelId: supplyContainer?.panelId }
  }
  const installation = getProjectElectricalInstallation(project)
  const groundOwner = findGroundTrunkDeviceOwner(getProjectElectricalPanels(project), installation, deviceId)
  if (groundOwner) {
    return { device: groundOwner.devices[groundOwner.index]!, circuit: null, isGroundDevice: true }
  }
  for (const panel of getProjectElectricalPanels(project)) {
    for (const circuit of getAllCircuits(panel)) {
      const device = circuit.trunkDevices?.find((entry) => entry.id === deviceId) ??
        circuit.branches?.flatMap((branch) => branch.branchDevices ?? []).find((entry) => entry.id === deviceId)
      if (device) return { device, circuit, isSupplyDevice: false }
    }
  }
  return undefined
}
