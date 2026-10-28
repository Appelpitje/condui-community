import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  editProjectSupplyAssemblies,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { getInstallationPhases } from '@/lib/wires/phaseAssignment'

import type { AcPhase, TrunkDevice } from '@/types/schema'
import type {
  OffGridSupplyAssembly,
  SupplyConnection,
  SupplyConductor,
  SupplyNode,
} from '@/types/supplyAssembly'
import {
  getSupplyConverterAcConductors,
  getSupplyInverterUnitPhaseAssignments,
} from './supplyConverterPhases'

import { getSupplyNodePhysicalDeviceId, resolveAssemblyPanelInput } from './electricalTopology'

import { resolveEffectiveChangeoverGridSource } from './changeoverGridSource'

export function isInverterUnitNode(
  node: SupplyNode
): node is Extract<SupplyNode, { kind: 'inverter-unit' }> {
  return node.kind === 'inverter-unit'
}

export function acConductors(project: ProjectWithOptionalV2Electrical): AcPhase[] {
  const system = getProjectElectricalInstallation(project)?.nominalVoltage.system
  const phases = getInstallationPhases(system ?? '1N~')
  return phases.length > 0 ? phases : ['L1', 'N']
}

export function changeoverConductors(device: TrunkDevice, available: AcPhase[]): AcPhase[] {
  const config = device.polesConfig
  if (!config && device.poles == null) return [...available]
  const linePhases = available.filter(
    (phase): phase is Extract<AcPhase, 'L1' | 'L2' | 'L3'> =>
      phase === 'L1' || phase === 'L2' || phase === 'L3'
  )
  const hasNeutral = available.includes('N')
  if (config === '1P') return linePhases.slice(0, 1)
  if (config === '1P+N' || (config === '2P' && hasNeutral)) {
    return [...linePhases.slice(0, 1), ...(hasNeutral ? (['N'] as const) : [])]
  }
  if (config === '2P') return linePhases.slice(0, 2)
  if (config === '3P') return linePhases.slice(0, 3)
  if (config === '3P+N' || config === '4P') return [...available]
  const poles = Math.max(1, Math.min(4, device.poles ?? available.length))
  if (hasNeutral && poles === 2) return [...linePhases.slice(0, 1), 'N']
  if (hasNeutral && poles >= 4) return [...available]
  return linePhases.slice(0, poles)
}

export const AC_CONDUCTOR_ORDER: AcPhase[] = ['L1', 'L2', 'L3', 'N', 'PE']

export function orderedAcConductors(conductors: Iterable<SupplyConductor>): AcPhase[] {
  return Array.from(
    new Set(
      Array.from(conductors).filter(
        (conductor): conductor is AcPhase => conductor !== 'DC+' && conductor !== 'DC-'
      )
    )
  ).sort((left, right) => AC_CONDUCTOR_ORDER.indexOf(left) - AC_CONDUCTOR_ORDER.indexOf(right))
}

export function intersectAcConductors(available: AcPhase[], capability: AcPhase[]): AcPhase[] {
  const intersection = available.filter((conductor) => capability.includes(conductor))
  // A neutral on its own is not an energized AC path.
  return intersection.some(
    (conductor) => conductor === 'L1' || conductor === 'L2' || conductor === 'L3'
  )
    ? orderedAcConductors(intersection)
    : []
}

export function applyProtectionConductorLimit(
  available: AcPhase[],
  protection: Pick<TrunkDevice, 'polesConfig' | 'poles'>
): AcPhase[] {
  return changeoverConductors(protection as TrunkDevice, available)
}

export function getAssemblyPanelId(
  assembly: OffGridSupplyAssembly,
  project?: ProjectWithOptionalV2Electrical
): string | undefined {
  if (project) {
    const input = resolveAssemblyPanelInput(project, assembly.incomingAttachment)
    if (input) return input.panelId
  }
  if (
    assembly.incomingAttachment.kind === 'panel-input' ||
    assembly.incomingAttachment.kind === 'panel-bus-input'
  ) {
    return assembly.incomingAttachment.panelId
  }
  const panelHandoff = assembly.loadHandoffs.find(
    (handoff) => handoff.target.kind === 'panel-input' || handoff.target.kind === 'panel-bus-input'
  )
  return panelHandoff?.target.kind === 'panel-input' ||
    panelHandoff?.target.kind === 'panel-bus-input'
    ? panelHandoff.target.panelId
    : undefined
}

/**
 * Conductors available at the utility node after every serial shared/root protection.
 * Branch protections are deliberately excluded: they narrow only their own path below.
 */
