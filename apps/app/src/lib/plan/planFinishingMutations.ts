import type { ProjectV2 } from '@/types/projectV2'
import { current, isDraft } from 'immer'
import type { PlanWireKind, PlanWireRoute, Point2 } from '@/types/schema'
import {
  deriveAutoPlanWireRoutes,
  mergePlanWireRoutes,
  removePlanWireRouteWaypoint,
} from './planWiring'
import {
  movePlanWireRouteRiser,
  movePlanWireRouteRisers,
  movePlanWireRouteWaypoint,
  upsertPlanWireRouteWaypoint,
} from './planWiringRouteEdits'
import {
  replacePlanWireRoutesForProject,
  selectProjectPlanWireRoutes,
} from '@/lib/projectV2/planWiring'

const PLAN_WIRE_KINDS: PlanWireKind[] = ['lighting-control', 'sockets', 'other']

export type PlanWireFinishingEdit =
  | { operation: 'insertWaypoint'; floorId: string; routeId: string; index: number; point: Point2 }
  | { operation: 'moveWaypoint'; floorId: string; routeId: string; index: number; point: Point2 }
  | { operation: 'removeWaypoint'; floorId: string; routeId: string; index: number }
  | { operation: 'hideSocketRoutes'; floorId: string; sourcePlacementId: string }
  | { operation: 'moveRiser'; floorId: string; routeId: string; point: Point2 }
  | { operation: 'moveRisers'; floorId: string; moves: Array<{ routeId: string; point: Point2 }> }

export function editablePlanWireRoutes(project: ProjectV2, floorId: string): PlanWireRoute[] {
  // Route discovery is read-only. Avoid estimating through Immer proxies, which
  // loses the completed estimate cache and repeatedly clones the entire campus.
  // current() also retains preceding edits in a batch; original() would not.
  if (isDraft(project)) project = current(project)
  // Accept the stable IDs of both drawing projections, independent of browser feature flags.
  const autoRoutes = [
    ...deriveAutoPlanWireRoutes(project, floorId, PLAN_WIRE_KINDS, { routing: 'cable' }),
    ...deriveAutoPlanWireRoutes(project, floorId, PLAN_WIRE_KINDS, { routing: 'legacy' }),
  ]
  const manualRoutes = selectProjectPlanWireRoutes(project).filter(
    (route) => route.floorId === floorId
  )
  return mergePlanWireRoutes(autoRoutes, manualRoutes)
}

export function findEditablePlanWireRoute(
  project: ProjectV2,
  floorId: string,
  routeId: string
): PlanWireRoute | undefined {
  return (
    selectProjectPlanWireRoutes(project).find(
      (route) => route.floorId === floorId && route.id === routeId
    ) ?? editablePlanWireRoutes(project, floorId).find((route) => route.id === routeId)
  )
}

/** Apply a typed wire-route finishing edit and persist its canonical V2 element representation. */
export function editPlanWireRouteInProject(
  project: ProjectV2,
  edit: PlanWireFinishingEdit
): boolean {
  const storedRoutes = selectProjectPlanWireRoutes(project)
  const before = JSON.stringify(storedRoutes)
  if (edit.operation === 'hideSocketRoutes') {
    const routes = editablePlanWireRoutes(project, edit.floorId).filter(
      (route) => route.kind === 'sockets' && route.from.placementId === edit.sourcePlacementId
    )
    if (!routes.length) return false
    const ids = new Set(routes.map((route) => route.id))
    replacePlanWireRoutesForProject(project, [
      ...storedRoutes.filter((route) => !ids.has(route.id)),
      ...routes.map((route) => ({
        ...route,
        source: 'manual' as const,
        hidden: true,
        waypoints: undefined,
      })),
    ])
    return true
  }
  const route =
    edit.operation === 'moveRisers'
      ? undefined
      : findEditablePlanWireRoute(project, edit.floorId, edit.routeId)
  if (edit.operation !== 'moveRisers' && !route) return false

  let next: PlanWireRoute[] | null = null
  switch (edit.operation) {
    case 'insertWaypoint':
      next = upsertPlanWireRouteWaypoint(storedRoutes, route!, edit.point, edit.index)
      break
    case 'moveWaypoint':
      next = movePlanWireRouteWaypoint(storedRoutes, route!, edit.index, edit.point)
      break
    case 'removeWaypoint':
      return removePlanWireRouteWaypoint(project, route!, edit.index)
    case 'moveRiser':
      next = movePlanWireRouteRiser(storedRoutes, route!, edit.point)
      break
    case 'moveRisers': {
      const moves = edit.moves.flatMap(({ routeId, point }) => {
        const candidate = findEditablePlanWireRoute(project, edit.floorId, routeId)
        return candidate ? [{ route: candidate, point }] : []
      })
      if (moves.length !== edit.moves.length) return false
      next = movePlanWireRouteRisers(storedRoutes, moves)
      break
    }
  }
  if (!next || JSON.stringify(next) === before) return false
  replacePlanWireRoutesForProject(project, next)
  return true
}

/** Remove manual non-cable traces from one placement after the user disconnects its plan wiring. */
export function disconnectManualPlanWiresInProject(
  project: ProjectV2,
  floorId: string,
  sourcePlacementId: string
): string[] {
  const routes = selectProjectPlanWireRoutes(project)
  const removed = routes.filter(
    (route) =>
      route.source === 'manual' &&
      route.kind === 'other' &&
      route.floorId === floorId &&
      route.from.placementId === sourcePlacementId
  )
  if (removed.length === 0) return []
  const removedIds = new Set(removed.map((route) => route.id))
  replacePlanWireRoutesForProject(
    project,
    routes.filter((route) => !removedIds.has(route.id))
  )
  return removed.map((route) => route.id)
}
