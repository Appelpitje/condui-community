import { useEffect, useState } from 'react'
import { createStore } from 'zustand/vanilla'
import type { PlanWireRoute, Point2 } from '@/types/schema'
import type { RoutePointContext } from '@/lib/plan/planWireOrthogonal'

export interface PlanWireWaypointPreview {
  route: PlanWireRoute
  waypointIndex: number
  point: Point2
  insert: boolean
  context?: RoutePointContext
}

export function createPlanWireWaypointPreviewStore() {
  return createStore<{ preview: PlanWireWaypointPreview | null }>(() => ({ preview: null }))
}
export type PlanWireWaypointPreviewStore = ReturnType<typeof createPlanWireWaypointPreviewStore>

/** One transient edit per viewport. Project data changes only when the gesture finishes. */
export function usePlanWireWaypointPreview() {
  const [store] = useState(createPlanWireWaypointPreviewStore)
  useEffect(
    () => () => {
      store.setState({ preview: null })
    },
    [store]
  )
  return store
}
