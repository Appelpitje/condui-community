import { Text } from 'react-konva'
import { useThemeColors } from '@/lib/theme/hooks'
import { useCanvasFontFamily } from '@/editions/community/communityHooks'
import { getLabelBoxSize } from '@/lib/plan/planLabelMetrics'
import { useProjectStore } from '@/stores/projectStore'
import { selectProjectPlanWiringVisibility } from '@/lib/projectV2/planWiring'
import { planSymbolColor } from '@/lib/plan/planColors'
import type { SymbolKey } from '@/types/schema'

interface PlacementLabelProps {
  endpoint: { label?: string; symbol?: SymbolKey }
  labelPosition?: { x: number; y: number }
  labelFontSize: number
}

/**
 * Symbol label on the situation plan (horizontal, outside the rotated symbol group).
 */
export function PlacementLabel({ endpoint, labelPosition, labelFontSize }: PlacementLabelProps) {
  const colors = useThemeColors()
  const fontFamily = useCanvasFontFamily()
  const colorOverride = useProjectStore((state) =>
    planSymbolColor(
      endpoint.symbol,
      state.currentProject ? selectProjectPlanWiringVisibility(state.currentProject) : undefined
    )
  )
  if (!endpoint.label || !labelPosition) return null

  const { width, height } = getLabelBoxSize(endpoint.label, labelFontSize, fontFamily)

  return (
    <Text
      x={labelPosition.x}
      y={labelPosition.y}
      offsetX={width / 2}
      offsetY={height / 2}
      text={endpoint.label}
      fontSize={labelFontSize}
      fontFamily={fontFamily}
      fill={colorOverride ?? colors.textColor}
      align="left"
      listening={false}
    />
  )
}
