import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { Circuit } from '@/types/schema'
import {
  moveEndpointSelectionBetweenCircuits,
  moveEndpointSelectionOnCircuit,
} from './moveEndpointSelection'

export type EendraadMoveKind = 'protection' | 'endpoint' | 'trunkDevice'

export interface ClassifiedEendraadMoveSelection {
  protectionIds: string[]
  endpointIds: string[]
  trunkDeviceIds: string[]
}

export function classifyEendraadMoveSelection(
  ids: string[],
  lookup: {
    isProtection: (id: string) => boolean
    isEndpoint: (id: string) => boolean
    isTrunkDevice: (id: string) => boolean
  }
): ClassifiedEendraadMoveSelection {
  const uniqueIds = [...new Set(ids)]
  return {
    protectionIds: uniqueIds.filter(lookup.isProtection),
    endpointIds: uniqueIds.filter(lookup.isEndpoint),
    trunkDeviceIds: uniqueIds.filter(lookup.isTrunkDevice),
  }
}

/**
 * Choose exactly one movable family for a mixed selection. The physical target is
 * authoritative: buses take protections, endpoint branches take endpoints, and a
 * homogeneous trunk-device selection can still use circuit-trunk insertion slots.
 */
export function resolveEendraadMultiMoveKind(
  selection: ClassifiedEendraadMoveSelection,
  target: DropTarget | null | undefined
): EendraadMoveKind | null {
  if (!target || target.type === null) return null

  if (target.type === 'mainBus' || target.type === 'protection' || target.type === 'rcd') {
    return selection.protectionIds.length ? 'protection' : null
  }

  if (target.type === 'endpoint' || target.endpointId || target.branchId) {
    return selection.endpointIds.length ? 'endpoint' : null
  }

  if (target.type === 'circuit') {
    if (typeof target.secondaryBusInsertIndex === 'number') {
      return selection.protectionIds.length ? 'protection' : null
    }
    // A circuit trunk is also a legal endpoint attachment. In an ambiguous mixed
    // selection, endpoints are the least topology-changing and therefore win.
    if (selection.endpointIds.length) return 'endpoint'
    if (selection.trunkDeviceIds.length) return 'trunkDevice'
    return selection.protectionIds.length ? 'protection' : null
  }

  return null
}

export interface PlannedEndpointSelectionMove {
  updates: Array<{
    circuitId: string
    endpoints: Circuit['endpoints']
    branches: NonNullable<Circuit['branches']>
  }>
  movedEndpointIds: string[]
}

export interface ProtectionMoveItem {
  id: string
  circuitId: string
}

export function circuitClosureContains(
  rootCircuitId: string,
  targetCircuitId: string,
  getCircuitById: (circuitId: string) => Circuit | null | undefined
): boolean {
  const pending = [rootCircuitId]
  const visited = new Set<string>()
  while (pending.length) {
    const circuitId = pending.pop()
    if (!circuitId || visited.has(circuitId)) continue
    if (circuitId === targetCircuitId) return true
    visited.add(circuitId)
    pending.push(...(getCircuitById(circuitId)?.subCircuitIds ?? []))
  }
  return false
}

/** Avoid relocating a selected descendant twice when its selected ancestor carries it along. */
export function collapseProtectionMoveRoots(
  items: ProtectionMoveItem[],
  getCircuitById: (circuitId: string) => Circuit | null | undefined
): ProtectionMoveItem[] {
  return items.filter(
    (item) =>
      !items.some(
        (other) =>
          other.id !== item.id &&
          circuitClosureContains(other.circuitId, item.circuitId, getCircuitById)
      )
  )
}

function cloneCircuit(circuit: Circuit): Circuit {
  return {
    ...circuit,
    endpoints: circuit.endpoints.map((endpoint) => ({ ...endpoint })),
    branches: (circuit.branches ?? []).map((branch) => ({
      ...branch,
      endpointIds: [...branch.endpointIds],
    })),
  }
}

/** Plan the complete endpoint batch before committing any store writes. */
export function planEndpointSelectionMove(
  selectedEndpointIds: string[],
  target: DropTarget,
  getCircuitForEndpoint: (endpointId: string) => Circuit | null | undefined,
  getCircuitById: (circuitId: string) => Circuit | null | undefined,
  newId?: () => string
): PlannedEndpointSelectionMove | null {
  if (!target.circuitId || selectedEndpointIds.length === 0) return null
  if (target.endpointId && selectedEndpointIds.includes(target.endpointId)) return null

  const selected = [...new Set(selectedEndpointIds)]
  const sourceGroups = new Map<string, string[]>()
  for (const endpointId of selected) {
    const circuit = getCircuitForEndpoint(endpointId)
    if (!circuit) return null
    const group = sourceGroups.get(circuit.id) ?? []
    group.push(endpointId)
    sourceGroups.set(circuit.id, group)
  }

  const working = new Map<string, Circuit>()
  const readWorking = (circuitId: string): Circuit | null => {
    const existing = working.get(circuitId)
    if (existing) return existing
    const source = getCircuitById(circuitId)
    if (!source) return null
    const cloned = cloneCircuit(source)
    working.set(circuitId, cloned)
    return cloned
  }

  // Reorder the target's own selected endpoints first. Other source groups are
  // then inserted at the same stable target slot in selection order.
  const orderedGroups = [...sourceGroups.entries()].sort(([a], [b]) => {
    if (a === target.circuitId) return -1
    if (b === target.circuitId) return 1
    return 0
  })

  for (const [sourceCircuitId, endpointIds] of orderedGroups) {
    const source = readWorking(sourceCircuitId)
    const targetCircuit = readWorking(target.circuitId)
    if (!source || !targetCircuit) return null
    const anchorId = endpointIds[0]
    if (!anchorId) return null

    if (sourceCircuitId === target.circuitId) {
      const result = moveEndpointSelectionOnCircuit(source, anchorId, endpointIds, target, {
        allowSingle: true,
        newId,
      })
      if (!result) return null
      working.set(sourceCircuitId, {
        ...source,
        endpoints: result.endpoints,
        branches: result.branches,
      })
      continue
    }

    const result = moveEndpointSelectionBetweenCircuits(
      source,
      targetCircuit,
      anchorId,
      endpointIds,
      target,
      { allowSingle: true, newId }
    )
    if (!result) return null
    working.set(sourceCircuitId, {
      ...source,
      endpoints: result.source.endpoints,
      branches: result.source.branches,
    })
    working.set(target.circuitId, {
      ...targetCircuit,
      endpoints: result.target.endpoints,
      branches: result.target.branches,
    })
  }

  return {
    movedEndpointIds: selected,
    updates: [...working.entries()].map(([circuitId, circuit]) => ({
      circuitId,
      endpoints: circuit.endpoints,
      branches: circuit.branches ?? [],
    })),
  }
}
