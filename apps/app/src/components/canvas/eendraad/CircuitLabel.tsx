import { LabelPreviewText } from './LabelPreviewText'
import type { LabelPreviewSection } from './labelPreviewContext'
import { Circle } from 'react-konva'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { useCanvasFontFamily } from '@/editions/community/communityHooks'
import { getTextColor } from './canvasSymbols'
import {
  PROTECTION_LABEL_DEFAULT_BOX_WIDTH,
  estimateProtectionNameLabelWidth,
} from '@/lib/layout/bottomUpLayout'

interface CircuitLabelProps {
  x: number
  y: number
  label: string
  /**
   * Alignment semantics:
   * - 'left': x is left edge of box
   * - 'center': x is box center
   * - 'right': x is right edge of box
   */
  align?: 'left' | 'center' | 'right'
  previewSection?: LabelPreviewSection
  custom?: boolean
  protectionId?: string
  unwrappedWidth?: number
}

export function CircuitLabel({
  x,
  y,
  label,
  align = 'center',
  custom = false,
  previewSection,
  protectionId,
  unwrappedWidth,
}: CircuitLabelProps) {
  const theme = useSettingsStore((state) => state.theme)
  const showCustomMarker = useUIStore(
    (state) =>
      custom &&
      !!protectionId &&
      state.selection.type === 'protection' &&
      state.selection.ids.includes(protectionId)
  )
  const fontFamily = useCanvasFontFamily()
  const isDark = theme.mode === 'dark'
  const textColor = getTextColor(isDark)

  const isLeft = align === 'left'
  const isRight = align === 'right'

  const measuredWidth = estimateProtectionNameLabelWidth(label)
  const boxWidth = unwrappedWidth ?? Math.max(
    isLeft || isRight ? PROTECTION_LABEL_DEFAULT_BOX_WIDTH : 24,
    measuredWidth
  )
  const boxX = isLeft ? x : isRight ? x - boxWidth : x - boxWidth / 2
  return (
    <>
      <LabelPreviewText
        section={previewSection}
        x={boxX}
        y={y - 7}
        width={boxWidth}
        text={label}
        fontSize={11}
        fontFamily={fontFamily}
        fill={textColor}
        align={isLeft ? 'left' : isRight ? 'right' : 'center'}
        listening={false}
        {...(unwrappedWidth != null ? { wrap: 'none' } : {})}
      />
      {showCustomMarker ? (
        <Circle
          x={boxX + boxWidth + 2.5}
          y={y - 7}
          radius={2.25}
          fill="#f59e0b"
          listening={false}
        />
      ) : null}
    </>
  )
}
