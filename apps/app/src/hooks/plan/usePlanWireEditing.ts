import { useCallback } from 'react'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import type { ProjectState } from '@/stores/projectStore'
import type { Point2, PlanWireRoute } from '@/types/schema'

type UsePlanWireEditingOptions = {
  activeFloorId: string | null
  currentProject: ProjectState['currentProject']
}

export function usePlanWireEditing({ activeFloorId, currentProject }: UsePlanWireEditingOptions) {
  const insertPlanWireWaypoint = useCallback(
    (route: PlanWireRoute, point: Point2, waypointIndex: number) => {
      if (!activeFloorId) return
      runProjectCommand('plan.editWireRoute', {
        operation: 'insertWaypoint', floorId: activeFloorId, routeId: route.id,
        point, index: waypointIndex,
      }, { source: 'plan-wire-editing' })
    },
    [activeFloorId],
  )

  const movePlanWireWaypoint = useCallback(
    (route: PlanWireRoute, waypointIndex: number, point: Point2) => {
      if (!activeFloorId) return
      runProjectCommand('plan.editWireRoute', {
        operation: 'moveWaypoint', floorId: activeFloorId, routeId: route.id,
        point, index: waypointIndex,
      }, { source: 'plan-wire-editing' })
    },
    [activeFloorId],
  )

  const movePlanWireRiser = useCallback((route: PlanWireRoute, point: Point2) => {
    if (!activeFloorId) return
    runProjectCommand('plan.editWireRoute', {
      operation: 'moveRiser', floorId: activeFloorId, routeId: route.id, point,
    }, { source: 'plan-wire-editing' })
  }, [activeFloorId])

  /** Several floor passages dragged together, as one edit. */
  const movePlanWireRisers = useCallback(
    (moves: ReadonlyArray<{ route: PlanWireRoute; point: Point2 }>) => {
      if (!activeFloorId || moves.length === 0) return
      runProjectCommand('plan.editWireRoute', {
        operation: 'moveRisers', floorId: activeFloorId,
        moves: moves.map(({ route, point }) => ({ routeId: route.id, point })),
      }, { source: 'plan-wire-editing' })
    },
    [activeFloorId],
  )

  const removePlanWireWaypoint = useCallback((route: PlanWireRoute, waypointIndex: number) => {
    if (!activeFloorId) return
    runProjectCommand('plan.editWireRoute', {
      operation: 'removeWaypoint', floorId: activeFloorId, routeId: route.id, index: waypointIndex,
    }, { source: 'plan-wire-editing' })
  }, [activeFloorId])

  const drawPlanWire = useCallback(
    (sourcePlacementId: string, targetPlacementId: string) => {
      if (!activeFloorId || !currentProject || sourcePlacementId === targetPlacementId) return
      runProjectCommand('plan.drawWire', {
        floorId: activeFloorId,
        sourcePlacementId,
        targetPlacementId,
        keepAutoSpans: isCableRoutesEnabled(),
      })
    },
    [activeFloorId, currentProject],
  )

  const removeManualOtherPlanWiresFromOrigin = useCallback(
    (sourcePlacementId: string) => {
      if (!activeFloorId) return false
      const result = runProjectCommand('plan.disconnectWires', {
        floorId: activeFloorId, sourcePlacementId,
      }, { source: 'plan-wire-editing' })
      return !!result?.changed
    },
    [activeFloorId],
  )

  const hideSocketWireRouteForPlacementDrop = useCallback(
    (sourcePlacementId: string) => {
      if (!activeFloorId) return
      runProjectCommand('plan.editWireRoute', {
        operation: 'hideSocketRoutes', floorId: activeFloorId, sourcePlacementId,
      }, { source: 'plan-wire-editing' })
    },
    [activeFloorId],
  )

  return {
    insertPlanWireWaypoint,
    movePlanWireWaypoint,
    movePlanWireRiser,
    movePlanWireRisers,
    removePlanWireWaypoint,
    drawPlanWire,
    removeManualOtherPlanWiresFromOrigin,
    hideSocketWireRouteForPlacementDrop,
  }
}
