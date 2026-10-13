import { getSupplyFeedDevicesForPanel } from '@/lib/feedTopology'
import {
  getCircuitConverterDcConnectionCount,
  supportsCircuitConverterDcConnections,
} from '@/lib/layout/circuitConverterGeometry'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import {
  clampConverterDcConnectionCount,
  collapsePrimaryBranchIntoMultiplier,
  getNestedSupplyConverterBranchDevices,
  getOrdinaryConverterResizeEndpointIds,
  getOrdinaryConverterResizeTrunkDeviceIds,
  getSupplyConverterResizeDeviceIds,
  isDcBusConverterEndpoint,
  moveOrdinaryConverterDcBusesToLastOutput,
  promoteDcBusConverterEndpoint,
  resizeNestedOrdinaryConverterOwnership,
} from '@/lib/eendraad/resizeConverterDcConnections'
import type { ProjectV2 } from '@/types/projectV2'
import { walkPanels } from '@/lib/panel/panelTree'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { findSupplyDeviceContainer } from '@/lib/eendraad/projectElectricalDomain'
import { updateCircuitInProject } from '@/lib/eendraad/circuitMutations'
import { deleteEndpointsFromProject } from '@/lib/eendraad/endpointDeletion'
import { updateSupplyTrunkDeviceInProject } from '@/lib/projectMutations/storeActions'
import { updateCircuitTrunkPropertiesInProject } from './electricalPropertyMutations'
import {
  deleteTrunkDeviceInProject,
  deleteSupplyTrunkDeviceInProject,
} from '@/lib/eendraad/deviceDeletion'