export function getAssemblyUtilityConductors(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): AcPhase[] {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return acConductors(project)
  const topology = ensureInstallationFeedTopology(installation, getProjectElectricalPanels(project))
  const root = topology.rootFeeds.find((feed) => feed.panelId === panelId)
  const upstreamDevices = [
    ...(topology.sharedFeed.trunkDevices ?? []),
    ...(root?.trunkDevices ?? []),
  ]
  const owningAssembly = selectProjectSupplyAssemblies(project).find(
    (assembly) => getAssemblyPanelId(assembly, project) === panelId
  )
  const boundary = upstreamDevices.findIndex((device) =>
    owningAssembly?.nodes.some((node) => getSupplyNodePhysicalDeviceId(node) === device.id)
  )
  // A switched assembly's serial load protections are part of the common load
  // path and must remain visible to the phase projection. A direct converter's
  // post-split protections belong only to its panel fan-out and must not narrow
  // the converter's grid branch.
  const phaseSourceDevices = owningAssembly?.nodes.some((node) => node.kind === 'changeover-switch')
    ? upstreamDevices
    : boundary < 0
      ? upstreamDevices
      : upstreamDevices.slice(0, boundary)
  const serialProtections = phaseSourceDevices.filter(
    (device) =>
      device.type === 'protection' &&
      device.symbol !== 'relay' &&
      (device.supplyPath == null || device.supplyPath === 'serial')
  )
  return serialProtections.reduce(
    (available, device) => applyProtectionConductorLimit(available, device),
    acConductors(project)
  )
}

/**
 * Recompute every AC connection from its real upstream source. This is intentionally a
 * monotonic flow pass: a later wider protection can never restore phases removed earlier.
 * Grid and backup inputs remain independent until the changeover load port combines them.
 */
