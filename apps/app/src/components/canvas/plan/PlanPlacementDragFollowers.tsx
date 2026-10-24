import { Text } from 'react-konva'
import { usePlanDragLabel, usePlanDragPosition } from '@/stores/planDragVisualStore'
import { useThemeColors } from '@/lib/theme/hooks'
import { useProjectStore } from '@/stores/projectStore'
import { selectProjectPlanWiringVisibility } from '@/lib/projectV2/planWiring'
import { planSymbolColor } from '@/lib/plan/planColors'
import {
  LIGHT_POINT_WATERPROOF_H_OFFSET_TOP,
  MULTI_SOCKET_OFFSET,
  SOCKET_WATERPROOF_H_FONT_SIZE,
  SOCKET_WATERPROOF_H_OFFSET_RIGHT,
  SOCKET_WATERPROOF_H_OFFSET_TOP,
  SYMBOL_SIZE,
} from '../eendraad/canvasSymbols'
import { PlacementLabel } from './PlacementLabel'
import type { Placement } from '@/types/schema'
import type { Endpoint, SymbolKey } from '@/types/schema'

export function PlanPlacementLabelEntry({
  placementId,
  labelText,
  staticLabelPosition,
  labelFontSize,
  symbol,
}: {
  placementId: string
  labelText?: string
  staticLabelPosition?: { x: number; y: number }
  labelFontSize: number
  symbol?: SymbolKey
}) {
  const dragLabel = usePlanDragLabel(placementId)
  const labelPosition = dragLabel ?? staticLabelPosition
  if (!labelText || !labelPosition) return null
  return (
    <PlacementLabel
      endpoint={{ label: labelText, symbol }}
      labelPosition={labelPosition}
      labelFontSize={labelFontSize}
    />
  )
}

export function PlanPlacementSocketWaterproofH({
  placement,
  endpoint,
  baseSymbolSizePx,
  fontFamily,
}: {
  placement: Placement
  endpoint: Endpoint
  baseSymbolSizePx: number
  fontFamily: string
}) {
  const colors = useThemeColors()
  const colorOverride = useProjectStore((state) =>
    planSymbolColor(
      endpoint.symbol,
      state.currentProject ? selectProjectPlanWiringVisibility(state.currentProject) : undefined
    )
  )
  const dragPos = usePlanDragPosition(placement.id)
  const placementPos = dragPos ?? placement.pos
  if (!endpoint.socketProps?.waterproof || !placementPos) return null

  const symSize = baseSymbolSizePx * placement.scale
  const scale = symSize / SYMBOL_SIZE
  const epSocketExtra =
    Math.max(0, (endpoint.socketProps?.socketCount || 1) - 1) * MULTI_SOCKET_OFFSET * scale
  const hX =
    placementPos.x + (SYMBOL_SIZE / 2 - SOCKET_WATERPROOF_H_OFFSET_RIGHT) * scale + epSocketExtra
  const hY = placementPos.y + (-SYMBOL_SIZE / 4 + SOCKET_WATERPROOF_H_OFFSET_TOP) * scale

  return (
    <Text
      x={hX}
      y={hY}
      text="h"
      fontSize={Math.max(
        SOCKET_WATERPROOF_H_FONT_SIZE,
        Math.round(SOCKET_WATERPROOF_H_FONT_SIZE * scale)
      )}
      fontFamily={fontFamily}
      fill={colorOverride ?? colors.symbolColor}
      align="right"
      listening={false}
    />
  )
}

export function PlanPlacementLightWaterproofH({
  placement,
  endpoint,
  baseSymbolSizePx,
  fontFamily,
}: {
  placement: Placement
  endpoint: Endpoint
  baseSymbolSizePx: number
  fontFamily: string
}) {
  const colors = useThemeColors()
  const colorOverride = useProjectStore((state) =>
    planSymbolColor(
      endpoint.symbol,
      state.currentProject ? selectProjectPlanWiringVisibility(state.currentProject) : undefined
    )
  )
  const dragPos = usePlanDragPosition(placement.id)
  const placementPos = dragPos ?? placement.pos
  if (
    endpoint.type !== 'light_point' ||
    endpoint.symbol !== 'light_point' ||
    !endpoint.lightPointProps?.waterproof ||
    !placementPos
  ) {
    return null
  }

  const symSize = baseSymbolSizePx * placement.scale
  const scale = symSize / SYMBOL_SIZE
  const hY = placementPos.y + (-SYMBOL_SIZE / 4 + LIGHT_POINT_WATERPROOF_H_OFFSET_TOP) * scale

  return (
    <Text
      x={placementPos.x}
      y={hY}
      text="h"
      fontSize={Math.max(
        SOCKET_WATERPROOF_H_FONT_SIZE,
        Math.round(SOCKET_WATERPROOF_H_FONT_SIZE * scale)
      )}
      fontFamily={fontFamily}
      fill={colorOverride ?? colors.symbolColor}
      align="center"
      listening={false}
    />
  )
}
