import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit } from '@/types/schema'
import {
  deriveWireAnchorKey,
  findWireRunForAnchor,
  selectProjectWireRuns,
} from '@/lib/projectV2/wireRuns'
import { followProjectWireAnchorReferences, rekeyWireRunMember } from './wireAnchorMutation'

/** The first load terminates the preset open wire; its authored cable remains the same run. */
export function connectEmptyProtectionWire(
  project: ProjectV2,
  circuit: Circuit,
  protectionId: string,
  endpointId: string
): void {
  if (
    circuit.endpoints.length ||
    circuit.trunkDevices?.length ||
    circuit.subCircuitIds?.length ||
    circuit.branches?.some((branch) => branch.endpointIds.length || branch.branchDevices?.length)
  )
    return

  const domain = circuit.dcBusSource ? 'DC' : 'AC'
  const from = deriveWireAnchorKey({
    kind: 'circuit-section',
    circuitId: circuit.id,
    nodeRef: `open-end:protection:${encodeURIComponent(protectionId)}`,
    domain,
  })
  const to = deriveWireAnchorKey({
    kind: 'circuit-section',
    circuitId: circuit.id,
    nodeRef: `endpoint:${endpointId}`,
    domain,
  })
  const runs = selectProjectWireRuns(project)
  const run = findWireRunForAnchor(runs, from)
  if (!run || findWireRunForAnchor(runs, to)) return

  rekeyWireRunMember(run, from, to)
  followProjectWireAnchorReferences(project, new Map([[from, to]]))
}
