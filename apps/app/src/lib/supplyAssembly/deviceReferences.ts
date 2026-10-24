import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'
import {
  selectProjectSupplyAssemblies,
  selectProjectElectricalInstallation,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { TrunkDevice } from '@/types/schema'
import type {
  OffGridSupplyAssembly,
  SupplyNode,
  SupplyProtectionProperties,
} from '@/types/supplyAssembly'

function protectionProperties(device: TrunkDevice): SupplyProtectionProperties {
  return {
    type: device.protectionType ?? 'MCB',
    ratingA: device.ratingA,
    curve: device.curve,
    sensitivityMa: device.sensitivityMa,
    residualCurrentType: device.residualCurrentType,
    selective: device.selective,
    superImmunized: device.superImmunized,
    breakingCapacityKa: device.breakingCapacityKa,
    breakingCapacityOption: device.breakingCapacityOption,
    surgeProtectionKind: device.surgeProtectionKind,
    polesConfig: device.polesConfig,
    poles: device.poles,
    notes: device.notes,
  }
}

function supplyDeviceIndex(
  project: ProjectWithOptionalV2Electrical
): ReadonlyMap<string, TrunkDevice> {
  return new Map(getAllSupplyTrunkDevices(project).map((device) => [device.id, device]))
}

export function resolveSupplyNodeDevice(
  project: ProjectWithOptionalV2Electrical,
  node: SupplyNode
): TrunkDevice | undefined {
  const deviceId = node.deviceId ?? node.id
  return supplyDeviceIndex(project).get(deviceId)
}

export function supplyNodeReferencesDevice(node: SupplyNode, deviceId: string): boolean {
  return node.deviceId === deviceId || (!node.deviceId && node.id === deviceId)
}

/** Assembly membership is independent of the frame used to draw its equipment. */
export function findSupplyInverterAssembly(
  project: ProjectWithOptionalV2Electrical,
  device: TrunkDevice
): OffGridSupplyAssembly | undefined {
  if (device.symbol !== 'inverter') return undefined
  return selectProjectSupplyAssemblies(project).find((assembly) =>
    assembly.nodes.some(
      (node) => node.kind === 'inverter-unit' && supplyNodeReferencesDevice(node, device.id)
    )
  )
}

/** Older direct supply assemblies are stored as root-feed devices without a graph. */
export function canConfigureSupplyInverterAcConnection(
  project: ProjectWithOptionalV2Electrical,
  device: TrunkDevice
): boolean {
  if (device.symbol !== 'inverter') return false
  if (findSupplyInverterAssembly(project, device)) return true
  return (selectProjectElectricalInstallation(project)?.feedTopology?.rootFeeds ?? []).some(
    (feed) => feed.trunkDevices?.some(
      (candidate) => candidate.id === device.id && candidate.symbol === 'inverter' &&
        candidate.supplyPath === 'converter-branch'
    )
  )
}

/**
 * Resolves physical presentation from the canonical device record. Graph nodes retain
 * only legacy fallback snapshots plus topology-specific ports and properties.
 */
export function resolveSupplyNodePresentation(
  project: ProjectWithOptionalV2Electrical,
  node: SupplyNode
): SupplyNode {
  const device = resolveSupplyNodeDevice(project, node)
  if (!device) return node
  const base = {
    ...node,
    deviceId: device.id,
    label: device.label,
    symbol: device.symbol,
  }
  if (node.kind === 'changeover-switch') {
    return {
      ...base,
      kind: node.kind,
      properties: {
        ...node.properties,
        port1Label: device.changeoverProps?.port1Label ?? '1',
        port2Label: device.changeoverProps?.port2Label ?? '2',
      },
    }
  }
  if (node.kind === 'inverter-unit') {
    const unitIndex = Math.max(
      0,
      selectProjectSupplyAssemblies(project)
        .flatMap((assembly) => assembly.inverterGroups)
        .find((group) => group.unitNodeIds.includes(node.id))
        ?.unitNodeIds.indexOf(node.id) ?? 0
    )
    return {
      ...base,
      kind: node.kind,
      label: unitIndex > 0 && device.label ? `${device.label} ${unitIndex + 1}` : device.label,
      properties: {
        ...node.properties,
        serialNumber:
          device.conversionProps?.serialNumbers?.[unitIndex] ??
          (unitIndex === 0 ? device.conversionProps?.serialNumber : undefined),
      },
    }
  }
  if (node.kind === 'battery') {
    return {
      ...base,
      kind: node.kind,
      properties: device.batteryProps ?? node.properties,
    }
  }
  if (node.kind === 'solar-source') {
    return {
      ...base,
      kind: node.kind,
      properties: device.solarPanelProps ?? node.properties,
    }
  }
  if (node.kind === 'protection') {
    return {
      ...base,
      kind: node.kind,
      properties: protectionProperties(device),
    }
  }
  return base as SupplyNode
}

export function resolveSupplyAssemblyPresentation(
  project: ProjectWithOptionalV2Electrical,
  assembly: OffGridSupplyAssembly
): OffGridSupplyAssembly {
  const nodes = assembly.nodes.map((node) => resolveSupplyNodePresentation(project, node))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  return {
    ...assembly,
    nodes,
    inverterGroups: assembly.inverterGroups.map((group) => {
      const firstUnit = group.unitNodeIds.map((id) => nodeById.get(id)).find(Boolean)
      const device = firstUnit ? resolveSupplyNodeDevice(project, firstUnit) : undefined
      return device
        ? {
            ...group,
            shared: {
              ...group.shared,
              brand: device.conversionProps?.brand,
              model: device.conversionProps?.model,
            },
          }
        : group
    }),
  }
}

/** Adds references to older graphs without changing their topology or fallback snapshots. */
export function linkSupplyAssemblyDeviceReferences(
  project: ProjectWithOptionalV2Electrical
): boolean {
  const devices = supplyDeviceIndex(project)
  let changed = false
  // Older supply drops used generic fallback types for relay symbols. Preserve
  // every user field while giving the physical switch its own non-protection type.
  for (const device of devices.values()) {
    if (device.symbol !== 'relay' || device.type === 'relay') continue
    device.type = 'relay'
    changed = true
  }
  for (const assembly of selectProjectSupplyAssemblies(project)) {
    for (const node of assembly.nodes) {
      if (node.deviceId || !devices.has(node.id)) continue
      node.deviceId = node.id
      changed = true
    }
    if (assembly.nodes.some((node) => node.kind === 'protection' && devices.get(node.deviceId ?? node.id)?.symbol === 'relay')) {
      assembly.nodes = assembly.nodes.map<SupplyNode>((node) => {
      if (node.kind !== 'protection' || devices.get(node.deviceId ?? node.id)?.symbol !== 'relay') return node
      changed = true
      return {
        ...node,
        kind: node.ports.every((candidate) => candidate.domain === 'DC') ? 'dc-bus' : 'ac-distribution',
        properties: {},
      }
      })
    }
    for (const group of assembly.inverterGroups) {
      const canonicalDeviceId = group.unitNodeIds.find((id) => devices.has(id))
      if (!canonicalDeviceId) continue
      for (const unitNodeId of group.unitNodeIds) {
        const node = assembly.nodes.find((candidate) => candidate.id === unitNodeId)
        if (!node || node.deviceId === canonicalDeviceId) continue
        node.deviceId = canonicalDeviceId
        changed = true
      }
    }
  }
  return changed
}

export interface SupplyDeviceReferenceIssue {
  code: 'dangling-device-reference' | 'missing-assembly-node'
  deviceId: string
  assemblyId?: string
}

export function collectSupplyDeviceReferenceIssues(
  project: ProjectWithOptionalV2Electrical
): SupplyDeviceReferenceIssue[] {
  const devices = supplyDeviceIndex(project)
  const assemblies = selectProjectSupplyAssemblies(project)
  const issues: SupplyDeviceReferenceIssue[] = []
  const referencedDeviceIds = new Set<string>()
  for (const assembly of assemblies) {
    for (const node of assembly.nodes) {
      if (!node.deviceId) continue
      referencedDeviceIds.add(node.deviceId)
      if (!devices.has(node.deviceId)) {
        issues.push({
          code: 'dangling-device-reference',
          deviceId: node.deviceId,
          assemblyId: assembly.id,
        })
      }
    }
  }
  // Projects predating supply assemblies can legitimately contain only physical
  // supply devices. Once a graph exists, though, every non-serial supply-lane
  // device must be represented there or the two persisted halves have diverged.
  if (assemblies.length > 0) {
    for (const device of devices.values()) {
      if (
        device.supplyPath &&
        device.supplyPath !== 'serial' &&
        !referencedDeviceIds.has(device.id)
      ) {
        issues.push({ code: 'missing-assembly-node', deviceId: device.id })
      }
    }
  }
  return issues
}
