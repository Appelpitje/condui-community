import type { Endpoint } from '@/types/schema'
import type { WallFacingSide } from '@/utils/planAutoOrient'

/** Mounting side in the unrotated artwork, shared by placement and drag previews. */
export function getEndpointPlanWallFacingSide(endpoint: Endpoint): WallFacingSide | null {
  if (endpoint.type === 'socket') return 'left'
  if (endpoint.symbol === 'panel_distribution') return 'top'
  if (endpoint.symbol === 'light_point' && endpoint.lightPointProps?.onWall) return 'right'
  return null
}
