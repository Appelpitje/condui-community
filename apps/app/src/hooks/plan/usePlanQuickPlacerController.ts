import type { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'
import type { usePlanQuickPlacerPreview } from '@/hooks/plan/usePlanQuickPlacerPreview'
import type React from 'react'
import {
  QUICK_PLACER_FLOOR_KEYS,
  findQuickPlacerStartIndexForSelection,
} from '@/components/canvas/plan/planCanvasBindings'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'
import { useCallback, useEffect } from 'react'
import type { Point } from '@/types/ui'
import type { Placement } from '@/types/schema'
import { suggestRotationForPlacement } from '@/utils/planAutoOrient'
import { getEndpointPlanWallFacingSide } from '@/lib/plan/planWallOrientation'
import { hasExplicitSituationPlanRotation } from '@/lib/plan/situationPlanRotation'
import { type QuickPlacerMode } from '@/hooks/plan'
import {
  findNextQuickPlacerCircuit,
  findFirstAwaitingQuickPlacerItem,
  flattenQuickPlacerCircuit,
  type QuickPlacerItem,
} from '@/lib/plan/quickPlacer'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import { applyEendraadCircuitFocus } from '@/lib/eendraad/focusCircuit'

interface PlanQuickPlacerControllerOptions {
  applyQuickPlacerOpen: (open: boolean) => void
  leftDockPanel: import('@/stores/uiStore').LeftDockPanel
  applyLeftDockPanel: (panel: import('@/stores/uiStore').LeftDockPanel) => void
  applyQuickPlacerMode: React.Dispatch<
    React.SetStateAction<import('@/hooks/plan/usePlanQuickPlacerState').QuickPlacerMode>
  >
  applyQuickPlacerManualCircuitFocusToken: React.Dispatch<React.SetStateAction<number>>
  applyQuickPlacerFastIndex: React.Dispatch<React.SetStateAction<number>>
  applyQuickPlacerDraggedPlacementId: React.Dispatch<React.SetStateAction<string | null>>
  quickPlacerDraggedPlacementIdRef: React.RefObject<string | null>
  applyQuickPlacerCursorHint: React.Dispatch<
    React.SetStateAction<
      import('@/hooks/plan/usePlanQuickPlacerState').QuickPlacerCursorHint | null
    >
  >
  applyQuickPlacerFastPreviewClient: React.Dispatch<
    React.SetStateAction<import('@/types/ui').Point | null>
  >
  clearHover: () => void
  planIsInLayout: boolean
  quickPlacerOpen: boolean
  quickPlacerDocked: boolean
  leftDockCollapsed: boolean
  applyQuickPlacerDockHost: React.Dispatch<React.SetStateAction<HTMLElement | null>>
  document: Document
  window: globalThis.Window
  quickPlacerCircuits: ReturnType<typeof usePlanQuickPlacerPreview>['quickPlacerCircuits']
  quickPlacerSelectedCircuitId: string | null
  applyQuickPlacerSelectedCircuitId: React.Dispatch<React.SetStateAction<string | null>>
  quickPlacerFastIndex: number
  quickPlacerMode: import('@/hooks/plan/usePlanQuickPlacerState').QuickPlacerMode
  quickPlacerSequence: ReturnType<typeof usePlanQuickPlacerPreview>['quickPlacerSequence']
  quickPlacerWasFastRef: React.RefObject<boolean>
  quickPlacerPreviousSelectionRef: React.RefObject<import('@/types/ui').Selection | null>
  selection: import('@/types/ui').Selection
  applySelection: (selection: import('@/types/ui').Selection) => void
  selectedQuickPlacerCircuit: ReturnType<
    typeof usePlanQuickPlacerPreview
  >['selectedQuickPlacerCircuit']
  quickPlacerManualCircuitFocusToken: number
  requestFitToView: (canvases: import('@/types/ui').CanvasType[]) => void
  currentQuickPlacerFastItem: ReturnType<
    typeof usePlanQuickPlacerPreview
  >['currentQuickPlacerFastItem']
  suppressQuickPlacerPanelFocusRef: React.RefObject<boolean>
  applyHover: (hover: import('@/types/ui').Selection) => void
  quickPlacerFastAutoSkipCustom: boolean
  applyQuickPlacerFastAutoSkipCustom: React.Dispatch<React.SetStateAction<boolean>>
  applyQuickPlacerFocusPlacementId: React.Dispatch<React.SetStateAction<string | null>>
  eendraadIsInLayout: boolean
  activeFloorId: string | null
  getPlacementById: (id: string) =>
    | (import('@/types/schema').Placement & {
        endpointId?: string | undefined
        trunkDeviceId?: string | undefined
        enclosureId?: string | undefined
        isEarthing?: boolean | undefined
      })
    | undefined
  snapPlacementPosition: ReturnType<typeof usePlanCanvasGeometry>['snapPlacementPosition']
  getEndpointById: (id: string) => import('@/types/schema').Endpoint | undefined
  planImageForAnalysis: HTMLImageElement | null
  planImagePosition: import('@/types/schema').Point2
  wallsForRender: ReturnType<typeof usePlanCanvasGeometry>['wallsForRender']
  baseSymbolSizePx: ReturnType<typeof usePlanCanvasGeometry>['baseSymbolSizePx']
  updatePlacement: (id: string, updates: Partial<import('@/types/schema').Placement>) => void
  showQuickPlacerHint: (
    message: string,
    clientX: number,
    clientY: number,
    tone?: 'error' | 'info'
  ) => void
  clientToPlan: (clientX: number, clientY: number) => import('@/types/ui').Point | null
  isActiveViewport: () => boolean
  floors: (import('@/types/schema').Floor | import('@/types/projectV2').FloorV2)[]
  applyActiveFloor: (floorId: string | null) => void
  quickPlacerPanelRef: React.RefObject<HTMLDivElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
}

export function usePlanQuickPlacerController({
  applyQuickPlacerOpen,
  leftDockPanel,
  applyLeftDockPanel,
  applyQuickPlacerMode,
  applyQuickPlacerManualCircuitFocusToken,
  applyQuickPlacerFastIndex,
  applyQuickPlacerDraggedPlacementId,
  quickPlacerDraggedPlacementIdRef,
  applyQuickPlacerCursorHint,
  applyQuickPlacerFastPreviewClient,
  clearHover,
  planIsInLayout,
  quickPlacerOpen,
  quickPlacerDocked,
  leftDockCollapsed,
  applyQuickPlacerDockHost,
  document,
  window,
  quickPlacerCircuits,
  quickPlacerSelectedCircuitId,
  applyQuickPlacerSelectedCircuitId,
  quickPlacerFastIndex,
  quickPlacerMode,
  quickPlacerSequence,
  quickPlacerWasFastRef,
  quickPlacerPreviousSelectionRef,
  selection,
  applySelection,
  selectedQuickPlacerCircuit,
  quickPlacerManualCircuitFocusToken,
  requestFitToView,
  currentQuickPlacerFastItem,
  suppressQuickPlacerPanelFocusRef,
  applyHover,
  quickPlacerFastAutoSkipCustom,
  applyQuickPlacerFastAutoSkipCustom,
  applyQuickPlacerFocusPlacementId,
  eendraadIsInLayout,
  activeFloorId,
  getPlacementById,
  snapPlacementPosition,
  getEndpointById,
  planImageForAnalysis,
  planImagePosition,
  wallsForRender,
  baseSymbolSizePx,
  updatePlacement,
  showQuickPlacerHint,
  clientToPlan,
  isActiveViewport,
  floors,
  applyActiveFloor,
  quickPlacerPanelRef,
  containerRef,
}: PlanQuickPlacerControllerOptions) {
  const closeQuickPlacer = useCallback(
    function () {
      applyQuickPlacerOpen(false)
      if (leftDockPanel === 'quickPlacer') {
        applyLeftDockPanel('library')
      }
      applyQuickPlacerMode('slow')
      applyQuickPlacerManualCircuitFocusToken(0)
      applyQuickPlacerFastIndex(0)
      applyQuickPlacerDraggedPlacementId(null)
      quickPlacerDraggedPlacementIdRef.current = null
      applyQuickPlacerCursorHint(null)
      applyQuickPlacerFastPreviewClient(null)
      clearHover()
    },
    [
      applyLeftDockPanel,
      applyQuickPlacerCursorHint,
      applyQuickPlacerDraggedPlacementId,
      applyQuickPlacerFastIndex,
      applyQuickPlacerFastPreviewClient,
      applyQuickPlacerManualCircuitFocusToken,
      applyQuickPlacerMode,
      applyQuickPlacerOpen,
      clearHover,
      leftDockPanel,
      quickPlacerDraggedPlacementIdRef,
    ]
  )

  useEffect(
    function () {
      if (planIsInLayout) return
      closeQuickPlacer()
    },
    [closeQuickPlacer, planIsInLayout]
  )

  const quickPlacerVisible = quickPlacerOpen || quickPlacerDocked

  const openFloatingQuickPlacer = useCallback(
    function () {
      if (quickPlacerDocked) {
        applyLeftDockPanel('library')
      }
      applyQuickPlacerOpen(true)
      applyQuickPlacerMode('slow')
      applyQuickPlacerFastIndex(0)
    },
    [
      applyLeftDockPanel,
      applyQuickPlacerFastIndex,
      applyQuickPlacerMode,
      applyQuickPlacerOpen,
      quickPlacerDocked,
    ]
  )

  useEffect(
    function () {
      if (!quickPlacerDocked || leftDockCollapsed) {
        applyQuickPlacerDockHost(null)
        return
      }

      const syncDockHost = () => {
        applyQuickPlacerDockHost(document.getElementById('left-dock-quick-placer-host'))
      }

      syncDockHost()
      const frameId = window.requestAnimationFrame(syncDockHost)
      return () => window.cancelAnimationFrame(frameId)
    },
    [applyQuickPlacerDockHost, quickPlacerDocked, leftDockCollapsed, window, document]
  )

  useEffect(
    function () {
      if (quickPlacerCircuits.length === 0) {
        if (quickPlacerSelectedCircuitId !== null) {
          applyQuickPlacerSelectedCircuitId(null)
        }
        if (quickPlacerFastIndex !== 0) {
          applyQuickPlacerFastIndex(0)
        }
        if (quickPlacerMode === 'fast') {
          applyQuickPlacerMode('slow')
        }
        return
      }
      if (
        !quickPlacerSelectedCircuitId ||
        !quickPlacerCircuits.some((circuit) => circuit.id === quickPlacerSelectedCircuitId)
      ) {
        const nextCircuitId = quickPlacerCircuits[0]!.id
        if (quickPlacerSelectedCircuitId !== nextCircuitId) {
          applyQuickPlacerSelectedCircuitId(nextCircuitId)
        }
      }
    },
    [
      applyQuickPlacerFastIndex,
      applyQuickPlacerMode,
      applyQuickPlacerSelectedCircuitId,
      quickPlacerCircuits,
      quickPlacerFastIndex,
      quickPlacerMode,
      quickPlacerSelectedCircuitId,
    ]
  )

  useEffect(
    function () {
      if (quickPlacerSequence.length === 0) {
        if (quickPlacerFastIndex !== 0) applyQuickPlacerFastIndex(0)
        if (quickPlacerMode === 'fast') applyQuickPlacerMode('slow')
        return
      }
      if (quickPlacerFastIndex >= quickPlacerSequence.length) {
        applyQuickPlacerFastIndex(quickPlacerSequence.length - 1)
      }
    },
    [
      applyQuickPlacerFastIndex,
      applyQuickPlacerMode,
      quickPlacerFastIndex,
      quickPlacerMode,
      quickPlacerSequence.length,
    ]
  )

  useEffect(
    function () {
      const isFast = quickPlacerVisible && quickPlacerMode === 'fast'
      if (isFast && !quickPlacerWasFastRef.current) {
        quickPlacerPreviousSelectionRef.current = selection
        quickPlacerWasFastRef.current = true
        return
      }
      if (!isFast && quickPlacerWasFastRef.current) {
        const previousSelection = quickPlacerPreviousSelectionRef.current
        if (previousSelection) {
          applySelection(previousSelection)
        }
        quickPlacerPreviousSelectionRef.current = null
        quickPlacerWasFastRef.current = false
      }
    },
    [
      quickPlacerVisible,
      quickPlacerMode,
      selection,
      applySelection,
      quickPlacerWasFastRef,
      quickPlacerPreviousSelectionRef,
    ]
  )

  useEffect(
    function () {
      if (
        !quickPlacerVisible ||
        !selectedQuickPlacerCircuit ||
        quickPlacerManualCircuitFocusToken === 0
      )
        return
      applyEendraadCircuitFocus({
        circuitId: selectedQuickPlacerCircuit.id,
        setSelection: applySelection,
        requestFitToView,
      })
    },
    [
      quickPlacerVisible,
      quickPlacerManualCircuitFocusToken,
      selectedQuickPlacerCircuit,
      selectedQuickPlacerCircuit?.id,
      applySelection,
      requestFitToView,
    ]
  )

  useEffect(
    function () {
      if (
        !quickPlacerVisible ||
        quickPlacerMode !== 'fast' ||
        !currentQuickPlacerFastItem ||
        !selectedQuickPlacerCircuit
      )
        return
      if (suppressQuickPlacerPanelFocusRef.current) {
        suppressQuickPlacerPanelFocusRef.current = false
        return
      }
      applyEendraadCircuitFocus({
        circuitId: selectedQuickPlacerCircuit.id,
        setSelection: applySelection,
        requestFitToView,
      })
    },
    [
      quickPlacerVisible,
      quickPlacerMode,
      currentQuickPlacerFastItem?.placement.id,
      currentQuickPlacerFastItem,
      selectedQuickPlacerCircuit,
      selectedQuickPlacerCircuit?.id,
      applySelection,
      requestFitToView,
      suppressQuickPlacerPanelFocusRef,
    ]
  )

  useEffect(
    function () {
      if (!quickPlacerVisible || quickPlacerMode !== 'fast' || !currentQuickPlacerFastItem) return
      applyHover(
        currentQuickPlacerFastItem.trunkDeviceId
          ? { type: 'trunkDevice', ids: [currentQuickPlacerFastItem.trunkDeviceId] }
          : { type: 'endpoint', ids: [currentQuickPlacerFastItem.endpoint.id] }
      )
    },
    [
      quickPlacerVisible,
      quickPlacerMode,
      currentQuickPlacerFastItem,
      currentQuickPlacerFastItem?.placement.id,
      applyHover,
    ]
  )

  const advanceQuickPlacerFastTarget = useCallback(
    function (options?: { placedItemLeavesSequence?: boolean }) {
      if (quickPlacerSequence.length === 0) {
        applyQuickPlacerFastIndex(0)
        return
      }

      // With auto-skip, a just-placed default item drops out of the sequence and the next
      // item slides into the current index; stepping forward would skip it.
      const step = options?.placedItemLeavesSequence ? 0 : 1
      const remaining = quickPlacerSequence.length - (options?.placedItemLeavesSequence ? 1 : 0)
      if (quickPlacerFastIndex + step < remaining) {
        applyQuickPlacerFastIndex(quickPlacerFastIndex + step)
        return
      }

      if (!selectedQuickPlacerCircuit) {
        applyQuickPlacerFastIndex(0)
        return
      }

      const nextCircuit = findNextQuickPlacerCircuit(
        quickPlacerCircuits,
        selectedQuickPlacerCircuit.id,
        {
          autoSkipCustom: quickPlacerFastAutoSkipCustom,
        }
      )
      if (nextCircuit) {
        applyQuickPlacerSelectedCircuitId(nextCircuit.id)
        applyQuickPlacerFastIndex(0)
        return
      }

      applyQuickPlacerFastIndex(0)
    },
    [
      quickPlacerFastAutoSkipCustom,
      quickPlacerFastIndex,
      quickPlacerSequence.length,
      quickPlacerCircuits,
      selectedQuickPlacerCircuit,
      applyQuickPlacerFastIndex,
      applyQuickPlacerSelectedCircuitId,
    ]
  )

  const handleQuickPlacerModeChange = useCallback(
    (mode: QuickPlacerMode) => {
      if (mode !== quickPlacerMode) {
        trackGoogleAnalyticsEvent('quick_placer_mode_change', {
          from_mode: quickPlacerMode,
          to_mode: mode,
          circuit_count: quickPlacerCircuits.length,
          item_count: quickPlacerSequence.length,
          auto_skip_custom: quickPlacerFastAutoSkipCustom,
        })
      }
      applyQuickPlacerMode(mode)
      if (mode === 'fast') {
        if (quickPlacerSequence.length === 0 && quickPlacerFastAutoSkipCustom) {
          const selectedCircuitHasItemsWithoutSkipping = selectedQuickPlacerCircuit
            ? flattenQuickPlacerCircuit(selectedQuickPlacerCircuit, {
                autoSkipCustom: false,
              }).length > 0
            : false
          const firstCircuitWithItemsWithoutSkipping = selectedCircuitHasItemsWithoutSkipping
            ? null
            : (quickPlacerCircuits.find(
                (circuit) =>
                  flattenQuickPlacerCircuit(circuit, {
                    autoSkipCustom: false,
                  }).length > 0
              ) ?? null)

          if (selectedCircuitHasItemsWithoutSkipping || firstCircuitWithItemsWithoutSkipping) {
            applyQuickPlacerFastAutoSkipCustom(false)
            if (firstCircuitWithItemsWithoutSkipping) {
              applyQuickPlacerSelectedCircuitId(firstCircuitWithItemsWithoutSkipping.id)
            }
          }
        }
        const selectedStartIndex = findQuickPlacerStartIndexForSelection(
          quickPlacerSequence,
          selection
        )
        applyQuickPlacerFastIndex(selectedStartIndex >= 0 ? selectedStartIndex : 0)
      } else {
        applyQuickPlacerDraggedPlacementId(null)
        quickPlacerDraggedPlacementIdRef.current = null
        applyQuickPlacerFastPreviewClient(null)
        clearHover()
      }
    },
    [
      clearHover,
      applyQuickPlacerDraggedPlacementId,
      applyQuickPlacerFastAutoSkipCustom,
      applyQuickPlacerFastIndex,
      applyQuickPlacerFastPreviewClient,
      applyQuickPlacerMode,
      applyQuickPlacerSelectedCircuitId,
      quickPlacerMode,
      quickPlacerCircuits,
      quickPlacerFastAutoSkipCustom,
      quickPlacerSequence,
      selection,
      selectedQuickPlacerCircuit,
      quickPlacerDraggedPlacementIdRef,
    ]
  )

  const handleQuickPlacerSelectedCircuitChange = useCallback(
    (circuitId: string) => {
      applyQuickPlacerSelectedCircuitId(circuitId)
      applyQuickPlacerManualCircuitFocusToken((value) => value + 1)
      applyQuickPlacerFastIndex(0)
      trackGoogleAnalyticsEvent('quick_placer_circuit_select', {
        mode: quickPlacerMode,
      })
    },
    [
      applyQuickPlacerFastIndex,
      applyQuickPlacerManualCircuitFocusToken,
      applyQuickPlacerSelectedCircuitId,
      quickPlacerMode,
    ]
  )

  // Tool bubble: open on the first symbol that is not on the plan yet, if any.
  const openQuickPlacerAtFirstAwaiting = useCallback(() => {
    openFloatingQuickPlacer()
    const first = findFirstAwaitingQuickPlacerItem(quickPlacerCircuits)
    if (!first) return
    applyQuickPlacerSelectedCircuitId(first.circuit.id)
    applyQuickPlacerManualCircuitFocusToken((value) => value + 1)
    const sequence = flattenQuickPlacerCircuit(first.circuit, {
      autoSkipCustom: quickPlacerFastAutoSkipCustom,
    })
    const index = sequence.findIndex((item) => item.placement.id === first.item.placement.id)
    applyQuickPlacerFastIndex(Math.max(0, index))
    applyQuickPlacerFocusPlacementId(first.item.placement.id)
  }, [
    applyQuickPlacerFastIndex,
    applyQuickPlacerFocusPlacementId,
    applyQuickPlacerManualCircuitFocusToken,
    applyQuickPlacerSelectedCircuitId,
    openFloatingQuickPlacer,
    quickPlacerCircuits,
    quickPlacerFastAutoSkipCustom,
  ])

  const handleQuickPlacerSelectedPanelChange = useCallback(
    (panelId: string) => {
      const firstCircuit = quickPlacerCircuits.find((circuit) => circuit.panelId === panelId)
      if (!firstCircuit) return
      if (quickPlacerMode === 'fast') suppressQuickPlacerPanelFocusRef.current = true
      applyQuickPlacerSelectedCircuitId(firstCircuit.id)
      applyQuickPlacerFastIndex(0)
      trackGoogleAnalyticsEvent('quick_placer_panel_select', {
        mode: quickPlacerMode,
      })
    },
    [
      applyQuickPlacerFastIndex,
      applyQuickPlacerSelectedCircuitId,
      quickPlacerCircuits,
      quickPlacerMode,
      suppressQuickPlacerPanelFocusRef,
    ]
  )

  const handleQuickPlacerItemActivate = useCallback(
    (item: QuickPlacerItem) => {
      applySelection({ type: 'placement', ids: [item.placement.id] })
      trackGoogleAnalyticsEvent('quick_placer_item_select', {
        canvas: 'plan',
        mode: quickPlacerMode,
        endpoint_type: item.trunkDeviceId ? 'trunk_device' : item.endpoint.type,
        symbol_id: item.endpoint.symbol,
        is_custom_placement: item.isCustomPlacement,
      })
      if (eendraadIsInLayout) {
        requestFitToView(['eendraad'])
      }
      if (quickPlacerMode === 'fast') {
        const index = quickPlacerSequence.findIndex(
          (candidate) => candidate.placement.id === item.placement.id
        )
        if (index >= 0) {
          applyQuickPlacerFastIndex(index)
        }
      }
    },
    [
      applyQuickPlacerFastIndex,
      applySelection,
      eendraadIsInLayout,
      quickPlacerMode,
      quickPlacerSequence,
      requestFitToView,
    ]
  )

  const handleQuickPlacerItemHoverStart = useCallback(
    (item: QuickPlacerItem) => {
      applyHover(
        item.trunkDeviceId
          ? { type: 'trunkDevice', ids: [item.trunkDeviceId] }
          : { type: 'endpoint', ids: [item.endpoint.id] }
      )
    },
    [applyHover]
  )

  const handleQuickPlacerItemHoverEnd = useCallback(
    function () {
      if (quickPlacerMode === 'fast' && currentQuickPlacerFastItem) {
        applyHover(
          currentQuickPlacerFastItem.trunkDeviceId
            ? { type: 'trunkDevice', ids: [currentQuickPlacerFastItem.trunkDeviceId] }
            : { type: 'endpoint', ids: [currentQuickPlacerFastItem.endpoint.id] }
        )
        return
      }
      clearHover()
    },
    [clearHover, currentQuickPlacerFastItem, quickPlacerMode, applyHover]
  )

  const handleQuickPlacerItemDragStart = useCallback(
    (item: QuickPlacerItem) => {
      applyQuickPlacerDraggedPlacementId(item.placement.id)
      quickPlacerDraggedPlacementIdRef.current = item.placement.id
    },
    [applyQuickPlacerDraggedPlacementId, quickPlacerDraggedPlacementIdRef]
  )

  const handleQuickPlacerItemDragEnd = useCallback(
    function () {
      applyQuickPlacerDraggedPlacementId(null)
      quickPlacerDraggedPlacementIdRef.current = null
    },
    [applyQuickPlacerDraggedPlacementId, quickPlacerDraggedPlacementIdRef]
  )

  const applyQuickPlacerPlacement = useCallback(
    (placementId: string, targetPos: Point): boolean => {
      if (!activeFloorId) return false

      const placement = getPlacementById(placementId)
      if (!placement) return false

      const snappedPos = snapPlacementPosition(targetPos)

      const endpoint = placement.endpointId ? getEndpointById(placement.endpointId) : null
      const patch: Partial<Placement> = {
        floorId: activeFloorId,
        pos: snappedPos,
      }

      const wallFacingSide = endpoint && getEndpointPlanWallFacingSide(endpoint)
      if (endpoint && wallFacingSide && !hasExplicitSituationPlanRotation(placement)) {
        const suggestedRotation = suggestRotationForPlacement(
          { ...placement, pos: snappedPos },
          {
            image: planImageForAnalysis,
            imagePosition: planImagePosition,
            walls: wallsForRender,
            symbolBaseSizePx: baseSymbolSizePx,
            ...(endpoint.type === 'socket'
              ? { socketCount: endpoint.socketProps?.socketCount ?? 1 }
              : {}),
          },
          wallFacingSide
        )
        if (suggestedRotation != null) {
          patch.rotationDeg = suggestedRotation
        }
      }

      updatePlacement(placementId, patch)
      return true
    },
    [
      activeFloorId,
      getPlacementById,
      getEndpointById,
      planImageForAnalysis,
      planImagePosition,
      wallsForRender,
      baseSymbolSizePx,
      updatePlacement,
      snapPlacementPosition,
    ]
  )

  const handleQuickPlacerFastSkip = useCallback(
    (clientX: number, clientY: number) => {
      if (!currentQuickPlacerFastItem) return
      trackGoogleAnalyticsEvent('quick_placer_skip', {
        canvas: 'plan',
        mode: 'fast',
        endpoint_type: currentQuickPlacerFastItem.trunkDeviceId
          ? 'trunk_device'
          : currentQuickPlacerFastItem.endpoint.type,
        symbol_id: currentQuickPlacerFastItem.endpoint.symbol,
        is_custom_placement: currentQuickPlacerFastItem.isCustomPlacement,
      })
      showQuickPlacerHint('Skipped!', clientX, clientY, 'info')
      advanceQuickPlacerFastTarget()
    },
    [currentQuickPlacerFastItem, showQuickPlacerHint, advanceQuickPlacerFastTarget]
  )

  const handleQuickPlacerFastPlace = useCallback(
    (clientX: number, clientY: number) => {
      const currentItem = currentQuickPlacerFastItem
      if (!currentItem) return
      const nextPos = clientToPlan(clientX, clientY)
      if (!nextPos) {
        showQuickPlacerHint('Situation Plan only', clientX, clientY, 'error')
        return
      }
      const applied = applyQuickPlacerPlacement(currentItem.placement.id, nextPos)
      if (!applied) return
      trackGoogleAnalyticsEvent('quick_placer_place', {
        canvas: 'plan',
        placement_method: 'quick_placer',
        mode: 'fast',
        endpoint_type: currentItem.trunkDeviceId ? 'trunk_device' : currentItem.endpoint.type,
        symbol_id: currentItem.endpoint.symbol,
        is_custom_placement: currentItem.isCustomPlacement,
      })
      applySelection({ type: 'placement', ids: [currentItem.placement.id] })
      advanceQuickPlacerFastTarget({
        placedItemLeavesSequence: quickPlacerFastAutoSkipCustom && !currentItem.isCustomPlacement,
      })
    },
    [
      quickPlacerFastAutoSkipCustom,
      currentQuickPlacerFastItem,
      clientToPlan,
      applyQuickPlacerPlacement,
      applySelection,
      advanceQuickPlacerFastTarget,
      showQuickPlacerHint,
    ]
  )

  useEffect(
    function () {
      if (!quickPlacerVisible) return
      const handleQuickPlacerKeyDown = (event: KeyboardEvent) => {
        if (!isActiveViewport()) return
        if (isKeyboardTypingTarget(event.target)) return

        if (event.key === 'Escape') {
          event.preventDefault()
          if (quickPlacerMode === 'fast') {
            applyQuickPlacerMode('slow')
          } else {
            closeQuickPlacer()
          }
          return
        }

        if (quickPlacerMode !== 'fast' || event.ctrlKey || event.metaKey || event.altKey) return

        const normalizedKey = event.key.length === 1 ? event.key.toUpperCase() : ''
        const floorIndex = QUICK_PLACER_FLOOR_KEYS.indexOf(normalizedKey)
        if (floorIndex === -1) return
        const floor = floors[floorIndex]
        if (!floor) return

        event.preventDefault()
        applyActiveFloor(floor.id)
      }

      window.addEventListener('keydown', handleQuickPlacerKeyDown)
      return () => window.removeEventListener('keydown', handleQuickPlacerKeyDown)
    },
    [
      applyActiveFloor,
      applyQuickPlacerMode,
      closeQuickPlacer,
      floors,
      quickPlacerMode,
      quickPlacerVisible,
      window,
      isActiveViewport,
    ]
  )

  useEffect(
    function () {
      if (!quickPlacerVisible || quickPlacerMode !== 'fast') return
      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target
        const insidePanel =
          target instanceof Node && !!quickPlacerPanelRef.current?.contains(target)
        const insidePlan = target instanceof Node && !!containerRef.current?.contains(target)
        if (insidePanel) return

        if (insidePlan) {
          if (event.button === 0) {
            event.preventDefault()
            event.stopPropagation()
            handleQuickPlacerFastPlace(event.clientX, event.clientY)
            return
          }
          if (event.button === 2) {
            event.preventDefault()
            event.stopPropagation()
            handleQuickPlacerFastSkip(event.clientX, event.clientY)
          }
          return
        }

        if (target instanceof Element && target.closest('[data-viewport-panel]') && !insidePlan) {
          showQuickPlacerHint('Situation Plan only', event.clientX, event.clientY, 'error')
        }

        applyQuickPlacerMode('slow')
      }

      const handlePointerMove = (event: PointerEvent) => {
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) {
          applyQuickPlacerFastPreviewClient(null)
          return
        }
        const insidePlan =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        if (insidePlan) {
          applyQuickPlacerFastPreviewClient({ x: event.clientX, y: event.clientY })
        } else {
          applyQuickPlacerFastPreviewClient(null)
        }
      }

      const handleContextMenu = (event: MouseEvent) => {
        const target = event.target
        if (target instanceof Element && target.closest('[data-floor-selection-row]')) return
        const insidePlan = target instanceof Node && !!containerRef.current?.contains(target)
        if (!insidePlan) return
        event.preventDefault()
        event.stopPropagation()
      }

      window.addEventListener('pointerdown', handlePointerDown, true)
      window.addEventListener('pointermove', handlePointerMove, true)
      window.addEventListener('contextmenu', handleContextMenu, true)
      return () => {
        window.removeEventListener('pointerdown', handlePointerDown, true)
        window.removeEventListener('pointermove', handlePointerMove, true)
        window.removeEventListener('contextmenu', handleContextMenu, true)
      }
    },
    [
      quickPlacerVisible,
      quickPlacerMode,
      showQuickPlacerHint,
      handleQuickPlacerFastPlace,
      handleQuickPlacerFastSkip,
      applyQuickPlacerFastPreviewClient,
      applyQuickPlacerMode,
      window,
      quickPlacerPanelRef,
      containerRef,
    ]
  )

  useEffect(
    function () {
      const handleWindowDrop = (event: DragEvent) => {
        if (!quickPlacerDraggedPlacementIdRef.current) return
        const target = event.target
        if (target instanceof Node && containerRef.current?.contains(target)) return
        showQuickPlacerHint('Situation Plan only', event.clientX, event.clientY, 'error')
        applyQuickPlacerDraggedPlacementId(null)
        quickPlacerDraggedPlacementIdRef.current = null
      }

      window.addEventListener('drop', handleWindowDrop)
      return () => window.removeEventListener('drop', handleWindowDrop)
    },
    [
      applyQuickPlacerDraggedPlacementId,
      showQuickPlacerHint,
      window,
      containerRef,
      quickPlacerDraggedPlacementIdRef,
    ]
  )

  const toggleQuickPlacerByShortcut = useCallback(
    function () {
      if (quickPlacerOpen || quickPlacerDocked) {
        closeQuickPlacer()
      } else {
        openFloatingQuickPlacer()
      }
    },
    [quickPlacerOpen, quickPlacerDocked, closeQuickPlacer, openFloatingQuickPlacer]
  )

  return {
    closeQuickPlacer,
    quickPlacerVisible,
    handleQuickPlacerModeChange,
    handleQuickPlacerSelectedCircuitChange,
    openQuickPlacerAtFirstAwaiting,
    handleQuickPlacerSelectedPanelChange,
    handleQuickPlacerItemActivate,
    handleQuickPlacerItemHoverStart,
    handleQuickPlacerItemHoverEnd,
    handleQuickPlacerItemDragStart,
    handleQuickPlacerItemDragEnd,
    applyQuickPlacerPlacement,
    handleQuickPlacerFastSkip,
    handleQuickPlacerFastPlace,
    toggleQuickPlacerByShortcut,
  }
}