/** Resize a converter and remove everything owned by lanes that disappear. */
export function resizeConverterDcConnectionsInProject(
  project: ProjectV2,
  deviceId: string,
  requestedCount: number
): boolean {
  const panels = getProjectElectricalPanels(project)
  const circuits = [...walkPanels(panels)].flatMap((p) => [
    ...p.circuits,
    ...p.protections.flatMap((d) => d.circuits ?? []),
  ])
  const operations = {
    currentProject: project,
    getTrunkDeviceById: (id: string) => {
      const circuit = circuits.find(
        (c) =>
          c.trunkDevices?.some((d) => d.id === id) ||
          c.branches?.some((b) => b.branchDevices?.some((d) => d.id === id))
      )
      const device =
        circuit?.trunkDevices?.find((d) => d.id === id) ??
        circuit?.branches?.flatMap((b) => b.branchDevices ?? []).find((d) => d.id === id) ??
        queryAllSupplyTrunkDevices(project).find((d) => d.id === id)
      const container = findSupplyDeviceContainer(project, id)
      return device
        ? {
            device,
            circuit,
            isSupplyDevice: !circuit,
            supplyPanelId: container?.panelId,
            supplyFeedScope: container?.scope,
          }
        : undefined
    },
    getEndpointById: (id: string) => circuits.flatMap((c) => c.endpoints).find((e) => e.id === id),
    findCircuitForEndpoint: (id: string) => {
      const circuit = circuits.find((c) => c.endpoints.some((e) => e.id === id))
      return circuit ? { circuit } : undefined
    },
    perform: (apply: () => boolean) => apply(),
    updateCircuit: (id: string, set: Parameters<typeof updateCircuitInProject>[2]) =>
      updateCircuitInProject(project, id, set),
    deleteEndpoints: (ids: string[]) => deleteEndpointsFromProject(project, ids),
    deleteTrunkDevice: (circuitId: string, id: string) =>
      deleteTrunkDeviceInProject(project, circuitId, id),
    deleteSupplyTrunkDevice: (id: string) => deleteSupplyTrunkDeviceInProject(project, id),
    updateTrunkDevice: (
      circuitId: string,
      id: string,
      set: Parameters<typeof updateCircuitTrunkPropertiesInProject>[3]
    ) => updateCircuitTrunkPropertiesInProject(project, circuitId, id, set),
    updateSupplyTrunkDevice: (
      id: string,
      set: Parameters<typeof updateSupplyTrunkDeviceInProject>[2]
    ) => updateSupplyTrunkDeviceInProject(project, id, set),
  }
  const found = operations.getTrunkDeviceById(deviceId)
  const device = found?.device
  const newCount = clampConverterDcConnectionCount(requestedCount)

  if (!found || !device || !supportsCircuitConverterDcConnections(device)) {
    const endpoint = operations.getEndpointById(deviceId)
    const endpointOwner = endpoint ? operations.findCircuitForEndpoint(deviceId) : undefined
    if (!isDcBusConverterEndpoint(endpoint) || !endpointOwner || newCount <= 1) return false
    const migrated = promoteDcBusConverterEndpoint(endpointOwner.circuit, endpoint.id, newCount)
    if (!migrated) return false
    return operations.perform(() => {
      operations.updateCircuit(endpointOwner.circuit.id, {
        endpoints: migrated.endpoints,
        branches: migrated.branches,
      })
      return true
    })
  }

  const previousCount = getCircuitConverterDcConnectionCount(device)
  if (newCount === previousCount) return false
  return operations.perform(() => {
    const conversionProps = { ...(device.conversionProps ?? {}), dcConnectionCount: newCount }

    if (found.circuit) {
      const isNestedDcBusConverter = (found.circuit.branches ?? []).some((branch) =>
        branch.branchDevices?.some((candidate) => candidate.id === deviceId)
      )
      const resizedCircuit = isNestedDcBusConverter
        ? resizeNestedOrdinaryConverterOwnership(found.circuit, deviceId, newCount)
        : moveOrdinaryConverterDcBusesToLastOutput(found.circuit, deviceId, previousCount, newCount)
      // Only the main-bus (non-nested) converter renders its first branch as an
      // in-line lane-zero chain, so that is the only case that grows the broken
      // horizontal wires when parallel branches are present.
      const collapsedCircuit = isNestedDcBusConverter
        ? resizedCircuit
        : (collapsePrimaryBranchIntoMultiplier(resizedCircuit, deviceId, newCount) ??
          resizedCircuit)
      if (collapsedCircuit !== found.circuit) {
        operations.updateCircuit(found.circuit.id, {
          trunkDevices: collapsedCircuit.trunkDevices,
          endpoints: collapsedCircuit.endpoints,
          branches: collapsedCircuit.branches,
        })
      }
      const endpointIds = getOrdinaryConverterResizeEndpointIds(
        collapsedCircuit,
        deviceId,
        newCount
      )
      if (endpointIds.length > 0) operations.deleteEndpoints(endpointIds)
      const trunkDeviceIds = getOrdinaryConverterResizeTrunkDeviceIds(
        collapsedCircuit,
        deviceId,
        newCount
      )
      trunkDeviceIds.forEach((trunkDeviceId) =>
        operations.deleteTrunkDevice(found.circuit!.id, trunkDeviceId)
      )
      operations.updateTrunkDevice(found.circuit.id, deviceId, { conversionProps })
      return true
    }

    if (found.isSupplyDevice && operations.currentProject) {
      const installation = getProjectElectricalInstallation(operations.currentProject)
      const panels = getProjectElectricalPanels(operations.currentProject)
      if (!installation) return false
      const devices = getSupplyFeedDevicesForPanel(
        installation,
        panels,
        found.supplyPanelId ?? panels[0]?.id ?? '',
        found.supplyFeedScope ?? 'root'
      )
      if (device.supplyDcBusId) {
        const branchDevices = getNestedSupplyConverterBranchDevices(devices, device)
        const converterIndex = branchDevices.findIndex((candidate) => candidate.id === deviceId)
        const downstream = branchDevices.slice(converterIndex + 1)
        for (const candidate of downstream) {
          const connection = candidate.converterDcConnection
          if (connection?.converterId === deviceId && connection.connectionIndex >= newCount) {
            operations.deleteSupplyTrunkDevice(candidate.id)
          } else if (newCount === 1 && connection?.converterId === deviceId) {
            operations.updateSupplyTrunkDevice(candidate.id, {
              converterDcConnection: undefined,
            })
          } else if (newCount > 1 && !connection) {
            operations.updateSupplyTrunkDevice(candidate.id, {
              converterDcConnection: { converterId: deviceId, connectionIndex: 0 },
            })
          }
        }
        operations.updateSupplyTrunkDevice(deviceId, { conversionProps })
        return true
      }
      const removedDeviceIds = getSupplyConverterResizeDeviceIds(devices, deviceId, newCount)
      removedDeviceIds.forEach((removedDeviceId) =>
        operations.deleteSupplyTrunkDevice(removedDeviceId)
      )
      operations.updateSupplyTrunkDevice(deviceId, { conversionProps })
      return true
    }

    return false
  })
}
