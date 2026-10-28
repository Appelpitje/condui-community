import type { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'
import { usePlanWireRouteHistory } from '@/hooks/plan/usePlanWireRouteHistory'
import { createPlanWireTargetPreviewQuery } from '@/lib/plan/planWireTargetPreview'
import { planWireColor } from '@/lib/plan/planColors'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'
import React, { useCallback, useState, useEffect, useMemo } from 'react'
import type { Point } from '@/types/ui'
import type { Placement, Point2, PlanWireRoute } from '@/types/schema'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'
import {
  cableCategoryByCircuit,
  cableTraceInfoByAnchor,
  planWireRouteMatchesSelection,
} from '@/lib/cableRouting/cableRoutePlanWires'
import { useCableHoverStore } from '@/components/cableRouting/cableHoverStore'
import type {
  PlanWireEndPlacement,
  PlanWireRiserPreview,
} from '@/components/canvas/plan/PlanWiresLayer'
import { planWireRiserRouteIdsInRect } from '@/lib/plan/planWiringRouteEdits'
import { usePlanPlacements, usePlanWireEditing } from '@/hooks/plan'
import { screenPxToCanvasUnits } from '@/constants/canvasConstants'
import { endpointCanStartPlanWire } from '@/lib/plan/planWiring'
import { getElectricalLookupIndex } from '@/lib/projectV2/electricalLookupIndex'
import {
  circuitIdForPlanEndpoint,
  planWireFocusScope,
  planWireRedrawProgress,
} from '@/lib/plan/planWiringFocus'
import {
  selectProjectAuxiliaryElectricalEnclosures,
  selectProjectElectricalInstallation,
  selectProjectElectricalPanels,
} from '@/lib/projectV2/electrical'

interface PlanCanvasWiringModelOptions {
  activeFloorId: string | null
  sitplanPanelFilterId: string | null
  planVisibility: import('@/types/ui').PlanVisibilityState
  electricalReadProject: import('@/types/projectV2').ProjectV2 | null
  activeTool: import('@/types/ui').PlanToolMode
  planWiringVisibility: import('@/lib/plan/planWiring').ResolvedPlanWiringVisibility
  getEndpointById: (id: string) => import('@/types/schema').Endpoint | undefined
  selection: import('@/types/ui').Selection
  currentProject: import('@/types/projectV2').ProjectV2 | null
  planWireDragSourcePlacementId: string | null
  wiringFocus: {
    focus: import('@/hooks/plan/usePlanWiringFocus').PlanWiringTarget | null
    preview: import('@/hooks/plan/usePlanWiringFocus').PlanWiringTarget | null
    redraw: import('@/lib/plan/planWiringFocus').PlanWireRedraw | null
    frozen: import('@/lib/plan/planWiringFocus').FrozenPlanWireCircuit | null
    circuitIdForPlacement: (placementId: string | null | undefined) => string | null
    focusCircuit: (circuitId: string) => void
    focusPlacement: (
      placementId: string | null | undefined,
      circuitId?: string | null | undefined
    ) => void
    onHoverRoute: React.Dispatch<
      React.SetStateAction<import('@/types/schema').PlanWireRoute | null>
    >
    holdCircuitBeforeDraw: (
      circuitId: string | null,
      routes: import('@/types/schema').PlanWireRoute[]
    ) => void
    startRedraw: (circuitId: string, placementIds: Iterable<string>) => void
    finishRedraw: () => void
  }
  getCircuitIdentifier: (circuitId: string) => string
  isActiveViewport: () => boolean
  applyActiveTool: (tool: import('@/types/ui').PlanToolMode) => void
  window: globalThis.Window
  isResettingScale: boolean
  handleScaleRulerCancel: () => void
  containerRef: React.RefObject<HTMLDivElement | null>
  applyPlanWireDragSourcePlacementId: React.Dispatch<React.SetStateAction<string | null>>
  planWireHoverPlacementId: string | null
  applyPlanWireHoverPlacementId: React.Dispatch<React.SetStateAction<string | null>>
  planWirePreviewPointStore: import('zustand/vanilla').StoreApi<{ point: Point | null }>
  applyPlanWirePreviewPoint: (point: Point | null) => void
  clientToPlan: (clientX: number, clientY: number) => import('@/types/ui').Point | null
  planView: import('@/types/ui').ViewState
  baseSymbolSizePx: ReturnType<typeof usePlanCanvasGeometry>['baseSymbolSizePx']

  planWiring: import('@/types/schema').PlanWiringModel | undefined
}

export function usePlanCanvasWiringModel({
  activeFloorId,
  sitplanPanelFilterId,
  planVisibility,
  electricalReadProject,
  activeTool,
  planWiringVisibility,
  getEndpointById,
  selection,
  currentProject,
  planWireDragSourcePlacementId,
  wiringFocus,
  getCircuitIdentifier,
  isActiveViewport,
  applyActiveTool,
  window,
  isResettingScale,
  handleScaleRulerCancel,
  containerRef,
  applyPlanWireDragSourcePlacementId,
  planWireHoverPlacementId,
  applyPlanWireHoverPlacementId,
  planWirePreviewPointStore,
  applyPlanWirePreviewPoint,
  clientToPlan,
  planView,
  baseSymbolSizePx,
  planWiring,
}: PlanCanvasWiringModelOptions) {
  const { placements, wirePlacements, visiblePlacements } = usePlanPlacements(
    activeFloorId,
    sitplanPanelFilterId,
    planVisibility
  )
  const planWireAnchorPlacementIds = useMemo(
    () => new Set(wirePlacements.map((placement: Placement) => placement.id)),
    [wirePlacements]
  )
  const planWireAnchorEndpointIds = useMemo(
    () =>
      new Set(
        wirePlacements.flatMap((placement) => {
          const row = placement as Placement & { endpointId?: string }
          return row.endpointId ? [row.endpointId] : []
        })
      ),
    [wirePlacements]
  )
  const planWireAnchorTrunkDeviceIds = useMemo(
    () =>
      new Set(
        wirePlacements.flatMap((placement) => {
          const row = placement as Placement & { trunkDeviceId?: string }
          return row.trunkDeviceId ? [row.trunkDeviceId] : []
        })
      ),
    [wirePlacements]
  )
  // Cables hovered in the cable list show on the plan, like the selected one.
  const hoveredCableAnchors = useCableHoverStore((s) => s.anchors)
  const {
    routes: planWireRoutes,
    selectedRiserRouteIds,
    setSelectedRiserRouteIds: applySelectedRiserRouteIds,
  } = usePlanWireRouteHistory({
    activeFloorId,
    activeTool,
    electricalReadProject,
    hoveredCableAnchors,
    planWiring,
    planWiringVisibility,
    selection,
    sitplanPanelFilterId,
    placements,
    planWireAnchorEndpointIds,
    planWireAnchorPlacementIds,
    planWireAnchorTrunkDeviceIds,
    wiringFocus,
  })
  // Junction panels, earth electrodes and supply enclosures sit on the plan through their own
  // placements, not device placements; wires end on them by placement id.
  const junctionPanelPlanPlacements = useMemo(() => {
    const installation = electricalReadProject
      ? selectProjectElectricalInstallation(electricalReadProject)
      : undefined
    const entry = (
      placement: Pick<Placement, 'id' | 'floorId' | 'pos'> &
        Partial<Pick<Placement, 'layer' | 'rotationDeg' | 'scale'>>,
      nodeType: string
    ): [string, PlanWireEndPlacement] => [
      placement.id,
      {
        id: placement.id,
        floorId: placement.floorId,
        layer: placement.layer ?? 'default',
        pos: placement.pos,
        rotationDeg: (placement.rotationDeg ?? 0) as Placement['rotationDeg'],
        scale: placement.scale ?? 1,
        nodeType,
      },
    ]
    return new Map<string, PlanWireEndPlacement>([
      ...(installation?.junctionPanelPlacements ?? []).map((placement) =>
        entry(placement, 'junction_panel')
      ),
      ...(installation?.earthingPlacements ?? []).map((placement) => entry(placement, 'earthing')),
      ...(electricalReadProject
        ? selectProjectAuxiliaryElectricalEnclosures(electricalReadProject)
        : []
      ).flatMap((enclosure) =>
        (enclosure.placements ?? []).map((placement) => entry(placement, 'panel_distribution'))
      ),
    ])
  }, [electricalReadProject])
  // Symbols and ordinary plan wires share the master switch. The wiring tool keeps
  // its category colours even when the ordinary plan is monochrome.
  const planWiresColorCoded = activeTool === 'wiring' || planWiringVisibility.colorCoded === true
  const planWireStrokeFor = useMemo(() => {
    if (!planWiresColorCoded) return undefined
    const info =
      electricalReadProject && isCableRoutesEnabled()
        ? cableTraceInfoByAnchor(electricalReadProject)
        : undefined
    const byCircuit =
      electricalReadProject && isCableRoutesEnabled()
        ? cableCategoryByCircuit(electricalReadProject)
        : undefined
    return (route: PlanWireRoute) => {
      const cableCategory =
        (route.wireAnchor ? info?.get(route.wireAnchor)?.category : undefined) ??
        byCircuit?.get(route.circuitId)
      const target = route.riserExit?.arrivalTo ?? route.to
      const endpoint = target.endpointId ? getEndpointById(target.endpointId) : undefined
      return planWireColor(
        route,
        planWiringVisibility.symbolColors,
        endpoint?.symbol,
        cableCategory
      )
    }
  }, [
    electricalReadProject,
    planWiresColorCoded,
    planWiringVisibility.symbolColors,
    getEndpointById,
  ])
  // Shared by the wire layer and the raised floor-passage handles of the selected cable.
  const [planWireRiserPreview, applyPlanWireRiserPreview] = useState<PlanWireRiserPreview | null>(
    null
  )
  const hoveredPlanWireRouteIds = useMemo(() => {
    const ids = new Set<string>()
    for (const route of planWireRoutes) {
      if (route.wireAnchor && hoveredCableAnchors.has(route.wireAnchor)) ids.add(route.id)
    }
    return ids
  }, [planWireRoutes, hoveredCableAnchors])
  const highlightedPlanWireRouteIds = useMemo(() => {
    const ids = new Set<string>()
    if (isCableRoutesEnabled()) {
      for (const route of planWireRoutes) {
        if (planWireRouteMatchesSelection(route, selection)) ids.add(route.id)
      }
    }
    return ids
  }, [planWireRoutes, selection])
  // Floor passages picked with a drag rectangle in wire mode (symbols are not selectable there).
  // The selected cable's and the selected passages' handles sit above the symbols.
  const raisedRiserRouteIds = useMemo(
    () => new Set([...highlightedPlanWireRouteIds, ...selectedRiserRouteIds]),
    [highlightedPlanWireRouteIds, selectedRiserRouteIds]
  )
  const raisedRiserRoutes = useMemo(
    () =>
      planWireRoutes.filter(
        (route: PlanWireRoute) =>
          raisedRiserRouteIds.has(route.id) && (route.riser || route.riserExit)
      ),
    [planWireRoutes, raisedRiserRouteIds]
  )
  const handleCaptureRectangle = useCallback(
    (
      rect: { x: number; y: number; width: number; height: number },
      modifiers: { shiftKey: boolean; altKey: boolean }
    ): boolean => {
      if (activeTool !== 'wiring') return false
      // A click on empty plan clears the passages; the app selection clears as usual.
      if (rect.width <= 5 || rect.height <= 5) {
        applySelectedRiserRouteIds(new Set())
        return false
      }
      const inside = planWireRiserRouteIdsInRect(planWireRoutes, rect)
      applySelectedRiserRouteIds((current) => {
        if (modifiers.altKey) return new Set([...current].filter((id) => !inside.includes(id)))
        if (modifiers.shiftKey) return new Set([...current, ...inside])
        return new Set(inside)
      })
      return true
    },
    [activeTool, applySelectedRiserRouteIds, planWireRoutes]
  )
  const planWireRoutablePlacementIds = useMemo(
    function () {
      const ids = new Set<string>()
      for (const route of planWireRoutes) {
        if (route.from.placementId) ids.add(route.from.placementId)
        if (route.to.placementId) ids.add(route.to.placementId)
      }
      return ids
    },
    [planWireRoutes]
  )
  const queryPlanWireTarget = useMemo(
    () =>
      createPlanWireTargetPreviewQuery(
        currentProject,
        activeFloorId,
        planWireDragSourcePlacementId,
        isCableRoutesEnabled()
      ),
    [currentProject, activeFloorId, planWireDragSourcePlacementId]
  )
  const getPlanWireTargetStatus = useCallback(
    (targetPlacementId: string): 'legal' | 'illegal' | null => {
      if (!activeFloorId || !currentProject) return null
      const sourcePlacementId = planWireDragSourcePlacementId
      if (!sourcePlacementId) {
        if (planWireRoutablePlacementIds.has(targetPlacementId)) return 'legal'
        const placement = visiblePlacements.find(
          (candidate: Placement & { endpointId?: string; trunkDeviceId?: string }) =>
            candidate.id === targetPlacementId
        )
        if (placement?.trunkDeviceId) return 'legal'
        const endpoint = placement?.endpointId ? getEndpointById(placement.endpointId) : null
        return endpointCanStartPlanWire(endpoint) ? 'legal' : 'illegal'
      }
      if (sourcePlacementId === targetPlacementId) return 'illegal'
      return queryPlanWireTarget(targetPlacementId) ? 'legal' : 'illegal'
    },
    [
      activeFloorId,
      currentProject,
      getEndpointById,
      planWireDragSourcePlacementId,
      planWireRoutablePlacementIds,
      queryPlanWireTarget,
      visiblePlacements,
    ]
  )
  const {
    insertPlanWireWaypoint: handleInsertPlanWireWaypoint,
    movePlanWireWaypoint: handleMovePlanWireWaypoint,
    movePlanWireRiser: handleMovePlanWireRiser,
    movePlanWireRisers: handleMovePlanWireRisers,
    removePlanWireWaypoint: handleRemovePlanWireWaypoint,
    drawPlanWire: handleDrawPlanWire,
    removeManualOtherPlanWiresFromOrigin,
    hideSocketWireRouteForPlacementDrop,
  } = usePlanWireEditing({ activeFloorId, currentProject })
  // Shaping a wire makes its branch the working one, like drawing from one of its symbols.
  const focusWiringPlacement = wiringFocus.focusPlacement
  const handleInsertFocusedPlanWireWaypoint = useCallback(
    (route: PlanWireRoute, point: Point2, waypointIndex: number) => {
      focusWiringPlacement(route.to.placementId, route.circuitId)
      handleInsertPlanWireWaypoint(route, point, waypointIndex)
    },
    [handleInsertPlanWireWaypoint, focusWiringPlacement]
  )
  // Cable roles tell where one branch ends and the feed to another begins.
  const planWireRoleOf = useMemo(() => {
    const info =
      activeTool === 'wiring' && isCableRoutesEnabled() && currentProject
        ? cableTraceInfoByAnchor(currentProject)
        : null
    return (route: PlanWireRoute) =>
      route.wireAnchor ? info?.get(route.wireAnchor)?.role : undefined
  }, [activeTool, currentProject])
  const wiringFocusTarget = wiringFocus.focus
  const wiringRedraw = wiringFocus.redraw
  // The wires and symbols in focus: one branch and its feed to the board. While that branch is
  // redrawn its automatic wires are hidden, so the symbols it had when the redraw started count.
  const wiringFocusScope = useMemo(() => {
    if (!wiringFocusTarget) return null
    if (wiringRedraw && wiringRedraw.circuitId === wiringFocusTarget.circuitId) {
      const placementIds = new Set(wiringRedraw.placementIds)
      const routeIds = new Set(
        planWireRoutes
          .filter(
            (route) =>
              route.circuitId === wiringRedraw.circuitId &&
              [route.from.placementId, route.to.placementId].some(
                (id) => id != null && placementIds.has(id)
              )
          )
          .map((route) => route.id)
      )
      return { circuitId: wiringRedraw.circuitId, placementIds, routeIds }
    }
    return planWireFocusScope(
      planWireRoutes,
      wiringFocusTarget.circuitId,
      wiringFocusTarget.placementId,
      planWireRoleOf
    )
  }, [planWireRoleOf, planWireRoutes, wiringFocusTarget, wiringRedraw])
  const wiringPreview = wiringFocus.preview
  const wiringPreviewRouteIds = useMemo(
    () =>
      wiringPreview
        ? planWireFocusScope(
            planWireRoutes,
            wiringPreview.circuitId,
            wiringPreview.placementId,
            planWireRoleOf
          ).routeIds
        : null,
    [planWireRoleOf, planWireRoutes, wiringPreview]
  )
  // The focus branch's symbols on this floor (the whole circuit's when no symbol was picked).
  const wiringFocusPlacementIds = useMemo(() => {
    if (!wiringFocusScope || !currentProject) return [] as string[]
    const { circuitId, placementIds } = wiringFocusScope
    const panels = selectProjectElectricalPanels(currentProject)
    return visiblePlacements.flatMap((placement: Placement & { endpointId?: string }) =>
      (
        placementIds
          ? placementIds.has(placement.id)
          : circuitIdForPlanEndpoint(panels, placement.endpointId) === circuitId
      )
        ? [placement.id]
        : []
    )
  }, [currentProject, visiblePlacements, wiringFocusScope])
  const wiringRedrawProgress = useMemo(
    () =>
      wiringRedraw
        ? planWireRedrawProgress(planWireRoutes, wiringRedraw.circuitId, wiringRedraw.placementIds)
        : null,
    [planWireRoutes, wiringRedraw]
  )
  const wiringFocusPlacementIdSet = useMemo(
    () => new Set(wiringFocusPlacementIds),
    [wiringFocusPlacementIds]
  )
  // Circuits with a symbol on this floor, for the working-circuit picker.
  const wiringCircuitOptions = useMemo(() => {
    if (activeTool !== 'wiring' || !currentProject) return []
    const panels = selectProjectElectricalPanels(currentProject)
    const ids = new Set<string>()
    for (const placement of visiblePlacements as Array<Placement & { endpointId?: string }>) {
      const circuitId = circuitIdForPlanEndpoint(panels, placement.endpointId)
      if (circuitId) ids.add(circuitId)
    }
    const circuitsById = getElectricalLookupIndex(panels).circuitsById
    return [...ids]
      .map((id) => {
        const code = getCircuitIdentifier(id)
        const notes = circuitsById.get(id)?.circuit.notes?.split('\n')[0]?.trim()
        return { id, code, label: notes ? `${code} · ${notes}` : code }
      })
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
      .map(({ id, label }) => ({ id, label }))
  }, [activeTool, currentProject, getCircuitIdentifier, visiblePlacements])
  useEffect(
    function () {
      if (activeTool !== 'wiring') return
      const handleKeyDown = (event: KeyboardEvent) => {
        if (!isActiveViewport()) return
        if (event.key !== 'Escape') return
        if (isKeyboardTypingTarget(event.target)) return
        event.preventDefault()
        applyActiveTool('none')
      }
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    },
    [activeTool, applyActiveTool, window, isActiveViewport]
  )
  useEffect(
    function () {
      const canCancelWithShortcut =
        activeTool === 'wiring' || activeTool === 'move' || activeTool === 'resetScale'
      if (!canCancelWithShortcut) return
      const handleKeyDown = (event: KeyboardEvent) => {
        if (!isActiveViewport()) return
        if (event.key !== 'Escape') return
        if (isKeyboardTypingTarget(event.target)) return
        event.preventDefault()
        if (activeTool === 'resetScale' && isResettingScale) {
          handleScaleRulerCancel()
          return
        }
        applyActiveTool('none')
      }
      const handleContextMenu = (event: MouseEvent) => {
        if (event.button !== 2) return
        const target = event.target
        if (target instanceof Element && target.closest('[data-floor-selection-row]')) return
        const insidePlan = target instanceof Node && !!containerRef.current?.contains(target)
        if (!insidePlan) return
        event.preventDefault()
        event.stopPropagation()
        if (activeTool === 'resetScale' && isResettingScale) {
          handleScaleRulerCancel()
          return
        }
        applyActiveTool('none')
      }
      window.addEventListener('keydown', handleKeyDown)
      window.addEventListener('contextmenu', handleContextMenu, true)
      return () => {
        window.removeEventListener('keydown', handleKeyDown)
        window.removeEventListener('contextmenu', handleContextMenu, true)
      }
    },
    [
      activeTool,
      applyActiveTool,
      handleScaleRulerCancel,
      isResettingScale,
      window,
      isActiveViewport,
      containerRef,
    ]
  )
  useEffect(
    function () {
      if (activeTool !== 'wiring') {
        if (planWireDragSourcePlacementId !== null) {
          applyPlanWireDragSourcePlacementId(null)
        }
        if (planWireHoverPlacementId !== null) {
          applyPlanWireHoverPlacementId(null)
        }
        if (planWirePreviewPointStore.getState().point !== null) {
          applyPlanWirePreviewPoint(null)
        }
        return
      }
      // Touch pointers can stay captured by the source canvas node. Resolve the
      // target from coordinates rather than relying on mouse enter/up events.
      const targetAt = (event: PointerEvent) => {
        const point = clientToPlan(event.clientX, event.clientY)
        if (!point) return null
        let nearest: string | null = null
        let nearestDistance = Infinity
        for (const placement of visiblePlacements) {
          const pos = placement.pos
          const radius = Math.max(
            screenPxToCanvasUnits(planView.zoom, 14, 8, 28),
            (baseSymbolSizePx * (placement.scale ?? 1)) / 2
          )
          const distance = Math.hypot(point.x - pos.x, point.y - pos.y)
          if (distance <= radius && distance < nearestDistance) {
            nearest = placement.id
            nearestDistance = distance
          }
        }
        return nearest
      }
      const clearDrag = () => {
        applyPlanWireDragSourcePlacementId(null)
        applyPlanWireHoverPlacementId(null)
        applyPlanWirePreviewPoint(null)
      }
      const handlePointerMove = (event: PointerEvent) => {
        if (!planWireDragSourcePlacementId) return
        const point = clientToPlan(event.clientX, event.clientY)
        if (point) applyPlanWirePreviewPoint(point)
        applyPlanWireHoverPlacementId(targetAt(event))
      }
      const handlePointerUp = (event: PointerEvent) => {
        const sourcePlacementId = planWireDragSourcePlacementId
        const targetPlacementId = targetAt(event)
        if (sourcePlacementId && targetPlacementId && sourcePlacementId !== targetPlacementId) {
          if (getPlanWireTargetStatus(targetPlacementId) === 'legal') {
            wiringFocus.holdCircuitBeforeDraw(
              wiringFocus.circuitIdForPlacement(sourcePlacementId),
              planWireRoutes
            )
            handleDrawPlanWire(sourcePlacementId, targetPlacementId)
          }
        } else if (sourcePlacementId && !targetPlacementId && currentProject && activeFloorId) {
          const sourcePlacement = visiblePlacements.find(
            (placement: Placement & { endpointId?: string }) => placement.id === sourcePlacementId
          )
          const endpoint = sourcePlacement?.endpointId
            ? getEndpointById(sourcePlacement.endpointId)
            : null
          if (
            !removeManualOtherPlanWiresFromOrigin(sourcePlacementId) &&
            endpoint?.type === 'socket'
          ) {
            hideSocketWireRouteForPlacementDrop(sourcePlacementId)
          }
        }
        clearDrag()
      }
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', clearDrag)
      return () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', clearDrag)
      }
    },
    [
      activeFloorId,
      activeTool,
      applyPlanWireDragSourcePlacementId,
      applyPlanWireHoverPlacementId,
      applyPlanWirePreviewPoint,
      clientToPlan,
      currentProject,
      getEndpointById,
      hideSocketWireRouteForPlacementDrop,
      baseSymbolSizePx,
      planView.zoom,
      getPlanWireTargetStatus,
      wiringFocus,
      planWireRoutes,
      handleDrawPlanWire,
      removeManualOtherPlanWiresFromOrigin,
      planWireDragSourcePlacementId,
      planWireHoverPlacementId,
      planWirePreviewPointStore,
      visiblePlacements,
      window,
    ]
  )

  return {
    placements,
    visiblePlacements,
    planWireRoutes,
    selectedRiserRouteIds,
    junctionPanelPlanPlacements,
    planWireStrokeFor,
    planWireRiserPreview,
    applyPlanWireRiserPreview,
    hoveredPlanWireRouteIds,
    highlightedPlanWireRouteIds,
    raisedRiserRouteIds,
    raisedRiserRoutes,
    handleCaptureRectangle,
    getPlanWireTargetStatus,
    handleMovePlanWireWaypoint,
    handleMovePlanWireRiser,
    handleMovePlanWireRisers,
    handleRemovePlanWireWaypoint,
    handleInsertFocusedPlanWireWaypoint,
    wiringFocusTarget,
    wiringFocusScope,
    wiringPreviewRouteIds,
    wiringFocusPlacementIds,
    wiringRedrawProgress,
    wiringFocusPlacementIdSet,
    wiringCircuitOptions,
  }
}
