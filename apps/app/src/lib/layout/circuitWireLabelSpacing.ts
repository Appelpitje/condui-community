import type { Circuit } from '@/types/schema'
import type { WireRun } from '@/types/projectV2'
import { deriveWireAnchorKey } from '@/lib/projectV2/wireRuns'
import { formatWireLabel, measureTextWidth, WIRE_LABEL_FONT_SIZE } from '@/lib/wireTextLabel'
import { formatWireLengthMeters } from '@/lib/wires/wireFingerprint'
import { CONDUCTOR_MARK_END_MARGIN, conductorMarkWireLength } from '@/lib/wires/conductorMarks'
import { getCircuitBranches } from './endpointChains'
import { CIRCUIT_WIRE_LABEL_BASE_SPAN } from './trunkDeviceSpacing'

export const CIRCUIT_WIRE_LABEL_BRANCH_CLEARANCE = 20

/** Extra span leaves the centered caption clear of protection specs and the first branch. */
export function getCircuitWireLabelSpan(
  circuit: Circuit,
  runs: ReadonlyMap<string, WireRun>
): number | undefined {
  // An inline device owns the first section's spacing instead of the branch row.
  if (circuit.trunkDevices?.some((device) => device.trunkPosition === 0)) return undefined
  const domain = circuit.dcBusSource ? 'DC' : 'AC'
  const anchors = getCircuitBranches(circuit).flatMap((branch, index) => {
    const device = circuit.branches?.[index]?.branchDevices?.[0]
    const endpoint = branch.find((entry) => !entry.domoticaChildProps)
    const nodeRef = device
      ? `trunk-device:${device.id}`
      : endpoint
        ? `endpoint:${endpoint.id}`
        : undefined
    return nodeRef
      ? [deriveWireAnchorKey({ kind: 'circuit-section', circuitId: circuit.id, nodeRef, domain })]
      : []
  })
  let width = 0
  // A stem showing conductor marks needs room for them beside its caption.
  const stemMarks = anchors.length > 0 && anchors.every((anchor) => {
    const run = runs.get(anchor)
    return run?.medium !== 'busbar' && run?.labels?.showConductorMarks === true
  })
  const marksLength = stemMarks
    ? Math.max(
        ...anchors.map((anchor) => conductorMarkWireLength(runs.get(anchor)?.cable ?? circuit.cable))
      ) - CONDUCTOR_MARK_END_MARGIN
    : 0
  for (const anchor of anchors) {
    const run = runs.get(anchor)
    if (run?.medium === 'busbar' || (run?.labels?.hideWireLabel ?? circuit.hideWireLabel) === true)
      continue
    const cable = run?.cable ?? circuit.cable
    if (cable.kind !== 'other' || !cable.customKind?.trim()) continue
    const lines = [formatWireLabel({ cable })]
    if (
      (run?.labels?.showFireClassLabel ?? circuit.showFireClassLabel ?? domain === 'AC') &&
      cable.fireClass
    )
      lines.push(cable.fireClass)
    const length = run?.segmentLengths?.[anchor]
    if (
      (run?.labels?.showWireLengthLabel ?? circuit.showWireLengthLabel) &&
      length &&
      run?.segmentLengthSources?.[anchor] !== 'estimated-stale'
    )
      lines.push(
        `${run?.segmentLengthSources?.[anchor] === 'estimated' ? '≈ ' : ''}${formatWireLengthMeters(length)}`
      )
    for (const text of lines)
      width = Math.max(width, measureTextWidth(text, 'Figtree', WIRE_LABEL_FONT_SIZE))
  }
  const span = Math.ceil(width + marksLength + CIRCUIT_WIRE_LABEL_BRANCH_CLEARANCE * 2)
  return span > CIRCUIT_WIRE_LABEL_BASE_SPAN ? span : undefined
}
