import type { Circuit, Panel, ProtectionDevice } from '@/types/schema'
import { getElectricalPanelSnapshotIndex } from '@/lib/projectV2/electricalLookupIndex'

type EndpointCircuitOwner = { circuit: Circuit; panel: Panel; protection?: ProtectionDevice }

/** First endpoint owner in direct-circuit, protection, then child-panel order. */
export function findCircuitForEndpointInPanel(
  panel: Panel,
  endpointId: string
): EndpointCircuitOwner | undefined {
  const index = getElectricalPanelSnapshotIndex(panel)
  if (index) {
    const endpoint = index.endpointsById.get(endpointId)
    if (!endpoint) return undefined
    const circuit = endpoint.circuit
    // Invalid duplicate circuit IDs may refer to different owner objects. Keep
    // the original traversal in that case rather than choosing the wrong owner.
    if (index.circuitsById.get(circuit.id)?.circuit === circuit) {
      const context = index.circuitContextsById.get(circuit.id)!
      return context.protection
        ? { circuit, panel: context.panel, protection: context.protection }
        : { circuit, panel: context.panel }
    }
  }
  return scanCircuitForEndpointInPanel(panel, endpointId)
}

function scanCircuitForEndpointInPanel(
  panel: Panel,
  endpointId: string
): EndpointCircuitOwner | undefined {
  for (const circuit of panel.circuits) {
    if (circuit.endpoints.some((endpoint) => endpoint.id === endpointId)) {
      return { circuit, panel }
    }
  }
  for (const protection of panel.protections) {
    for (const circuit of protection.circuits ?? []) {
      if (circuit.endpoints.some((endpoint) => endpoint.id === endpointId)) {
        return { circuit, panel, protection }
      }
    }
  }
  for (const child of panel.subPanels) {
    const found = scanCircuitForEndpointInPanel(child, endpointId)
    if (found) return found
  }
  return undefined
}
