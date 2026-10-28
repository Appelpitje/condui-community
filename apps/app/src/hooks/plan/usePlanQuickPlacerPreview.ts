import type { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'
import { useMemo } from 'react'

import type { Placement } from '@/types/schema'
import { calculateLabelPositions } from '@/utils/plan/labelPositioning'

import { buildQuickPlacerCircuits, flattenQuickPlacerCircuit } from '@/lib/plan/quickPlacer'

interface PlanQuickPlacerPreviewOptions {
  electricalReadProject: import('@/types/projectV2').ProjectV2 | null
  getCircuitIdentifier: (circuitId: string) => string
  quickPlacerSelectedCircuitId: string | null
  quickPlacerFastAutoSkipCustom: boolean
  quickPlacerMode: import('@/hooks/plan/usePlanQuickPlacerState').QuickPlacerMode
  quickPlacerFastIndex: number
  quickPlacerFastPreviewClient: import('@/types/ui').Point | null
  clientToPlan: (clientX: number, clientY: number) => import('@/types/ui').Point | null
  snapPlacementPosition: ReturnType<typeof usePlanCanvasGeometry>['snapPlacementPosition']
  activeFloorId: string | null
  getEndpointById: (id: string) => import('@/types/schema').Endpoint | undefined
  baseSymbolSizePx: ReturnType<typeof usePlanCanvasGeometry>['baseSymbolSizePx']
  fontFamily: string
}

export function usePlanQuickPlacerPreview({
  electricalReadProject,
  getCircuitIdentifier,
  quickPlacerSelectedCircuitId,
  quickPlacerFastAutoSkipCustom,
  quickPlacerMode,
  quickPlacerFastIndex,
  quickPlacerFastPreviewClient,
  clientToPlan,
  snapPlacementPosition,
  activeFloorId,
  getEndpointById,
  baseSymbolSizePx,
  fontFamily,
}: PlanQuickPlacerPreviewOptions) {
  const quickPlacerCircuits = useMemo(
    () => buildQuickPlacerCircuits(electricalReadProject, getCircuitIdentifier),
    [electricalReadProject, getCircuitIdentifier]
  )
  const selectedQuickPlacerCircuit =
    quickPlacerCircuits.find((circuit) => circuit.id === quickPlacerSelectedCircuitId) ??
    quickPlacerCircuits[0] ??
    null
  const quickPlacerSequence = useMemo(
    () =>
      flattenQuickPlacerCircuit(selectedQuickPlacerCircuit, {
        autoSkipCustom: quickPlacerFastAutoSkipCustom,
      }),
    [selectedQuickPlacerCircuit, quickPlacerFastAutoSkipCustom]
  )
  const currentQuickPlacerFastItem =
    quickPlacerMode === 'fast' && quickPlacerSequence.length > 0
      ? (quickPlacerSequence[Math.min(quickPlacerFastIndex, quickPlacerSequence.length - 1)] ??
        null)
      : null
  const quickPlacerFastPreviewPos = useMemo(
    function () {
      if (quickPlacerMode !== 'fast' || !quickPlacerFastPreviewClient) return null
      const raw = clientToPlan(quickPlacerFastPreviewClient.x, quickPlacerFastPreviewClient.y)
      return raw ? snapPlacementPosition(raw) : null
    },
    [quickPlacerMode, quickPlacerFastPreviewClient, clientToPlan, snapPlacementPosition]
  )
  const quickPlacerFastPreviewPlacement = useMemo(
    function () {
      if (!currentQuickPlacerFastItem || !quickPlacerFastPreviewPos) return null
      return {
        ...currentQuickPlacerFastItem.placement,
        id: `quick-placer-preview-${currentQuickPlacerFastItem.placement.id}`,
        ...(currentQuickPlacerFastItem.trunkDeviceId
          ? { trunkDeviceId: currentQuickPlacerFastItem.trunkDeviceId }
          : { endpointId: currentQuickPlacerFastItem.endpoint.id }),
        floorId: activeFloorId ?? currentQuickPlacerFastItem.placement.floorId,
        pos: quickPlacerFastPreviewPos,
      }
    },
    [activeFloorId, currentQuickPlacerFastItem, quickPlacerFastPreviewPos]
  )
  const quickPlacerFastEndpoint = currentQuickPlacerFastItem?.endpoint
  const quickPlacerFastPreviewLabelPosition = useMemo(
    function () {
      if (!quickPlacerFastPreviewPlacement || !quickPlacerFastEndpoint?.label) return undefined
      return calculateLabelPositions(
        [
          quickPlacerFastPreviewPlacement as Placement & {
            endpointId?: string
            junctionPanelLabel?: string
          },
        ],
        (id) => (id === quickPlacerFastEndpoint.id ? quickPlacerFastEndpoint : getEndpointById(id)),
        null,
        baseSymbolSizePx,
        fontFamily
      ).get(quickPlacerFastPreviewPlacement.id)
    },
    [
      quickPlacerFastPreviewPlacement,
      quickPlacerFastEndpoint,
      getEndpointById,
      baseSymbolSizePx,
      fontFamily,
    ]
  )

  return {
    quickPlacerCircuits,
    selectedQuickPlacerCircuit,
    quickPlacerSequence,
    currentQuickPlacerFastItem,
    quickPlacerFastPreviewPlacement,
    quickPlacerFastPreviewLabelPosition,
  }
}
