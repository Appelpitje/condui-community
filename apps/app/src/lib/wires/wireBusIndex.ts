import { ensurePanelBusCableMinimum } from './circuitWireDefaults'
import type { CableSpec, Panel, ProtectionDevice } from '@/types/schema'
import { getProtectionBusSectionId } from '@/lib/panel/panelBusSections'
import { deriveWireAnchorKey } from '@/lib/projectV2/wireRuns'

/** Electrical bus membership, independent of how many strokes render the rail. */
export function buildWireBusIndex(panels: Panel[]) {
  const cableByGroup = new Map<string, CableSpec>()
  const cableByProtection = new Map<string, CableSpec>()
  const protectionByCircuit = new Map<string, ProtectionDevice>()
  const groupByProtection = new Map<string, string>()
  const membersByGroup = new Map<string, string[]>()
  const tapCountByCircuit = new Map<string, number>()
  const visit = (panel: Panel) => {
    const circuits = [
      ...(panel.circuits ?? []),
      ...panel.protections.flatMap((p) => p.circuits ?? []),
    ]
    const parentByCircuit = new Map<string, string>()
    for (const circuit of circuits) {
      for (const child of circuit.subCircuitIds ?? []) parentByCircuit.set(child, circuit.id)
      if (circuit.subCircuitIds?.length) tapCountByCircuit.set(circuit.id, circuit.subCircuitIds.length)
    }
    for (const protection of panel.protections) {
      for (const circuit of protection.circuits ?? [])
        protectionByCircuit.set(circuit.id, protection)
      const parent = protection.circuits?.map((c) => parentByCircuit.get(c.id)).find(Boolean)
      const group = parent
        ? `circuit-bus:${parent}`
        : `panel-bus:${panel.id}:${getProtectionBusSectionId(panel, protection)}`
      groupByProtection.set(protection.id, group)
      const cable = protection.circuits?.[0]?.cable
      if (cable) cableByProtection.set(protection.id, cable)
      if (!cableByGroup.has(group))
        cableByGroup.set(group, {
          ...ensurePanelBusCableMinimum(cable),
          kind: 'other',
          customKind: 'busbar',
          sectionMm2: (cable?.sectionMm2 ?? 0) >= 16 ? 16 : 10,
          hasPE: false,
          fireClass: undefined,
        })
      const domain = protection.circuits?.some((c) => c.dcBusSource) ? 'DC' : 'AC'
      const anchor = deriveWireAnchorKey({
        kind: 'protection-input',
        panelId: panel.id,
        protectionId: protection.id,
        domain,
      })
      membersByGroup.set(group, [...(membersByGroup.get(group) ?? []), anchor])
    }
    panel.subPanels?.forEach(visit)
  }
  panels.forEach(visit)
  // A secondary bus with one tap draws no rail: its feeder runs straight into
  // that lone nested protection, so neither end belongs to a rail.
  const directFeedCircuits = new Set<string>()
  const directFeedByProtection = new Map<string, string>()
  for (const [group, members] of membersByGroup) {
    const circuitId = group.startsWith('circuit-bus:') ? group.slice('circuit-bus:'.length) : undefined
    if (!circuitId || members.length !== 1 || tapCountByCircuit.get(circuitId) !== 1) continue
    directFeedCircuits.add(circuitId)
    membersByGroup.delete(group)
    cableByGroup.delete(group)
    for (const [protectionId, candidate] of groupByProtection)
      if (candidate === group) {
        groupByProtection.delete(protectionId)
        directFeedByProtection.set(protectionId, circuitId)
      }
  }
  const groupByAnchor = new Map<string, string>()
  for (const [group, members] of membersByGroup) {
    if (group.startsWith('circuit-bus:')) {
      const circuitId = group.slice('circuit-bus:'.length)
      members.push(`circuit:${circuitId}:into:bus-section:secondary-bus:${circuitId}:AC`)
    }
    for (const member of members) groupByAnchor.set(member, group)
  }
  return {
    protectionByCircuit, groupByProtection, membersByGroup, cableByGroup, cableByProtection, groupByAnchor,
    directFeedCircuits, directFeedByProtection,
  }
}
