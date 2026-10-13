/**
 * Smart drop expansion for two-way and cross switches on endpoint branches
 * that have no switches yet (may have lights or other loads).
 */

import { getSymbolById } from '@/lib/symbols'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { Circuit } from '@/types/schema'
import type { SymbolMetadata } from '@/lib/symbols'
import { isInBetweenDevice } from '@/utils/symbolMapping'

export type SmartSwitchExpansion = {
  symbols: SymbolMetadata[]
  /** Index in `symbols` to select after drop (the symbol the user dropped). */
  primaryIndex: number
}

/**
 * Drop targets where switches are placed on a circuit branch (not supply/ground/main bus).
 * Includes empty circuits (vertical trunk or empty horizontal branch) and MCB/protection hits.
 */
export function isEndpointBranchDropTarget(target: DropTarget): boolean {
  if (target.domoticaOutput || target.domoticaChildDropIntent) return false
  if (target.type === 'endpoint') return true
  if (target.type === 'protection' && target.circuitId) return true
  if (target.type === 'circuit' && target.circuitId) {
    // Branch wire (branchEndpoints may be []), or vertical trunk on a circuit.
    return true
  }
  return false
}

/** @deprecated Use isEndpointBranchDropTarget */
export const isBranchWireDropTarget = isEndpointBranchDropTarget

/** Branch has no switch endpoints yet (lights and other loads are allowed). */
export function branchHasNoSwitches(circuit: Circuit, branchEndpointIds: string[]): boolean {
  return !branchEndpointIds.some((id) => {
    const ep = circuit.endpoints.find((e) => e.id === id)
    return ep?.type === 'switch'
  })
}

/** True when the circuit has no switch endpoints at all. */
export function circuitHasNoSwitches(circuit: Circuit): boolean {
  return !circuit.endpoints.some((ep) => ep.type === 'switch')
}

export function resolveSmartSwitchExpansion(
  symbol: SymbolMetadata,
): SmartSwitchExpansion | null {
  const twoway1p = getSymbolById('switch_1p_twoway')
  const cross = getSymbolById('switch_cross')
  if (!twoway1p) return null

  if (symbol.id === 'switch_cross') {
    if (!cross) return null
    return { symbols: [twoway1p, cross, twoway1p], primaryIndex: 1 }
  }

  if (
    symbol.id === 'switch_1p_twoway' ||
    symbol.id === 'switch_double'
  ) {
    return { symbols: [twoway1p, twoway1p], primaryIndex: 0 }
  }

  if (symbol.id === 'switch_2p_twoway') {
    const twoway2p = getSymbolById('switch_2p_twoway') ?? twoway1p
    return { symbols: [twoway2p, twoway2p], primaryIndex: 0 }
  }

  return null
}

/**
 * Layout branch nodes use ids `branch-{circuitId}-{index}` (see bottomUpLayout).
 * Returns the branch index when the id matches, else null.
 */
export function resolveLayoutBranchIndex(
  branchId: string | undefined,
  circuitId: string,
): number | null {
  if (!branchId) return null
  const prefix = `branch-${circuitId}-`
  if (!branchId.startsWith(prefix)) return null
  const suffix = branchId.slice(prefix.length)
  if (suffix === 'empty') return null
  const index = Number.parseInt(suffix, 10)
  return Number.isFinite(index) ? index : null
}

export function shouldApplySmartSwitchExpansion(
  target: DropTarget,
  circuit: Circuit,
  symbol: SymbolMetadata,
): boolean {
  if (!isEndpointBranchDropTarget(target)) return false
  if (!resolveSmartSwitchExpansion(symbol)) return false

  // On a branch wire (including an empty branch with branchEndpoints: []).
  if (target.branchEndpoints !== undefined) {
    return branchHasNoSwitches(circuit, target.branchEndpoints)
  }

  // Trunk / MCB / protection — no branch wire under the cursor.
  if (circuitHasNoSwitches(circuit)) return true

  // Multi-branch circuit: trunk drops for in-between devices start a new branch.
  if (isInBetweenDevice(symbol) && (circuit.endpoints?.length ?? 0) > 0) {
    return true
  }

  return false
}

/** True when the drop targets an empty branch wire (layout branch with no endpoints yet). */
export function isEmptyBranchWireDrop(target: DropTarget, circuitId: string): boolean {
  return (
    target.branchEndpoints !== undefined &&
    target.branchEndpoints.length === 0 &&
    resolveLayoutBranchIndex(target.branchId, circuitId) !== null
  )
}

/** Refresh branch context after inserting an endpoint during multi-drop expansion. */
export function refreshBranchDropTargetAfterInsert(
  circuit: Circuit,
  target: DropTarget,
  lastAddedEndpointId: string,
): DropTarget {
  const branch = (circuit.branches ?? []).find((b) =>
    b.endpointIds.includes(lastAddedEndpointId),
  )
  const branchEndpoints = branch?.endpointIds?.length
    ? branch.endpointIds
    : [...(target.branchEndpoints ?? []), lastAddedEndpointId]
  return {
    ...target,
    branchEndpoints,
    insertAfterEndpointId: lastAddedEndpointId,
  }
}
