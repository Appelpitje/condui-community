import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  editProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { setPanelFeedOrganizationInProject } from '@/lib/panel/panelFeedOrganization'
import {
  reconcileChangeoverSupplyAssembly,
  reconcileDirectConverterGridProtections,
  reconcileSupplyAssemblyBranchProtections,
} from './editorIntegration'
import type { SupplyNode } from '@/types/supplyAssembly'

function isInverterUnitNode(
  node: SupplyNode
): node is Extract<SupplyNode, { kind: 'inverter-unit' }> {
  return node.kind === 'inverter-unit'
}

/**
 * Intentionally isolate one supply inverter from the grid while retaining its backup output.
 * The marker lives on both the canonical trunk device and its graph node so reconciliation
 * cannot mistake the absent connection for incomplete legacy data.
 */
export function disconnectSupplyInverterGridInputInProject(
  project: ProjectWithOptionalV2Electrical,
  assemblyId: string,
  panelId: string
): boolean {
  const installation = getProjectElectricalInstallation(project)
  const panels = getProjectElectricalPanels(project)
  let assembly = editProjectSupplyAssemblies(project).find(
    (candidate) => candidate.id === assemblyId
  )
  if (!installation || !assembly) return false

  let inverterNode = assembly.nodes
    .filter(isInverterUnitNode)
    .find((node) => node.symbol === 'inverter')
  if (!inverterNode) return false
  const inverterNodeId = inverterNode.id
  const inverterDeviceId = inverterNode.deviceId ?? inverterNode.id

  let topology = ensureInstallationFeedTopology(installation, panels)
  let rootFeed = topology.rootFeeds.find((feed) => feed.panelId === panelId)
  let inverter = rootFeed?.trunkDevices?.find((device) => device.id === inverterDeviceId)
  if (!rootFeed || !inverter || inverter.symbol !== 'inverter') return false

  // Use the exact graph being edited. Panel-target discovery can be ambiguous while a
  // single-feed assembly is transitioning, but the selected connection's assembly is not.
  const hasModularChangeover = assembly.nodes.some(
    (node) => node.kind === 'changeover-switch'
  )
  // A direct inverter needs a dedicated backup bus once its grid input is gone.
  // A modular changeover already combines grid and backup into one valid output,
  // so preserve whichever single/split panel organization the user already chose.
  if (
    !hasModularChangeover &&
    inverter.converterAcConnection !== 'separate' &&
    !setPanelFeedOrganizationInProject(project, panelId, 'split-backup')
  ) {
    return false
  }

  // Split-feed setup may normalize/replace topology records. Resolve the canonical
  // records again before persisting the intentional disconnect.
  assembly = editProjectSupplyAssemblies(project).find(
    (candidate) => candidate.id === assemblyId
  )
  topology = ensureInstallationFeedTopology(installation, panels)
  rootFeed = topology.rootFeeds.find((feed) => feed.panelId === panelId)
  inverter = rootFeed?.trunkDevices?.find((device) => device.id === inverterDeviceId)
  inverterNode = assembly?.nodes
    .filter(isInverterUnitNode)
    .find((node) => node.id === inverterNodeId)
  if (!assembly || !rootFeed || !inverter || !inverterNode) return false

  inverter.converterGridInputConnected = false
  inverterNode.properties.gridInputConnected = false

  const removedDeviceIds = new Set(
    (rootFeed.trunkDevices ?? [])
      .filter((device) => device.supplyPath === 'converter-grid')
      .map((device) => device.id)
  )
  rootFeed.trunkDevices = (rootFeed.trunkDevices ?? []).filter(
    (device) => !removedDeviceIds.has(device.id)
  )
  rootFeed.trunkDevices.forEach((device, index) => {
    device.trunkPosition = index
  })
  assembly.nodes = assembly.nodes.filter((node) => !removedDeviceIds.has(node.id))
  assembly.connections = assembly.connections.filter(
    (connection) =>
      connection.pathRole !== 'inverter-grid-ac' &&
      !connection.endpoints.some((endpoint) => removedDeviceIds.has(endpoint.nodeId))
  )
  if (assembly.oneWireGeometry?.connectionWaypoints) {
    const remainingConnectionIds = new Set(assembly.connections.map(({ id }) => id))
    for (const connectionId of Object.keys(assembly.oneWireGeometry.connectionWaypoints)) {
      if (!remainingConnectionIds.has(connectionId)) {
        delete assembly.oneWireGeometry.connectionWaypoints[connectionId]
      }
    }
  }

  if (hasModularChangeover) {
    reconcileSupplyAssemblyBranchProtections(project, panelId)
    // A changeover fed from this leg falls back to the grid tap: realign its switched
    // conductors with the grid instead of the inverter.
    const changeover = topology.rootFeeds
      .filter((feed) => feed.panelId === panelId)
      .flatMap((feed) => feed.trunkDevices ?? [])
      .find((device) => device.symbol === 'source_changeover')
    if (changeover) reconcileChangeoverSupplyAssembly(project, changeover)
  } else {
    reconcileDirectConverterGridProtections(project, panelId)
  }
  return true
}
