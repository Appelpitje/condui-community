import type { Panel } from '@/types/schema'
import { isDraft } from 'immer'

const nestedCircuitIdsByPanel = new WeakMap<Panel, ReadonlySet<string>>()
const immutableMainBusPanels = new WeakSet<Panel>()

/** Only the panel fields read by bus ordering and phase-slot calculation. */
export function isImmutableMainBusPanel(panel: Panel): boolean {
  if (isDraft(panel) || !Object.isFrozen(panel)) return false
  if (immutableMainBusPanels.has(panel)) return true
  const circuitsAreImmutable = (circuits: Panel['circuits'] | undefined) =>
    !circuits ||
    (Object.isFrozen(circuits) &&
      circuits.every(
        (circuit) =>
          !isDraft(circuit) &&
          Object.isFrozen(circuit) &&
          (!circuit.subCircuitIds || Object.isFrozen(circuit.subCircuitIds))
      ))
  if (!circuitsAreImmutable(panel.circuits)) return false
  if (
    panel.protections &&
    (!Object.isFrozen(panel.protections) ||
      !panel.protections.every(
        (protection) =>
          !isDraft(protection) &&
          Object.isFrozen(protection) &&
          circuitsAreImmutable(protection.circuits)
      ))
  ) return false
  if (
    panel.busSections &&
    (!Object.isFrozen(panel.busSections) ||
      !panel.busSections.every((section) => !isDraft(section) && Object.isFrozen(section)))
  ) return false
  immutableMainBusPanels.add(panel)
  return true
}

function collectNestedCircuitIds(panel: Panel): ReadonlySet<string> {
  const cached = nestedCircuitIdsByPanel.get(panel)
  if (cached) return cached

  const nestedIds = new Set<string>()
  for (const circuit of panel.circuits ?? []) {
    for (const id of circuit.subCircuitIds ?? []) nestedIds.add(id)
  }
  for (const protection of panel.protections ?? []) {
    for (const circuit of protection.circuits ?? []) {
      for (const id of circuit.subCircuitIds ?? []) nestedIds.add(id)
    }
  }

  // Plain fixtures and Immer drafts can still be mutated in place. Cache only
  // finalized project panels, whose identity changes with an electrical edit.
  if (isImmutableMainBusPanel(panel)) nestedCircuitIdsByPanel.set(panel, nestedIds)
  return nestedIds
}

/** True when this circuit belongs to a secondary bus, rather than the main bus. */
export function isCircuitNestedUnderPanelBus(panel: Panel, circuitId: string): boolean {
  return collectNestedCircuitIds(panel).has(circuitId)
}

/** Main-bus item order, matching diagram layout and drag order. */
export function getMainBusOrder(
  panel: Panel
): Array<{ type: 'circuit' | 'protection'; id: string }> {
  const items: Array<{ type: 'circuit' | 'protection'; id: string; index: number }> = []
  const seenProtectionIds = new Set<string>()
  // Mutable command drafts cannot share a retained set, but each individual
  // ordering pass can still collect the nested IDs once rather than per item.
  const nestedCircuitIds = collectNestedCircuitIds(panel)
  panel.circuits.forEach((circuit, index) => {
    if (circuit.code !== 'PANEL' && !nestedCircuitIds.has(circuit.id)) {
      items.push({ type: 'circuit', id: circuit.id, index })
    }
  })
  panel.protections?.forEach((protection, index) => {
    if (
      !(protection.circuits ?? []).some(
        (circuit) => !nestedCircuitIds.has(circuit.id)
      )
    ) {
      return
    }
    if (seenProtectionIds.has(protection.id)) return
    seenProtectionIds.add(protection.id)
    items.push({ type: 'protection', id: protection.id, index })
  })
  items.sort((left, right) => left.index - right.index)
  return items.map(({ type, id }) => ({ type, id }))
}
