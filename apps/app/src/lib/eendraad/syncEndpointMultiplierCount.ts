import { generateId } from '@/utils'
import type { Endpoint, Placement } from '@/types/schema'

import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { readLegacyCompatibilityFloors } from '@/lib/projectV2/buildingFloors'
import { getEndpointMultiplierPlacementChanges } from '@/lib/properties/propertyActions'

export interface SyncEndpointMultiplierDeps {
  getEndpointById: (id: string) => Endpoint | undefined
  addPlacement: (endpointId: string, placement: Placement) => void
  deletePlacements: (ids: string[]) => void
  getActiveFloorId: () => string | null
  getFallbackFloorId: () => string | undefined
}

export function syncEndpointMultiplierCount(
  deps: SyncEndpointMultiplierDeps,
  endpointId: string,
  target: number
): boolean {
  if (!Number.isFinite(target) || !Number.isInteger(target) || target < 1) {
    return false
  }

  const latestEndpoint = deps.getEndpointById(endpointId)
  if (!latestEndpoint) return false

  const current = latestEndpoint.placements.length

  if (target === current) return true

  const floorId =
    deps.getActiveFloorId() ??
    latestEndpoint.placements[0]?.floorId ??
    deps.getFallbackFloorId()
  if (!floorId) return false

  const changes = getEndpointMultiplierPlacementChanges(
    latestEndpoint.placements,
    target,
    floorId,
    generateId
  )
  if (!changes) return false
  if (changes.removeIds.length) {
    deps.deletePlacements(changes.removeIds)
    return true
  }
  for (const placement of changes.add) deps.addPlacement(latestEndpoint.id, placement)
  return true
}

export function createSyncEndpointMultiplierDeps(): SyncEndpointMultiplierDeps {
  const state = useProjectStore.getState()
  return {
    getEndpointById: state.getEndpointById,
    addPlacement: state.addPlacement,
    deletePlacements: state.deletePlacements,
    getActiveFloorId: () => useUIStore.getState().activeFloorId,
    getFallbackFloorId: () =>
      state.currentProject ? readLegacyCompatibilityFloors(state.currentProject)[0]?.id : undefined,
  }
}
