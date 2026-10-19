import type { Panel } from '@/types/schema'
import {
  getElectricalSnapshotIndex,
  type ParentCircuitInfo,
} from '@/lib/projectV2/electricalLookupIndex'
import { walkPanels } from '@/lib/panel/panelTree'

/**
 * Find the parent circuit (and its protection) for a given circuit ID.
 * Returns null if the circuit is not a subcircuit.
 */
export function findParentCircuitInfo(
  circuitId: string,
  panels: Panel[]
): ParentCircuitInfo | null {
  const index = getElectricalSnapshotIndex(panels)
  if (index) return index.parentCircuitsByChildId.get(circuitId) ?? null
  for (const panel of walkPanels(panels)) {
    for (const circuit of panel.circuits) {
      if (circuit.subCircuitIds?.includes(circuitId)) {
        return { parentCircuit: circuit, parentProtection: null }
      }
    }
    for (const protection of panel.protections) {
      for (const circuit of protection.circuits ?? []) {
        if (circuit.subCircuitIds?.includes(circuitId)) {
          return { parentCircuit: circuit, parentProtection: protection }
        }
      }
    }
  }
  return null
}
