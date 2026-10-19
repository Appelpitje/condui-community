import { memo } from 'react'
import { Group, Line, Rect, Text } from 'react-konva'
import type { Point2 } from '@/types/schema'
import {
  DRAW_TOOL_DASH_PX,
  DRAW_TOOL_PROJECTION_GUIDE_COLOR,
  DRAW_TOOL_PROJECTION_GUIDE_STROKE_PX,
  DRAW_TOOL_PROJECTION_GUIDE_STROKE_PX_MAX,
  DRAW_TOOL_PROJECTION_GUIDE_STROKE_PX_MIN,
  screenPxToCanvasUnits,
} from '@/constants/canvasConstants'

export type PlanProjectionGuide = { from: Point2; to: Point2; hideDistanceLabel?: boolean }

/** Render in the owning interaction layer so preview changes do not repaint the plan. */
export const PlanProjectionGuides = memo(function PlanProjectionGuides({
  guides, zoom, pxPerMeter, fontFamily, themeMode,
}: {
  guides: PlanProjectionGuide[]
  zoom: number
  pxPerMeter: number
  fontFamily: string
  themeMode: string
}) {
  const stroke = screenPxToCanvasUnits(
    zoom, DRAW_TOOL_PROJECTION_GUIDE_STROKE_PX,
    DRAW_TOOL_PROJECTION_GUIDE_STROKE_PX_MIN, DRAW_TOOL_PROJECTION_GUIDE_STROKE_PX_MAX
  )
  const dash = screenPxToCanvasUnits(zoom, DRAW_TOOL_DASH_PX, 2, 10)
  const fontSize = 13 / zoom
  const paddingX = 8 / zoom
  const paddingY = 4 / zoom
  const offsetY = 10 / zoom

  return <>{guides.map((guide, index) => {
    const dx = guide.to.x - guide.from.x
    const dy = guide.to.y - guide.from.y
    const lengthPx = Math.sqrt(dx * dx + dy * dy)
    const lengthCentimeters = (lengthPx / pxPerMeter) * 100
    const label = `${lengthCentimeters.toFixed(1)} cm`
    const midX = (guide.from.x + guide.to.x) / 2
    const midY = (guide.from.y + guide.to.y) / 2
    const approxCharWidth = fontSize * 0.6
    const textWidth = Math.max(24 / zoom, label.length * approxCharWidth)
    const boxWidth = textWidth + paddingX * 2
    const boxHeight = fontSize + paddingY * 2
    const boxX = midX - boxWidth / 2
    const boxY = midY - boxHeight / 2 - offsetY

    return (
      <Group key={`top-projected-snap-guide-${index}`} listening={false}>
        <Line
          points={[guide.from.x, guide.from.y, guide.to.x, guide.to.y]}
          stroke={DRAW_TOOL_PROJECTION_GUIDE_COLOR}
          strokeWidth={stroke}
          dash={[dash, dash]}
          lineCap="round"
          lineJoin="round"
        />
        {!guide.hideDistanceLabel && <>
          <Rect
            x={boxX} y={boxY} width={boxWidth} height={boxHeight}
            fill={themeMode === 'dark' ? 'rgba(17,24,39,0.9)' : 'rgba(243,244,246,0.95)'}
            stroke={DRAW_TOOL_PROJECTION_GUIDE_COLOR}
            strokeWidth={stroke}
            cornerRadius={screenPxToCanvasUnits(zoom, 4, 2, 8)}
          />
          <Text
            x={boxX} y={boxY} width={boxWidth} height={boxHeight}
            align="center" verticalAlign="middle" text={label}
            fontSize={fontSize} fontFamily={fontFamily}
            fill={DRAW_TOOL_PROJECTION_GUIDE_COLOR}
          />
        </>}
      </Group>
    )
  })}</>
})
