import { Group, RegularPolygon } from 'react-konva'
import type { Point2 } from '@/types/schema'
import { screenPxToCanvasUnits, DRAW_TOOL_HANDLE_RADIUS_PX, DRAW_TOOL_HANDLE_RADIUS_PX_MIN,
  DRAW_TOOL_HANDLE_RADIUS_PX_MAX, DRAW_TOOL_HANDLE_OFFSET_PX, DRAW_TOOL_HANDLE_OFFSET_PX_MIN,
  DRAW_TOOL_HANDLE_OFFSET_PX_MAX, DRAW_TOOL_STROKE_PX, DRAW_TOOL_STROKE_PX_MIN,
  DRAW_TOOL_STROKE_PX_MAX } from '@/constants/canvasConstants'

interface Props {
  bounds: { x: number; y: number; width: number; height: number }
  pan: Point2
  zoom: number
  onBegin: (anchor: Point2, mode: 'horizontal' | 'vertical') => void
  onUpdate: (point: Point2) => void
  onEnd: (point: Point2 | null) => void
}

/** Native directional drag handles share one committed camera and event sequence. */
export function PlanDirectionalMoveHandles({ bounds, pan, zoom, onBegin, onUpdate, onEnd }: Props) {
  const { x, y, width, height } = bounds
  const cx = x + width / 2
  const cy = y + height / 2
  const handleRadius = screenPxToCanvasUnits(
    zoom,
    DRAW_TOOL_HANDLE_RADIUS_PX,
    DRAW_TOOL_HANDLE_RADIUS_PX_MIN,
    DRAW_TOOL_HANDLE_RADIUS_PX_MAX
  )
  const offset = screenPxToCanvasUnits(
    zoom,
    DRAW_TOOL_HANDLE_OFFSET_PX,
    DRAW_TOOL_HANDLE_OFFSET_PX_MIN,
    DRAW_TOOL_HANDLE_OFFSET_PX_MAX
  )
  const handleStrokeWidth = screenPxToCanvasUnits(
    zoom,
    DRAW_TOOL_STROKE_PX,
    DRAW_TOOL_STROKE_PX_MIN,
    DRAW_TOOL_STROKE_PX_MAX
  )

  const createHandle = (anchor: Point2, rotation: number, mode: 'horizontal' | 'vertical') => (
    <RegularPolygon
      x={anchor.x}
      y={anchor.y}
      sides={3}
      radius={handleRadius}
      rotation={rotation}
      fill={'#ffffff'}
      stroke={'#0284c7'}
      strokeWidth={handleStrokeWidth}
      draggable
      onDragStart={(e) => {
        onBegin(anchor, mode)
        e.target.x(anchor.x)
        e.target.y(anchor.y)
      }}
      onDragMove={(e) => {
        const stage = e.target.getStage()
        const pointer = stage?.getPointerPosition()
        const point =
          stage && pointer
            ? {
                x: (pointer.x - pan.x) / zoom,
                y: (pointer.y - pan.y) / zoom,
              }
            : null
        if (!point) return
        onUpdate(point)
        e.target.x(anchor.x)
        e.target.y(anchor.y)
      }}
      onDragEnd={(e) => {
        const stage = e.target.getStage()
        const pointer = stage?.getPointerPosition()
        const point =
          stage && pointer
            ? {
                x: (pointer.x - pan.x) / zoom,
                y: (pointer.y - pan.y) / zoom,
              }
            : null
        onEnd(point)
        e.target.x(anchor.x)
        e.target.y(anchor.y)
      }}
    />
  )

  return (
    <Group listening>
      {createHandle({ x: cx, y: y - offset }, 0, 'vertical')}
      {createHandle({ x: cx, y: y + height + offset }, 180, 'vertical')}
      {createHandle({ x: x - offset, y: cy }, 270, 'horizontal')}
      {createHandle({ x: x + width + offset, y: cy }, 90, 'horizontal')}
    </Group>
  )
}