export function reconcileSupplyAssemblyAcConductorFlow(
  project: ProjectWithOptionalV2Electrical,
  panelId?: string
): boolean {
  const assemblies = editProjectSupplyAssemblies(project).filter(
    (assembly) => !panelId || getAssemblyPanelId(assembly, project) === panelId
  )
  if (assemblies.length === 0) return false
  const installation = getProjectElectricalInstallation(project)
  const topology = installation
    ? ensureInstallationFeedTopology(installation, getProjectElectricalPanels(project))
    : undefined
  let changed = false

  for (const assembly of assemblies) {
    const ownerPanelId = getAssemblyPanelId(assembly, project)
    if (!ownerPanelId) continue
    const previous = JSON.stringify(assembly)
    const nodesById = new Map(assembly.nodes.map((node) => [node.id, node]))
    const state = new Map<string, AcPhase[]>()
    const key = (nodeId: string, portId: string) => `${nodeId}\u0000${portId}`
    const endpointFlowScore = (
      endpoint: SupplyConnection['endpoints'][number],
      pathRole: SupplyConnection['pathRole']
    ): number => {
      const node = nodesById.get(endpoint.nodeId)
      const candidate = node?.ports.find((portCandidate) => portCandidate.id === endpoint.portId)
      if (!node || !candidate) return 0
      if (pathRole === 'inverter-backup-ac' && candidate.role === 'inverter-backup-ac') return 20
      if (pathRole === 'load-ac' && candidate.role === 'load-ac') return 20
      if (
        (pathRole === 'grid-ac' || pathRole === 'inverter-grid-ac') &&
        candidate.role === 'utility-ac'
      ) {
        return 20
      }
      if (candidate.role === 'serial-load-side') return 10
      if (candidate.role === 'serial-source-side') return -10
      if (
        candidate.role === 'source-grid-ac' ||
        candidate.role === 'source-backup-ac' ||
        candidate.role === 'panel-handoff' ||
        candidate.role === 'inverter-grid-ac'
      ) {
        return -20
      }
      return candidate.behavior === 'source' ? 5 : candidate.behavior === 'sink' ? -5 : 0
    }
    const setState = (nodeId: string, portId: string, conductors: AcPhase[]): boolean => {
      const stateKey = key(nodeId, portId)
      const next = orderedAcConductors([...(state.get(stateKey) ?? []), ...conductors])
      const current = state.get(stateKey) ?? []
      if (next.join('|') === current.join('|')) return false
      state.set(stateKey, next)
      return true
    }

    const inverterCapabilities = new Map<string, AcPhase[]>()
    for (const group of assembly.inverterGroups) {
      const baseNode = assembly.nodes.find((node) => node.id === group.unitNodeIds[0])
      const deviceId = baseNode?.deviceId ?? baseNode?.id
      const converter = topology?.rootFeeds
        .flatMap((feed) => feed.trunkDevices ?? [])
        .find((device) => device.id === deviceId)
      if (!converter) continue
      const assignments = getSupplyInverterUnitPhaseAssignments(
        converter,
        installation?.nominalVoltage.system ?? '1N~',
        group.unitNodeIds.length
      )
      group.unitNodeIds.forEach((nodeId, index) => {
        inverterCapabilities.set(nodeId, orderedAcConductors(assignments[index]?.phases ?? []))
      })
    }

    // A converter grid-input leg carries only the conductors its converter units use,
    // from the split onward. This matters where the leg also feeds a changeover grid
    // input through a tap: that port receives the leg's conductors, not the grid's.
    const inverterLegCapabilities = new Map<string, AcPhase[]>()
    const legCapabilityFrom = (
      nodeId: string,
      visited: ReadonlySet<string>
    ): AcPhase[] | undefined => {
      const node = nodesById.get(nodeId)
      if (!node || visited.has(nodeId)) return undefined
      if (node.kind === 'inverter-unit') return inverterCapabilities.get(node.id)
      const downstream = assembly.connections.filter(
        (candidate) =>
          candidate.domain === 'AC' &&
          candidate.pathRole === 'inverter-grid-ac' &&
          candidate.endpoints[0].nodeId === nodeId
      )
      if (downstream.length === 0) return undefined
      const nextVisited = new Set([...visited, nodeId])
      const capabilities = downstream.map((candidate) =>
        legCapabilityFrom(candidate.endpoints[1].nodeId, nextVisited)
      )
      if (capabilities.some((capability) => !capability)) return undefined
      return orderedAcConductors(capabilities.flatMap((capability) => capability ?? []))
    }
    for (const candidate of assembly.connections) {
      if (candidate.domain !== 'AC' || candidate.pathRole !== 'inverter-grid-ac') continue
      const capability = legCapabilityFrom(candidate.endpoints[1].nodeId, new Set())
      if (capability) inverterLegCapabilities.set(candidate.id, capability)
    }

    const utilityConductors = getAssemblyUtilityConductors(project, ownerPanelId)
    for (const utility of assembly.nodes.filter((node) => node.kind === 'utility-source')) {
      for (const utilityPort of utility.ports.filter((candidate) => candidate.domain === 'AC')) {
        utilityPort.conductors = [...utilityConductors]
        setState(utility.id, utilityPort.id, utilityConductors)
      }
    }
    for (const inverter of assembly.nodes.filter(isInverterUnitNode)) {
      const capability = inverterCapabilities.get(inverter.id)
      if (!capability) continue
      const backupPort = inverter.ports.find((candidate) => candidate.role === 'inverter-backup-ac')
      if (backupPort) {
        backupPort.conductors = [...capability]
        setState(inverter.id, backupPort.id, capability)
      }
    }

    // Connections are persisted in source-to-load order. Iterate to a fixed point so
    // parallel inverter units can merge before a shared protection narrows their union.
    for (
      let iteration = 0;
      iteration < assembly.nodes.length + assembly.connections.length + 4;
      iteration++
    ) {
      let progressed = false

      for (const node of assembly.nodes) {
        if (node.kind === 'protection') {
          const sourcePort = node.ports.find((candidate) => candidate.id === 'source')
          const loadPort = node.ports.find((candidate) => candidate.id === 'load')
          const incoming = sourcePort ? state.get(key(node.id, sourcePort.id)) : undefined
          if (!sourcePort || !loadPort || !incoming?.length) continue
          sourcePort.conductors = [...incoming]
          const outgoing = applyProtectionConductorLimit(incoming, node.properties)
          loadPort.conductors = [...outgoing]
          progressed = setState(node.id, loadPort.id, outgoing) || progressed
        } else if (node.kind === 'ac-distribution') {
          // Serial branch devices (meters, junctions, and legacy protection snapshots)
          // are often persisted with `passive` behavior on both ports. Their roles are
          // the authoritative direction in that case: source-side receives the feed and
          // load-side passes it onward. Without this fallback, a stale empty load port
          // breaks the entire backup route and makes the feed organization appear
          // unavailable after reload.
          const inputPorts = node.ports.filter(
            (candidate) =>
              candidate.domain === 'AC' &&
              (candidate.behavior === 'sink' || candidate.role === 'serial-source-side')
          )
          const outputPorts = node.ports.filter(
            (candidate) =>
              candidate.domain === 'AC' &&
              candidate.role !== 'serial-source-side' &&
              (candidate.role === 'serial-load-side' || candidate.behavior !== 'sink')
          )
          const incoming = orderedAcConductors(
            inputPorts.flatMap((candidate) => state.get(key(node.id, candidate.id)) ?? [])
          )
          for (const outputPort of outputPorts) {
            outputPort.conductors = [...incoming]
            progressed = setState(node.id, outputPort.id, incoming) || progressed
          }
        } else if (node.kind === 'changeover-switch') {
          const gridPort = node.ports.find((candidate) => candidate.id === 'grid')
          const backupPort = node.ports.find((candidate) => candidate.id === 'backup')
          const loadPort = node.ports.find((candidate) => candidate.id === 'load')
          if (!loadPort) continue
          const switched = orderedAcConductors(node.properties.switchedConductors)
          const available = orderedAcConductors([
            ...(gridPort ? (state.get(key(node.id, gridPort.id)) ?? []) : []),
            ...(backupPort ? (state.get(key(node.id, backupPort.id)) ?? []) : []),
          ])
          const outgoing = intersectAcConductors(available, switched)
          loadPort.conductors = [...outgoing]
          progressed = setState(node.id, loadPort.id, outgoing) || progressed
        }
      }

      for (const candidate of assembly.connections.filter(
        (connection) => connection.domain === 'AC'
      )) {
        const [first, second] = candidate.endpoints
        const [from, to] =
          endpointFlowScore(first, candidate.pathRole) >=
          endpointFlowScore(second, candidate.pathRole)
            ? [first, second]
            : [second, first]
        const available = state.get(key(from.nodeId, from.portId))
        if (!available?.length) continue
        const targetNode = nodesById.get(to.nodeId)
        let delivered = available
        const legCapability = inverterLegCapabilities.get(candidate.id)
        if (legCapability) delivered = intersectAcConductors(delivered, legCapability)
        if (targetNode?.kind === 'inverter-unit') {
          const capability = inverterCapabilities.get(targetNode.id)
          if (capability) delivered = intersectAcConductors(available, capability)
        } else if (targetNode?.kind === 'changeover-switch') {
          delivered = intersectAcConductors(
            available,
            orderedAcConductors(targetNode.properties.switchedConductors)
          )
        }
        candidate.conductors = [...delivered]
        progressed = setState(to.nodeId, to.portId, delivered) || progressed
      }
      if (!progressed) break
    }

    for (const node of assembly.nodes) {
      for (const candidate of node.ports.filter((portCandidate) => portCandidate.domain === 'AC')) {
        const resolved = state.get(key(node.id, candidate.id))
        candidate.conductors = resolved ? [...resolved] : orderedAcConductors(candidate.conductors)
      }
    }
    for (const handoff of assembly.loadHandoffs) {
      const handoffNode = nodesById.get(handoff.handoffNodeId)
      const conductors = orderedAcConductors(
        handoffNode?.ports
          .filter((candidate) => candidate.domain === 'AC')
          .flatMap((candidate) => state.get(key(handoffNode.id, candidate.id)) ?? []) ?? []
      )
      if (conductors.length > 0) handoff.conductors = conductors
    }
    changed ||= JSON.stringify(assembly) !== previous
  }
  return changed
}

