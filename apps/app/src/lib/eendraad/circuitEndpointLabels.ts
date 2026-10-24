import type { Circuit } from '@/types/schema'
import { getCircuitPointSequence, isNumberedCircuitTrunkSwitch } from './circuitPointNumbering'
import { relabelDomoticaChildRows } from './domoticaOutputOrdering'
import { joinLabelParts } from './labelScheme'
import { getActiveLabelScheme } from './labelSchemeContext'

/**
 * Move circuit-derived drawing references together, even with automatic naming off.
 * Keep explicit names (for example `Bord 2` on circuit B) intact. A shared initial
 * letter alone does not make an endpoint name a generated circuit reference.
 * Caller assigns `circuit.code` after this runs.
 */
export function migrateEndpointLabelsAfterCircuitCodeChange(
  circuit: Circuit,
  oldCode: string,
  newCode: string,
): void {
  const oldTrim = (oldCode ?? '').trim()
  const newTrim = (newCode ?? '').trim()
  if (oldTrim === newTrim) return

  const scheme = getActiveLabelScheme()
  if (!oldTrim) {
    // Clearing a code leaves bare point numbers. Restore their prefix only
    // where branch/trunk ownership and point order identify generated labels;
    // an unattached endpoint named "1" or an inherited A1 remains explicit.
    const branches = circuit.branches ?? []
    for (const [point, slot] of getCircuitPointSequence(circuit).entries()) {
      const owner = slot.kind === 'branch' ? branches[slot.branchIndex]! : slot.device
      const oldLabel = owner.label ?? ''
      if (!/^\d+$/.test(oldLabel) || Number(oldLabel) !== point + 1) continue
      const label = joinLabelParts(newTrim, oldLabel, scheme.branch.join, scheme.separator)
      owner.label = label
      if (slot.kind !== 'branch') continue
      const branch = branches[slot.branchIndex]!
      for (const endpoint of circuit.endpoints) {
        if (branch.endpointIds.includes(endpoint.id) && endpoint.symbol !== 'panel_distribution' &&
          endpoint.label === oldLabel) endpoint.label = label
      }
    }
  } else {
    const escapedOldCode = oldTrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Ordinary A1, separated A-1 / A.1 / A/1, domotica A1.2 and
    // legacy downstream references A1>B2. Reformat the root point according to
    // the active scheme: A1 becomes 2.1, rather than ambiguous 21, on A -> 2.
    const generatedReference = new RegExp(
      `^${escapedOldCode}(?:[.\\/-]?(\\d+)((?:[.\\/-]\\d+)*(?:>.+)?)|(>.+))?$`,
    )
    const migrate = (label: string): string => {
      const match = generatedReference.exec(label)
      if (!match) return label
      if (!match[1]) return newTrim + (match[3] ?? '')
      // Keep authored point numbers, including leading zeroes, without retaining
      // the previous code's numeric boundary separator.
      return joinLabelParts(newTrim, match[1], scheme.branch.join, scheme.separator) + (match[2] ?? '')
    }

    for (const endpoint of circuit.endpoints) {
      if (endpoint.symbol !== 'panel_distribution' && endpoint.label) endpoint.label = migrate(endpoint.label)
    }
    for (const branch of circuit.branches ?? []) {
      if (branch.label) branch.label = migrate(branch.label)
    }
    for (const device of circuit.trunkDevices ?? []) {
      if (device.label && isNumberedCircuitTrunkSwitch(device)) device.label = migrate(device.label)
    }
  }
  if (circuit.endpoints.some((endpoint) => endpoint.symbol === 'domotica' && endpoint.domoticaProps)) {
    // Row tails derive from their module; literal row labels remain explicit.
    // The caller has not assigned the new circuit code yet.
    const panelEndpoints = new Map(circuit.endpoints
      .filter((endpoint) => endpoint.symbol === 'panel_distribution')
      .map((endpoint) => [endpoint.id, endpoint]))
    circuit.endpoints = relabelDomoticaChildRows({ ...circuit, code: newTrim })
      .map((endpoint) => panelEndpoints.get(endpoint.id) ?? endpoint)
  }
}

export function renameCircuitCodeKeepingEndpoints(circuit: Circuit, newCode: string): void {
  const oldCode = (circuit.code || '').trim()
  const newTrim = newCode.trim()
  migrateEndpointLabelsAfterCircuitCodeChange(circuit, oldCode, newTrim)
  circuit.code = newTrim
}
