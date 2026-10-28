import { useMemo, useState } from 'react'
import type { ProjectV2 } from '@/types/projectV2'
import type { Placement, PlanWireKind, PlanWireRoute } from '@/types/schema'
import type { Selection } from '@/types/ui'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'
import { cableCategoryByCircuit, cableTraceInfoByAnchor, hasOwnCableToggle,
  isCableTraceShown, planWireRouteMatchesSelection } from '@/lib/cableRouting/cableRoutePlanWires'
import { isWireToolTraceVisible } from '@/lib/cableRouting/planWireCategoryVisibility'
import { deriveAutoPlanWireRoutes, filterPlanWireRoutesForPanel,
  filterPlanWireRoutesForSymbolVisibility, mergePlanWireRoutes, planWireKindsForVisibility,
  type resolvePlanWiringVisibility } from '@/lib/plan/planWiring'
import { applyPlanWireEditingState } from '@/lib/plan/planWiringFocus'
import { reusePlanWireRoutes } from '@/lib/plan/planWireRouteIdentity'
import type { selectProjectPlanWiringProjection } from '@/lib/projectV2/planWiring'

interface Source {
  activeFloorId: string | null
  activeTool: string
  electricalReadProject: ProjectV2 | null
  hoveredCableAnchors: ReadonlySet<string>
  planWiring: ReturnType<typeof selectProjectPlanWiringProjection> | undefined
  planWiringVisibility: ReturnType<typeof resolvePlanWiringVisibility>
  selection: Selection
  sitplanPanelFilterId: string | null
  placements: Placement[]
  planWireAnchorEndpointIds: Set<string>
  planWireAnchorPlacementIds: Set<string>
  planWireAnchorTrunkDeviceIds: Set<string>
  wiringFocus: Pick<Parameters<typeof applyPlanWireEditingState>[1], 'frozen' | 'redraw'>
}

/** Derive visible routes and retain identity across electrical/visibility changes.
 * An empty input route set keeps history; filtering a nonempty set to empty clears it. */
export function usePlanWireRouteHistory(source: Source) {
  const { activeFloorId, activeTool, electricalReadProject, hoveredCableAnchors,
    planWiring, planWiringVisibility, selection, sitplanPanelFilterId, placements,
    planWireAnchorEndpointIds, planWireAnchorPlacementIds, planWireAnchorTrunkDeviceIds,
    wiringFocus } = source
  const frozen = wiringFocus.frozen
  const redraw = wiringFocus.redraw
  const derived = useMemo(() => {
  const wiringMode = activeTool === 'wiring'
  let includeKinds = planWireKindsForVisibility(planWiringVisibility)
  // Wire mode starts with every cable; its colour-group controls filter below.
  if (isCableRoutesEnabled() && wiringMode) {
    includeKinds = ['lighting-control', 'sockets', 'other']
  }
  // Edited supply and earthing cables keep their own toggle, like their automatic traces.
  const cableInfo =
    isCableRoutesEnabled() && electricalReadProject
      ? cableTraceInfoByAnchor(electricalReadProject)
      : null
  const mergedRoutesFor = (kinds: PlanWireKind[]) =>
    kinds.length === 0
      ? []
      : mergePlanWireRoutes(
          deriveAutoPlanWireRoutes(electricalReadProject, activeFloorId, kinds),
          planWiring?.routes.filter(
            (route: PlanWireRoute) =>
              route.floorId === activeFloorId &&
              (kinds.includes(route.kind) ||
                (cableInfo !== null && hasOwnCableToggle(route, cableInfo)))
          )
        )
  let routes = mergedRoutesFor(includeKinds)
  // In wire mode, explicit visibility choices also hide selected/hovered cables.
  if (isCableRoutesEnabled() && wiringMode && cableInfo && electricalReadProject) {
    const byCircuit = cableCategoryByCircuit(electricalReadProject)
    routes = routes.filter((route) =>
      isWireToolTraceVisible(route, cableInfo, byCircuit, planWiringVisibility)
    )
  }
  // Outside wire mode, the selected cable shows even when its kind is hidden.
  if (isCableRoutesEnabled() && !wiringMode) {
    if (electricalReadProject) {
      const info = cableTraceInfoByAnchor(electricalReadProject)
      routes = routes.filter((route) => isCableTraceShown(route, info, planWiringVisibility))
    }
    const shown = new Set(routes.map((route) => route.id))
    const selected = mergedRoutesFor(['lighting-control', 'sockets', 'other']).filter(
      (route) =>
        !shown.has(route.id) &&
        (planWireRouteMatchesSelection(route, selection) ||
          (route.wireAnchor != null && hoveredCableAnchors.has(route.wireAnchor)))
    )
    if (selected.length > 0) routes = [...routes, ...selected]
  }
  // A circuit being redrawn hides its automatic wires; one being edited holds them still.
  routes = applyPlanWireEditingState(routes, {
    floorId: activeFloorId,
    redraw: redraw,
    frozen: frozen,
  })
  if (routes.length === 0) return { routes: [], retainHistory: true }
  const panelFilteredRoutes = sitplanPanelFilterId
    ? filterPlanWireRoutesForPanel(routes, sitplanPanelFilterId, {
        allowedPlacementIds: new Set<string>(
          placements.map((placement: Placement) => placement.id)
        ),
        project: electricalReadProject,
      })
    : routes
  const visibleRoutes = filterPlanWireRoutesForSymbolVisibility(panelFilteredRoutes, {
    visiblePlacementIds: planWireAnchorPlacementIds,
    visibleEndpointIds: planWireAnchorEndpointIds,
    visibleTrunkDeviceIds: planWireAnchorTrunkDeviceIds,
  })
  return { routes: visibleRoutes, retainHistory: false }
  }, [activeFloorId, activeTool, electricalReadProject, , planWiring,
    planWiringVisibility, selection, sitplanPanelFilterId, placements, planWireAnchorEndpointIds,
    planWireAnchorPlacementIds, planWireAnchorTrunkDeviceIds, frozen, redraw])
  const [history, setHistory] = useState(() => ({
    derived,
    retained: derived.retainHistory ? [] : derived.routes,
    routes: derived.routes,
  }))
  let routes = history.routes
  if (history.derived !== derived) {
    routes = derived.retainHistory ? derived.routes : reusePlanWireRoutes(history.retained, derived.routes)
    setHistory({ derived, retained: derived.retainHistory ? history.retained : routes, routes })
  }
  const [selectedRiserRouteIds, setSelectedRiserRouteIds] = useState<ReadonlySet<string>>(() => new Set())
  const [riserSource, setRiserSource] = useState({ activeTool, activeFloorId })
  if (riserSource.activeTool !== activeTool || riserSource.activeFloorId !== activeFloorId) {
    setRiserSource({ activeTool, activeFloorId })
    if (activeTool !== 'wiring') setSelectedRiserRouteIds(new Set())
  }
  return { routes, selectedRiserRouteIds, setSelectedRiserRouteIds }
}
