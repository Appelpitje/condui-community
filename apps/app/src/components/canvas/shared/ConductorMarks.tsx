import { memo } from 'react'
import { Circle, Group, Line, Text } from 'react-konva'
import type { ConductorMarkShapes } from '@/lib/wires/conductorMarks'

const COUNT_BOX_SLACK = 6

/** IEC 60617 conductor tick marks, drawn in the wire-local frame of {@link ConductorMarkShapes}. */
export const ConductorMarks = memo(function ConductorMarks({
  shapes,
  x,
  y,
  rotation = 0,
  color,
  fontFamily,
  strokeWidth = 1.1,
  opacity,
}: {
  shapes: ConductorMarkShapes
  x: number
  y: number
  /** Wire direction in degrees; counts sit on local −y, the N dot and PE bar on local +y. */
  rotation?: number
  color: string
  fontFamily?: string
  strokeWidth?: number
  opacity?: number
}) {
  // Screen direction of the local count side (−y) after rotation.
  const radians = (rotation * Math.PI) / 180
  const outwardX = Math.sin(radians)
  const outwardY = -Math.cos(radians)
  return (
    <Group
      name="conductor-marks"
      x={x}
      y={y}
      rotation={rotation}
      opacity={opacity}
      listening={false}
    >
      {shapes.lines.map((points, index) => (
        <Line
          key={`line-${index}`}
          points={points}
          stroke={color}
          strokeWidth={strokeWidth}
          lineCap="round"
          listening={false}
        />
      ))}
      {shapes.dots.map((dot, index) => (
        <Circle key={`dot-${index}`} x={dot.x} y={dot.y} radius={dot.radius} fill={color} listening={false} />
      ))}
      {shapes.texts.map((text, index) => (
        // Counter-rotate so the count reads upright, and grow its box away from the wire.
        // The box is wider than the estimate so no font wraps the digits away.
        <Group key={`text-${index}`} x={text.x} y={text.y} rotation={-rotation}>
          <Text
            text={text.text}
            width={text.width + COUNT_BOX_SLACK}
            wrap="none"
            align="center"
            offsetX={(text.width + COUNT_BOX_SLACK) / 2 - (outwardX * text.width) / 2}
            offsetY={(text.fontSize * (1 - outwardY)) / 2}
            fontSize={text.fontSize}
            fontFamily={fontFamily}
            fill={color}
            listening={false}
          />
        </Group>
      ))}
    </Group>
  )
})
