/**
 * Endpoint Chain Validation and Layout
 *
 * Handles endpoint chain rules:
 * - Stored branch endpointIds order is authoritative (series mid-chain switches allowed)
 * - Max 2 sockets per chain (close socket group)
 * - Relays can branch off to top with push/regular switch
 * - Endpoint users follow relay to the right
 * - Single endpoint exception: goes straight up (no horizontal branch)
 */

import { getCircuitConverterPrimaryEndpointIds, isCircuitConverterDcChild } from './circuitConverterGeometry'
import type { Circuit } from '@/types/schema'
import { isInBetweenEndpoint } from '@/utils/symbolMapping'
import type { Endpoint } from '@/types/schema'

export interface EndpointChain {
  endpoints: Endpoint[]
  hasRelay: boolean
  relayIndex?: number
  branchLabel?: string
}

export interface ChainValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validate an endpoint chain according to rules
 */
export function validateEndpointChain(endpoints: Endpoint[]): ChainValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (endpoints.length === 0) {
    return { valid: true, errors, warnings }
  }

  // Single endpoint case - always valid
  if (endpoints.length === 1) {
    return { valid: true, errors, warnings }
  }

  // Count endpoint types
  const switches: Endpoint[] = []
  const lights: Endpoint[] = []
  const sockets: Endpoint[] = []
  const appliances: Endpoint[] = []
  let relayIndex: number | undefined

  endpoints.forEach((endpoint, index) => {
    if (endpoint.type === 'switch') {
      switches.push(endpoint)
    } else if (endpoint.type === 'light_point') {
      lights.push(endpoint)
    } else if (endpoint.type === 'socket') {
      sockets.push(endpoint)
    } else if (endpoint.type === 'fixed_appliance') {
      appliances.push(endpoint)
      // Check if this is a relay (would need symbol check)
      if (endpoint.symbol?.includes('relay') || endpoint.symbol?.includes('teleruptor')) {
        relayIndex = index
      }
    }
  })

  // Rule: Switches must come before lights
  let lastSwitchIndex = -1
  let firstLightIndex = endpoints.length
  endpoints.forEach((endpoint, index) => {
    if (endpoint.type === 'switch') {
      lastSwitchIndex = index
    } else if (endpoint.type === 'light_point' && firstLightIndex === endpoints.length) {
      firstLightIndex = index
    }
  })

  if (lastSwitchIndex > firstLightIndex) {
    errors.push('Switches must come before lights in endpoint chain')
  }

  // Rule: Max 2 sockets per chain
  if (sockets.length > 2) {
    errors.push(`Maximum 2 sockets allowed per endpoint chain (found ${sockets.length})`)
  }

  // Rule: Sockets should be grouped together
  if (sockets.length > 1) {
    const socketIndices = endpoints
      .map((ep, idx) => (ep.type === 'socket' ? idx : -1))
      .filter(idx => idx >= 0)
    const minSocketIndex = Math.min(...socketIndices)
    const maxSocketIndex = Math.max(...socketIndices)
    const socketSpan = maxSocketIndex - minSocketIndex + 1
    if (socketSpan > sockets.length) {
      warnings.push('Sockets should be grouped together in endpoint chain')
    }
  }

  // Rule: Relays can have switch branch to top, users to right
  if (relayIndex !== undefined) {
    // Relay should have switch before it (for top branch)
    const hasSwitchBefore = endpoints
      .slice(0, relayIndex)
      .some(ep => ep.type === 'switch')
    if (!hasSwitchBefore && relayIndex > 0) {
      warnings.push('Relay typically has a switch before it for top branch')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Group endpoints into chains based on circuit structure
 * For now, all endpoints in a circuit form one chain
 */
export function createEndpointChains(endpoints: Endpoint[]): EndpointChain[] {
  if (endpoints.length === 0) {
    return []
  }

  // Single endpoint - special case (straight up, no branch)
  if (endpoints.length === 1) {
    return [{
      endpoints,
      hasRelay: false,
    }]
  }

  // Check for relay
  const relayIndex = endpoints.findIndex(
    ep => ep.type === 'fixed_appliance' && 
    (ep.symbol?.includes('relay') || ep.symbol?.includes('teleruptor'))
  )

  return [{
    endpoints,
    hasRelay: relayIndex >= 0,
    relayIndex: relayIndex >= 0 ? relayIndex : undefined,
  }]
}

/**
 * Initialize branches for a circuit if they don't exist.
 * Creates branches from endpoint order and types.
 * Branch labels are derived from the first labeled endpoint on each branch,
 * serving as a migration path for projects that predate the branch.label field.
 */
export function initializeBranchesIfNeeded(circuit: { endpoints: Endpoint[]; branches?: Array<{ id: string; label: string; endpointIds: string[] }> }): Array<{ id: string; label: string; endpointIds: string[] }> {
  if (circuit.branches && circuit.branches.length > 0) {
    // Backfill branch labels for existing stored branches that lack one (migration).
    // IMPORTANT: Do not mutate the original branch objects here — project state may
    // come from an immutable store (frozen objects), which would throw at runtime.
    const migratedBranches = circuit.branches.map(branch => {
      if (branch.label) return branch

      const firstLabeled = branch.endpointIds
        .map(id => circuit.endpoints.find(ep => ep.id === id))
        .find(ep => ep && ep.label)

      // If we found a label, return a shallow copy with the backfilled label,
      // otherwise return the original branch unchanged.
      if (firstLabeled?.label) {
        return {
          ...branch,
          label: firstLabeled.label,
        }
      }

      return branch
    })

    return migratedBranches
  }
  
  // Create branches from endpoints — derive label from first labeled endpoint per branch
  const endpointBranches = groupEndpointsIntoBranches(circuit.endpoints)
  return endpointBranches.map((branchEndpoints, index) => ({
    id: `branch-${index}`,
    label: branchEndpoints.find(ep => ep.label)?.label || '',
    endpointIds: branchEndpoints.map(ep => ep.id)
  }))
}

/**
 * Get branches from circuit - uses stored branches if available, otherwise infers from endpoints.
 * Preserves stored `endpointIds` order (including series switch-after-socket chains).
 */
export function getCircuitBranches(circuit: { endpoints: Endpoint[]; branches?: Array<{ id: string; label: string; endpointIds: string[] }> }): Endpoint[][] {
  if (circuit.branches && circuit.branches.length > 0) {
    return circuit.branches.map(branch => {
      return branch.endpointIds
        .map(id => circuit.endpoints.find(ep => ep.id === id))
        .filter((ep): ep is Endpoint => ep !== undefined)
    })
  }

  return groupEndpointsIntoBranches(circuit.endpoints)
}

/**
 * Group endpoints into branches for layout (fallback when branches not stored)
 * Rules:
 * - In-between devices (switches, relay, domotica, energy_meter) and the first actual endpoint go on the same branch
 * - A single static device may follow a socket on that same branch
 * - Each other subsequent actual endpoint gets its own branch
 * - Example: [switch1, domotica, light1] -> branch1: [switch1, domotica, light1]
 * - Example: [switch1, light1, light2] -> branch1: [switch1, light1], branch2: [light2]
 * - Example: [socket1, rectifier] -> branch1: [socket1, rectifier]
 */
export function groupEndpointsIntoBranches(endpoints: Endpoint[]): Endpoint[][] {
  if (endpoints.length === 0) {
    return []
  }

  // Single endpoint - one branch
  if (endpoints.length === 1) {
    return [[endpoints[0]!]]
  }

  const branches: Endpoint[][] = []
  let currentBranch: Endpoint[] = []
  let hasActualEndpointInBranch = false

  for (const endpoint of endpoints) {
    if (isInBetweenEndpoint(endpoint)) {
      // Switches, relay, domotica, energy_meter always go on the current branch (before endpoint)
      currentBranch.push(endpoint)
    } else {
      // Actual endpoint (socket, light, appliance). A static device (including
      // a branch-local conversion device) may be the one terminal load after a
      // socket, matching the explicit branch insertion rules.
      const staticDeviceAfterSocket =
        endpoint.type === 'fixed_appliance' &&
        currentBranch.some(ep => ep.type === 'socket') &&
        !currentBranch.some(ep => ep.type === 'fixed_appliance')

      if (!hasActualEndpointInBranch || staticDeviceAfterSocket) {
        // First actual endpoint goes on the same branch as in-between devices
        currentBranch.push(endpoint)
        hasActualEndpointInBranch = true
      } else {
        // Subsequent actual endpoints start a new branch
        if (currentBranch.length > 0) {
          branches.push(currentBranch)
        }
        currentBranch = [endpoint]
        hasActualEndpointInBranch = true
      }
    }
  }

  // Add the last branch
  if (currentBranch.length > 0) {
    branches.push(currentBranch)
  }

  return branches
}

/**
 * Get the layout direction for an endpoint chain
 * Returns 'straight' for single endpoint, 'branch' for multiple
 */
export function getChainLayoutDirection(chain: EndpointChain): 'straight' | 'branch' {
  if (chain.endpoints.length === 1) {
    return 'straight'
  }
  return 'branch'
}

/** Branch rows used by both the canvas layout and command target ownership checks. */
export function getStandardCircuitBranches(circuit: Circuit) {
  const primaryEndpointIds = getCircuitConverterPrimaryEndpointIds(circuit)
  const dcBusEndpointIds = new Set(
    (circuit.branches ?? [])
      .filter((branch) => !!branch.dcBusId)
      .flatMap((branch) => branch.endpointIds)
  )
  return getCircuitBranches(circuit).filter(
    (branchEndpoints) =>
      !branchEndpoints.some(
        (endpoint) =>
          isCircuitConverterDcChild(endpoint) ||
          primaryEndpointIds.has(endpoint.id) ||
          dcBusEndpointIds.has(endpoint.id)
      )
  )
}