/**
 * Conductors that can reach a changeover's inputs. Fed from the converter's grid-input leg,
 * both inputs carry only the converter's conductors; otherwise the grid's.
 */
export function getChangeoverAvailableConductors(
  project: ProjectWithOptionalV2Electrical,
  assembly: OffGridSupplyAssembly,
  changeover: TrunkDevice
): AcPhase[] {
  const available = acConductors(project)
  const installation = getProjectElectricalInstallation(project)
  const panelId = getAssemblyPanelId(assembly, project)
  if (!installation || !panelId || changeover.changeoverGridSource !== 'converter-input') {
    return available
  }
  const devices = (installation.feedTopology?.rootFeeds ?? [])
    .filter((feed) => feed.panelId === panelId)
    .flatMap((feed) => feed.trunkDevices ?? [])
  const converter = devices.find(
    (device) => device.supplyPath === 'backup' && device.type === 'conversion'
  )
  const panel = getProjectElectricalPanels(project).find((candidate) => candidate.id === panelId)
  if (
    !converter ||
    resolveEffectiveChangeoverGridSource({ changeover, converter, panel }) !== 'converter-input'
  ) {
    return available
  }
  const converterConductors = getSupplyConverterAcConductors(
    converter,
    installation.nominalVoltage.system
  ).filter((conductor) => available.includes(conductor))
  return converterConductors.length > 0 ? converterConductors : available
}
