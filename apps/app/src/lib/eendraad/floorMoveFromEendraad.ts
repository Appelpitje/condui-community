import type { Endpoint, Placement } from '@/types/schema'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'

/**
 * Which placements to retarget when moving an endpoint to another floor from the one-wire.
 * A multiplied endpoint (×N) is one one-wire symbol for all its placements, so all of them move.
 * Otherwise this matches plan context menu behaviour (active floor placement, else sole placement).
 */
export function resolvePlacementsForFloorMove(
  endpoint: Endpoint,
  activeFloorId: string | null
): Placement[] {
  if (endpoint.placements.length > 1 && endpointSupportsMultiplier(endpoint)) {
    return endpoint.placements
  }
  if (activeFloorId) {
    const onActive = endpoint.placements.find((p) => p.floorId === activeFloorId)
    if (onActive) return [onActive]
  }
  return endpoint.placements.length === 1 ? endpoint.placements : []
}
