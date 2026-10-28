import type { Circuit } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import { getCircuitBranches } from '@/lib/layout/endpointChains'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import {
  deriveWireAnchorKey,
  findWireRunForAnchor,
  selectProjectWireRuns,
} from '@/lib/projectV2/wireRuns'
import { circuitWireDomains } from './circuitWireIdentity'
import { followProjectWireAnchorReferences, rekeyWireRunMember } from './wireAnchorMutation'

/** Removing a branch head reconnects its authored incoming cable to the next ordinary device. */
export function reconnectDeletedBranchInputs(
  project: ProjectV2,
  circuit: Circuit,
  deletedIds: ReadonlySet<string>
): void {
  if (!deletedIds.size) return
  const candidates = getCircuitBranches(circuit).flatMap((branch) => {
    const nextIndex = branch.findIndex((endpoint) => !deletedIds.has(endpoint.id))
    if (nextIndex <= 0) return []
    const prefix = branch.slice(0, nextIndex + 1)
    // Module outputs and converter connections retain their specialized ownership/domain repairs.
    if (
      prefix.some(
        (endpoint) =>
          endpoint.domoticaChildProps ||
          endpoint.symbol === 'domotica' ||
          endpoint.converterDcConnection ||
          ['inverter', 'rectifier', 'transformer', 'dc_dc_converter'].includes(
            endpoint.symbol ?? ''
          )
      )
    )
      return []
    return [{ fromId: branch[0]!.id, toId: branch[nextIndex]!.id }]
  })
  if (!candidates.length) return
  const runs = selectProjectWireRuns(project)
  if (!runs.length) return
  const domains = circuitWireDomains(getProjectElectricalPanels(project))
  const replacements = new Map<string, string>()
  for (const { fromId, toId } of candidates) {
    const domain = domains.get(`${circuit.id}:${fromId}`) ?? 'AC'
    if (domain !== (domains.get(`${circuit.id}:${toId}`) ?? 'AC')) continue
    const from = deriveWireAnchorKey({
      kind: 'circuit-section',
      circuitId: circuit.id,
      nodeRef: `endpoint:${fromId}`,
      domain,
    })
    const to = deriveWireAnchorKey({
      kind: 'circuit-section',
      circuitId: circuit.id,
      nodeRef: `endpoint:${toId}`,
      domain,
    })
    const run = findWireRunForAnchor(runs, from)
    const destination = findWireRunForAnchor(runs, to)
    // An explicitly authored downstream cable keeps its own specification.
    if (!run || (destination && destination !== run)) continue
    rekeyWireRunMember(run, from, to)
    replacements.set(from, to)
  }
  followProjectWireAnchorReferences(project, replacements)
}
