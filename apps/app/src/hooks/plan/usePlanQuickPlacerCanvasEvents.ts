import React, { useCallback, useEffect } from 'react'

import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'

interface PlanQuickPlacerCanvasEventsOptions {
  quickPlacerVisible: boolean
  quickPlacerMode: import('@/hooks/plan/usePlanQuickPlacerState').QuickPlacerMode
  quickPlacerDraggedPlacementId: string | null
  quickPlacerDraggedPlacementIdRef: React.RefObject<string | null>
  clientToPlan: (clientX: number, clientY: number) => import('@/types/ui').Point | null
  applyQuickPlacerPlacement: (placementId: string, targetPos: import('@/types/ui').Point) => boolean
  getPlacementById: (id: string) =>
    | (import('@/types/schema').Placement & {
        endpointId?: string | undefined
        trunkDeviceId?: string | undefined
        enclosureId?: string | undefined
        isEarthing?: boolean | undefined
      })
    | undefined
  getEndpointById: (id: string) => import('@/types/schema').Endpoint | undefined
  applySelection: (selection: import('@/types/ui').Selection) => void
  showQuickPlacerHint: (
    message: string,
    clientX: number,
    clientY: number,
    tone?: 'error' | 'info'
  ) => void
  applyQuickPlacerDraggedPlacementId: React.Dispatch<React.SetStateAction<string | null>>
  containerRef: React.RefObject<HTMLDivElement | null>
  window: globalThis.Window
  handleQuickPlacerFastPlace: (clientX: number, clientY: number) => void
  applyQuickPlacerFastPreviewClient: React.Dispatch<
    React.SetStateAction<import('@/types/ui').Point | null>
  >
  handleQuickPlacerFastSkip: (clientX: number, clientY: number) => void
}

export function usePlanQuickPlacerCanvasEvents({
  quickPlacerVisible,
  quickPlacerMode,
  quickPlacerDraggedPlacementId,
  quickPlacerDraggedPlacementIdRef,
  clientToPlan,
  applyQuickPlacerPlacement,
  getPlacementById,
  getEndpointById,
  applySelection,
  showQuickPlacerHint,
  applyQuickPlacerDraggedPlacementId,
  containerRef,
  window,
  handleQuickPlacerFastPlace,
  applyQuickPlacerFastPreviewClient,
  handleQuickPlacerFastSkip,
}: PlanQuickPlacerCanvasEventsOptions) {
  const handleQuickPlacerDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!quickPlacerVisible || quickPlacerMode !== 'slow' || !quickPlacerDraggedPlacementId)
        return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
    },
    [quickPlacerVisible, quickPlacerMode, quickPlacerDraggedPlacementId]
  )

  const handleQuickPlacerDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const placementId =
        event.dataTransfer.getData('application/x-eendra-quick-placer') ||
        event.dataTransfer.getData('text/plain') ||
        quickPlacerDraggedPlacementIdRef.current
      if (!quickPlacerVisible || quickPlacerMode !== 'slow' || !placementId) return

      event.preventDefault()
      event.stopPropagation()
      const nextPos = clientToPlan(event.clientX, event.clientY)
      const didApply = nextPos ? applyQuickPlacerPlacement(placementId, nextPos) : false
      if (didApply) {
        const placement = getPlacementById(placementId)
        const endpoint = placement?.endpointId ? getEndpointById(placement.endpointId) : null
        trackGoogleAnalyticsEvent('quick_placer_place', {
          canvas: 'plan',
          placement_method: 'quick_placer',
          mode: 'slow',
          endpoint_type: endpoint?.type,
          symbol_id: endpoint?.symbol,
        })
        applySelection({ type: 'placement', ids: [placementId] })
      } else {
        showQuickPlacerHint('Situation Plan only', event.clientX, event.clientY, 'error')
      }
      applyQuickPlacerDraggedPlacementId(null)
      quickPlacerDraggedPlacementIdRef.current = null
    },
    [
      quickPlacerVisible,
      quickPlacerMode,
      clientToPlan,
      applyQuickPlacerPlacement,
      getEndpointById,
      getPlacementById,
      applySelection,
      showQuickPlacerHint,
      applyQuickPlacerDraggedPlacementId,
      quickPlacerDraggedPlacementIdRef,
    ]
  )

  useEffect(
    function () {
      if (!quickPlacerVisible || quickPlacerMode !== 'slow') return

      const clearQuickPlacerTouchDrag = () => {
        applyQuickPlacerDraggedPlacementId(null)
        quickPlacerDraggedPlacementIdRef.current = null
      }

      const handleTouchDragEnd = (event: Event) => {
        const customEvent = event as CustomEvent<{
          placementId: string
          x: number
          y: number
        }>
        const { placementId, x, y } = customEvent.detail
        if (!placementId) return

        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) {
          clearQuickPlacerTouchDrag()
          return
        }

        const insidePlan = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
        if (!insidePlan) {
          showQuickPlacerHint('Situation Plan only', x, y, 'error')
          clearQuickPlacerTouchDrag()
          return
        }

        const nextPos = clientToPlan(x, y)
        const didApply = nextPos ? applyQuickPlacerPlacement(placementId, nextPos) : false
        if (didApply) {
          const placement = getPlacementById(placementId)
          const endpoint = placement?.endpointId ? getEndpointById(placement.endpointId) : null
          trackGoogleAnalyticsEvent('quick_placer_place', {
            canvas: 'plan',
            placement_method: 'quick_placer',
            mode: 'slow',
            endpoint_type: endpoint?.type,
            symbol_id: endpoint?.symbol,
            input_type: 'touch',
          })
          applySelection({ type: 'placement', ids: [placementId] })
        } else {
          showQuickPlacerHint('Situation Plan only', x, y, 'error')
        }
        clearQuickPlacerTouchDrag()
      }

      window.addEventListener('quickplacertouchdragend', handleTouchDragEnd)
      return () => window.removeEventListener('quickplacertouchdragend', handleTouchDragEnd)
    },
    [
      quickPlacerVisible,
      quickPlacerMode,
      clientToPlan,
      applyQuickPlacerPlacement,
      getEndpointById,
      getPlacementById,
      applySelection,
      showQuickPlacerHint,
      applyQuickPlacerDraggedPlacementId,
      window,
      quickPlacerDraggedPlacementIdRef,
      containerRef,
    ]
  )

  const handleQuickPlacerFastOverlayPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      handleQuickPlacerFastPlace(event.clientX, event.clientY)
    },
    [handleQuickPlacerFastPlace]
  )

  const handleQuickPlacerFastOverlayPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      applyQuickPlacerFastPreviewClient({ x: event.clientX, y: event.clientY })
    },
    [applyQuickPlacerFastPreviewClient]
  )

  const handleQuickPlacerFastOverlayPointerLeave = useCallback(
    function () {
      applyQuickPlacerFastPreviewClient(null)
    },
    [applyQuickPlacerFastPreviewClient]
  )

  const handleQuickPlacerFastOverlayContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      handleQuickPlacerFastSkip(event.clientX, event.clientY)
    },
    [handleQuickPlacerFastSkip]
  )

  return {
    handleQuickPlacerDragOver,
    handleQuickPlacerDrop,
    handleQuickPlacerFastOverlayPointerDown,
    handleQuickPlacerFastOverlayPointerMove,
    handleQuickPlacerFastOverlayPointerLeave,
    handleQuickPlacerFastOverlayContextMenu,
  }
}
