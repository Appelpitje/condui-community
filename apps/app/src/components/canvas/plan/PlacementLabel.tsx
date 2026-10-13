import { Text } from 'react-konva'
import { useThemeColors } from '@/lib/theme/hooks'
import { useCanvasFontFamily } from '@/editions/community/communityHooks'
import { getLabelBoxSize } from '@/lib/plan/planLabelMetrics'

interface PlacementLabelProps {
  endpoint: { label?: string }
  labelPosition?: { x: number; y: number }
  labelFontSize: number
}

/**
 * Symbol label on the situation plan (horizontal, outside the rotated symbol group).
 */
export function PlacementLabel({
  endpoint,
  labelPosition,
  labelFontSize,
}: PlacementLabelProps) {
  const colors = useThemeColors()
  const fontFamily = useCanvasFontFamily()
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
      fill={colors.textColor}
      align="left"
      listening={false}
    />
  )
}
