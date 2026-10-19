import { Group, Line, Rect } from 'react-konva'
import type { LiveProtectionBusPreviewGeometry } from '@/lib/layout/liveProtectionBusPreview'
import {
  DRAG_PREVIEW_BUS_WIDTH,
  DRAG_PREVIEW_DASH,
  DRAG_PREVIEW_HIGHLIGHT_WIDTH,
  DRAG_PREVIEW_WIRE_WIDTH,
} from './canvasSymbols'

/** Matches the detailed bus preview without simulating a second copy of the project. */
export function LiveProtectionBusPreview({
  geometry,
}: {
  geometry: LiveProtectionBusPreviewGeometry
}) {
  const { x, busY, hit, segments, extensionX } = geometry
  const color = '#0284c7'
  const symbolY = busY - 40
  return (
    <Group name="eendraad-live-protection-bus-preview" opacity={0.85} listening={false}>
      {segments.map((segment) => (
        <Line
          key={segment.id}
          name="eendraad-preview-secondary-bus"
          points={[
            segment.startPoint.x,
            segment.startPoint.y,
            segment.endPoint.x,
            segment.endPoint.y,
          ]}
          stroke={color}
          strokeWidth={DRAG_PREVIEW_BUS_WIDTH}
          opacity={0.6}
          listening={false}
        />
      ))}
      {extensionX != null && (
        <Line
          name="eendraad-preview-secondary-bus"
          points={[extensionX, busY, x, busY]}
          stroke={color}
          strokeWidth={DRAG_PREVIEW_BUS_WIDTH}
          opacity={0.6}
          listening={false}
        />
      )}
      <Line
        points={[hit.startPoint.x, hit.startPoint.y, hit.endPoint.x, hit.endPoint.y]}
        stroke={color}
        strokeWidth={DRAG_PREVIEW_HIGHLIGHT_WIDTH}
        opacity={0.6}
        lineCap="round"
        listening={false}
      />
      <Line
        points={[x, busY, x, symbolY + 20]}
        stroke={color}
        strokeWidth={DRAG_PREVIEW_WIRE_WIDTH}
        dash={DRAG_PREVIEW_DASH}
        lineCap="round"
        listening={false}
      />
      <Line
        points={[x, symbolY, x, symbolY - 70]}
        stroke={color}
        strokeWidth={DRAG_PREVIEW_WIRE_WIDTH}
        dash={DRAG_PREVIEW_DASH}
        lineCap="round"
        listening={false}
      />
      <Rect
        name="eendraad-preview-created-protection"
        x={x - 10}
        y={symbolY}
        width={20}
        height={20}
        stroke={color}
        strokeWidth={2}
        dash={DRAG_PREVIEW_DASH}
        cornerRadius={4}
        fill="rgba(59,130,246,0.12)"
        listening={false}
      />
    </Group>
  )
}
