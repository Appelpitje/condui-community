import type { WireRun } from '@/types/projectV2'
import type { Panel } from '@/types/schema'
import { getScopedControlLinkNote } from '@/lib/controlLink/controlLinkNoteContext'
import { getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import { deriveWireAnchorKey } from '@/lib/projectV2/wireRuns'
import { conductorMarkWireLength } from '@/lib/wires/conductorMarks'
import { getCircuitBranches } from './endpointChains'

/**
 * Visible wire the default spacing leaves between neighbouring devices on a branch, and
 * between the stem and a branch's first device. Symbols eat into the spacing constants, so
 * these are the drawn lengths of the narrowest pairs.
 */
const DEFAULT_ENDPOINT_WIRE = 18
const DEFAULT_LEAD_IN_WIRE = 12

/** Layout-scope key holding the extra spacing in front of an endpoint for conductor marks. */
export function conductorMarkGapKey(endpointId: string): string {
  return `conductor-mark-gap:${endpointId}`
}

/** Extra spacing in front of `endpointId` so the wire into it fits its conductor marks. */
export function getScopedConductorMarkGap(endpointId: string): number {
  const value = Number(getScopedControlLinkNote(conductorMarkGapKey(endpointId)))
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Extra spacing for every branch wire that draws conductor marks, as layout-scope entries.
 * A branch's first device follows the run's branch-piece flag (its wire leaves the stem);
 * later devices follow the flag of the run into them.
 */
export function collectConductorMarkGaps(
  panels: readonly Panel[],
  runs: ReadonlyMap<string, WireRun>
): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  for (const circuit of panels.flatMap(getAllCircuits)) {
    const domain = circuit.dcBusSource ? 'DC' : 'AC'
    getCircuitBranches(circuit).forEach((endpoints, branchIndex) => {
      const afterDevice = !!circuit.branches?.[branchIndex]?.branchDevices?.length
      endpoints.forEach((endpoint, index) => {
        const anchor = deriveWireAnchorKey({
          kind: 'circuit-section',
          circuitId: circuit.id,
          nodeRef: `endpoint:${endpoint.id}`,
          domain,
        })
        const run = runs.get(anchor)
        if (!run || run.medium === 'busbar') return
        const leadIn = index === 0 && !afterDevice
        const enabled = leadIn ? run.labels?.showBranchConductorMarks : run.labels?.showConductorMarks
        if (enabled !== true) return
        const gap =
          conductorMarkWireLength(run.cable ?? circuit.cable) -
          (leadIn ? DEFAULT_LEAD_IN_WIRE : DEFAULT_ENDPOINT_WIRE)
        if (gap > 0) entries.push([conductorMarkGapKey(endpoint.id), String(Math.ceil(gap))])
      })
    })
  }
  return entries
}
