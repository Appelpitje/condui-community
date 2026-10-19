import { isDraft } from 'immer'
import type { Endpoint, Panel, TrunkDevice } from '@/types/schema'
import {
  getProjectElectrical,
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import {
  getElectricalLookupIndex,
  withElectricalSnapshotIndex,
} from '@/lib/projectV2/electricalLookupIndex'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { isSupplyTransformer } from '@/lib/electrical/supplyTransformer'
import { walkPanels } from './panelTree'

const verifiedFrozenInputs = new WeakSet<object>()

/** Verify each immutable subtree once, including shallow-frozen input boundaries. */
export function isImmutablePanelReadInput(value: unknown, visiting = new Set<object>()): boolean {
  if (value == null || typeof value !== 'object') return true
  if (isDraft(value)) return false
  if (verifiedFrozenInputs.has(value)) return true
  if (!Object.isFrozen(value) || visiting.has(value)) return false
  visiting.add(value)
  const frozen = Object.values(value).every((child) => isImmutablePanelReadInput(child, visiting))
  visiting.delete(value)
  if (frozen) verifiedFrozenInputs.add(value)
  return frozen
}

function containsDraft(value: unknown, visited = new Set<object>()): boolean {
  if (value == null || typeof value !== 'object') return false
  if (isDraft(value)) return true
  if (verifiedFrozenInputs.has(value) || visited.has(value)) return false
  visited.add(value)
  return Object.values(value).some((child) => containsDraft(child, visited))
}

export type PanelReadContext = ReturnType<typeof createPanelReadContext>

function createPanelReadContext(project: ProjectWithOptionalV2Electrical) {
  const panels = getProjectElectricalPanels(project)
  const installation = getProjectElectricalInstallation(project)
  const entities = getElectricalLookupIndex(panels)
  const supplyDevices = queryAllSupplyTrunkDevices(project)
  const validSupplyDeviceIds = new Set(
    [
      ...(installation?.mainSupply.supplyTrunkDevices ?? []),
      ...(installation?.feedTopology?.sharedFeed.trunkDevices ?? []),
      ...(installation?.feedTopology?.rootFeeds.flatMap((feed) => feed.trunkDevices ?? []) ?? []),
    ].filter((device) => !isSupplyTransformer(device)).map((device) => device.id)
  )
  const supplyDevicesById = new Map<string, TrunkDevice>()
  for (const device of supplyDevices) {
    if (!supplyDevicesById.has(device.id)) supplyDevicesById.set(device.id, device)
  }
  const trunkDevicesById = new Map<string, TrunkDevice>(supplyDevicesById)
  const groundDevicesById = new Map<string, TrunkDevice>()
  const endpointMatchesByRoot = new Map<string, Endpoint[]>()
  const circuitDeviceIds = new Map<string, Set<string>>()
  const addGround = (devices: TrunkDevice[] | undefined) => {
    for (const device of devices ?? []) {
      if (!groundDevicesById.has(device.id)) groundDevicesById.set(device.id, device)
      if (!trunkDevicesById.has(device.id)) trunkDevicesById.set(device.id, device)
    }
  }
  addGround(installation?.groundTrunkDevices)
  for (const panel of walkPanels(panels)) addGround(panel.groundTrunkDevices)
  for (const root of panels) {
    const seenCircuits = new Set<string>()
    const seenEndpoints = new Set<string>()
    for (const panel of walkPanels([root])) {
      const circuits = [
        ...panel.circuits,
        ...panel.protections.flatMap((protection) => protection.circuits ?? []),
      ]
      for (const circuit of circuits) {
        for (const endpoint of circuit.endpoints) {
          if (seenEndpoints.has(endpoint.id)) continue
          seenEndpoints.add(endpoint.id)
          const matches = endpointMatchesByRoot.get(endpoint.id) ?? []
          matches.push(endpoint)
          endpointMatchesByRoot.set(endpoint.id, matches)
        }
        if (!seenCircuits.has(circuit.id)) {
          seenCircuits.add(circuit.id)
          const ids = circuitDeviceIds.get(circuit.id) ?? new Set<string>()
          for (const device of circuit.trunkDevices ?? []) ids.add(device.id)
          circuitDeviceIds.set(circuit.id, ids)
        }
        for (const device of circuit.trunkDevices ?? []) {
          if (!trunkDevicesById.has(device.id)) trunkDevicesById.set(device.id, device)
        }
        for (const branch of circuit.branches ?? []) {
          for (const device of branch.branchDevices ?? []) {
            if (!trunkDevicesById.has(device.id)) trunkDevicesById.set(device.id, device)
          }
        }
      }
    }
  }
  return {
    project,
    electrical: getProjectElectrical(project),
    panels,
    entities,
    supplyDevices,
    validSupplyDeviceIds,
    supplyDevicesById,
    groundDevicesById,
    endpointMatchesByRoot,
    circuitDeviceIds,
    trunkDevicesById,
    memo: new Map<symbol, unknown>(),
  }
}

type ActivePanelRead = {
  project: ProjectWithOptionalV2Electrical
  electrical: ReturnType<typeof getProjectElectrical>
  panels: Panel[]
  context?: PanelReadContext
}

let activeRead: ActivePanelRead | undefined
// Keep one revision, rather than accumulating a campus index for every undo step.
let latestFrozenContext: PanelReadContext | undefined

function matches(
  context: Pick<PanelReadContext, 'project' | 'electrical' | 'panels'>,
  project: ProjectWithOptionalV2Electrical
) {
  return (
    context.project === project &&
    context.electrical === getProjectElectrical(project) &&
    context.panels === getProjectElectricalPanels(project)
  )
}

/** Plain mutable data is shared only during an explicit synchronous read scope. */
export function getPanelReadContext(
  project: ProjectWithOptionalV2Electrical
): PanelReadContext | undefined {
  const electrical = getProjectElectrical(project)
  if (!electrical || isDraft(project) || isDraft(electrical)) return undefined
  if (activeRead && matches(activeRead, project)) {
    return (activeRead.context ??= createPanelReadContext(project))
  }
  if (!isImmutablePanelReadInput(electrical)) return undefined
  if (latestFrozenContext && matches(latestFrozenContext, project)) return latestFrozenContext
  latestFrozenContext = createPanelReadContext(project)
  return latestFrozenContext
}

/** Callback must be synchronous and must not modify the project. Drafts remain uncached. */
export function withPanelReadContext<T>(
  project: ProjectWithOptionalV2Electrical,
  read: () => T
): T {
  const electrical = getProjectElectrical(project)
  if (!electrical || isDraft(project) || isDraft(electrical)) return read()
  if (activeRead && matches(activeRead, project)) return read()
  if (!isImmutablePanelReadInput(electrical) && containsDraft(electrical)) return read()
  const previous = activeRead
  const context = getPanelReadContext(project)
  activeRead = { project, electrical, panels: getProjectElectricalPanels(project), context }
  try {
    return withElectricalSnapshotIndex(activeRead.panels, read)
  } finally {
    activeRead = previous
  }
}

export function memoizePanelReadContext<T>(
  context: PanelReadContext,
  key: symbol,
  build: () => T
): T {
  if (context.memo.has(key)) return context.memo.get(key) as T
  const value = build()
  context.memo.set(key, value)
  return value
}
