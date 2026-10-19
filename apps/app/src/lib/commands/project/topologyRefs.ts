import type { ProjectV2 } from '@/types/projectV2'
import { current, isDraft } from 'immer'
import type { Circuit, Panel, ProtectionDevice, TrunkDevice } from '@/types/schema'
import { getProjectElectricalPanels, getProjectElectricalInstallation, selectProjectSupplyAssemblies } from '@/lib/projectV2/electrical'
import { stableHash } from '@/utils/stableHash'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { isImmutablePanelReadInput } from '@/lib/panel/panelReadContext'
import type { EntityRef } from './types'

export type TopologyRefMap = Map<string, { ref: EntityRef; fingerprint: string }>

const immutableFingerprints = new WeakMap<object, string>()

function fingerprint(value: unknown): string {
  const object = value != null && typeof value === 'object' ? value : null
  const cached = object && immutableFingerprints.get(object)
  if (cached != null) return cached
  const result = stableHash(JSON.stringify(value) ?? '')
  // A frozen parent alone is insufficient: mutable descendants and transaction
  // snapshots must continue to reflect every edit, including earlier batch steps.
  if (object && isImmutablePanelReadInput(object)) immutableFingerprints.set(object, result)
  return result
}

function record(map: TopologyRefMap, kind: EntityRef['kind'], id: string, value: unknown) {
  const ref = { kind, id }
  map.set(`${kind}:${id}`, { ref, fingerprint: fingerprint(value) })
}

function addCircuit(map: TopologyRefMap, circuit: Circuit) {
  record(map, 'circuit', circuit.id, circuit)
  for (const endpoint of circuit.endpoints ?? []) {
    record(map, 'endpoint', endpoint.id, endpoint)
    for (const placement of endpoint.placements ?? [])
      record(map, 'placement', placement.id, placement)
  }
  for (const device of circuit.trunkDevices ?? []) addDevice(map, device)
  for (const branch of circuit.branches ?? [])
    for (const device of branch.branchDevices ?? []) addDevice(map, device)
}

function addDevice(map: TopologyRefMap, device: TrunkDevice) {
  record(map, 'trunkDevice', device.id, device)
  for (const placement of device.placements ?? []) record(map, 'placement', placement.id, placement)
}

function addProtection(map: TopologyRefMap, protection: ProtectionDevice) {
  record(map, 'protection', protection.id, protection)
  for (const circuit of protection.circuits ?? []) addCircuit(map, circuit)
}

function addPanel(map: TopologyRefMap, panel: Panel) {
  record(map, 'panel', panel.id, panel)
  for (const circuit of panel.circuits ?? []) addCircuit(map, circuit)
  for (const protection of panel.protections ?? []) addProtection(map, protection)
  for (const device of panel.groundTrunkDevices ?? []) addDevice(map, device)
  for (const child of panel.subPanels ?? []) addPanel(map, child)
}

/** Snapshot electrical topology and the floor visibility affected by electrical edits. */
export function collectTopologyRefs(project: ProjectV2): TopologyRefMap {
  // Fingerprinting is read-only. Serializing a nested panel through Immer's
  // proxies repeatedly drafts every descendant (again for each ancestor).
  // current() retains the in-transaction values, including earlier batch edits.
  if (isDraft(project)) project = current(project)
  const refs: TopologyRefMap = new Map()
  const installation = getProjectElectricalInstallation(project)
  const panels = getProjectElectricalPanels(project)
  record(
    refs,
    'installation',
    'electrical',
    { installation, supplyAssemblies: selectProjectSupplyAssemblies(project) }
  )
  for (const placement of installation?.earthingPlacements ?? [])
    record(refs, 'placement', placement.id, placement)
  for (const placement of installation?.junctionPanelPlacements ?? [])
    record(refs, 'placement', placement.id, placement)
  for (const device of installation?.groundTrunkDevices ?? [])
    addDevice(refs, device)
  for (const device of installation?.mainSupply.supplyTrunkDevices ?? [])
    addDevice(refs, device)
  for (const feed of installation?.feedTopology?.rootFeeds ?? [])
    for (const device of feed.trunkDevices ?? []) addDevice(refs, device)
  for (const panel of panels) addPanel(refs, panel)
  for (const wire of project.disciplines.electrical?.wireRuns ?? []) record(refs, 'wireRun', wire.id, wire)
  for (const asset of project.disciplines.electrical?.junctionAssets ?? []) record(refs, 'junctionAsset', asset.id, asset)
  for (const enclosure of project.disciplines.electrical?.auxiliaryEnclosures ?? []) {
    record(refs, 'auxiliaryEnclosure', enclosure.id, enclosure)
    for (const placement of enclosure.placements ?? [])
      record(refs, 'placement', placement.id, placement)
  }
  for (const floor of selectProjectBuildingFloors(project)) record(refs, 'floor', floor.id, floor)
  return refs
}

export function diffTopologyRefs(before: TopologyRefMap, after: TopologyRefMap) {
  const created: EntityRef[] = []
  const changed: EntityRef[] = []
  const removed: EntityRef[] = []
  for (const [key, next] of after) {
    const previous = before.get(key)
    if (!previous) created.push(next.ref)
    else if (previous.fingerprint !== next.fingerprint) changed.push(next.ref)
  }
  for (const [key, previous] of before) if (!after.has(key)) removed.push(previous.ref)
  return { created, changed, removed }
}
