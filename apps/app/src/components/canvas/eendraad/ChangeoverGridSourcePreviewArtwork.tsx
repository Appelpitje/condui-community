import { memo } from 'react'
import { Circle, Group, Line, Rect } from 'react-konva'
import type { ChangeoverGridSourcePreviewScene } from '@/lib/layout/changeoverGridSourcePreviewScene'
import { getThemeColors } from '@/lib/theme/colors'
import { SUPPLY_JUNCTION_DOT_RADIUS } from '@/components/canvas/wireJunctions'
import { useThemeContext } from '@/lib/theme/ThemeContext'
import { useSettingsStore } from '@/stores/settingsStore'
import type { WireSegment } from '@/types/schema'

/** Same attention styling as the simulated drag preview. */
const PREVIEW_STROKE = '#0284c7'
const PREVIEW_STROKE_DARK = '#38bdf8'
const PREVIEW_DASH = [8, 4]
const REMOVED_DASH = [3, 5]

const isThick = (wire: WireSegment) => wire.type === 'trunk' || wire.type === 'mainBus'

const points = (wire: WireSegment) => [
  wire.startPoint.x,
  wire.startPoint.y,
  wire.endPoint.x,
  wire.endPoint.y,
]

/**
 * Hover preview of the alternative changeover port-1 feed (see
 * `buildChangeoverGridSourcePreviewScene`). Never listens to events.
 */
export const ChangeoverGridSourcePreviewArtwork = memo(function ChangeoverGridSourcePreviewArtwork({
  scene,
}: {
  scene: ChangeoverGridSourcePreviewScene
}) {
  const contextTheme = useThemeContext()
  const storeTheme = useSettingsStore((state) => state.theme.mode)
  const mode = contextTheme ?? storeTheme
  const colors = getThemeColors(mode)
  const isDark = mode === 'dark'
  const stroke = isDark ? PREVIEW_STROKE_DARK : PREVIEW_STROKE
  return (
    <Group name={`changeover-grid-source-preview-${scene.mode}`} listening={false}>
      {scene.dim && (
        <Rect
          {...scene.dim}
          fill={colors.background}
          opacity={0.78}
          cornerRadius={4}
          listening={false}
        />
      )}
      {scene.removed.map((wire, index) => (
        <Group key={`removed-${wire.id}-${index}`} name="changeover-grid-source-preview-removed">
          <Line
            points={points(wire)}
            stroke={colors.background}
            strokeWidth={(isThick(wire) ? 6 : 2) + 2}
            listening={false}
          />
          <Line
            points={points(wire)}
            stroke={colors.secondaryText}
            strokeWidth={isThick(wire) ? 2.5 : 1.5}
            dash={REMOVED_DASH}
            opacity={0.7}
            listening={false}
          />
        </Group>
      ))}
      {scene.removedJunctions.map((point) => (
        <Circle
          key={`removed-junction-${point.x}-${point.y}`}
          name="changeover-grid-source-preview-removed-junction"
          x={point.x}
          y={point.y}
          radius={4}
          fill={colors.background}
          listening={false}
        />
      ))}
      {scene.context.map((wire, index) => (
        <Line
          key={`context-${wire.id}-${index}`}
          name="changeover-grid-source-preview-context"
          points={points(wire)}
          stroke={stroke}
          strokeWidth={isThick(wire) ? 3 : 2}
          dash={PREVIEW_DASH}
          opacity={0.55}
          listening={false}
        />
      ))}
      {scene.devices.map((rect, index) => (
        <Rect
          key={`device-${index}`}
          name="changeover-grid-source-preview-device"
          {...rect}
          stroke={stroke}
          strokeWidth={1.5}
          dash={[5, 3]}
          cornerRadius={3}
          fill={isDark ? 'rgba(56,189,248,0.10)' : 'rgba(2,132,199,0.08)'}
          opacity={0.8}
          listening={false}
        />
      ))}
      {scene.added.map((wire, index) => (
        <Line
          key={`added-${wire.id}-${index}`}
          name="changeover-grid-source-preview-added"
          points={points(wire)}
          stroke={stroke}
          strokeWidth={isThick(wire) ? 6 : 3}
          dash={PREVIEW_DASH}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      ))}
      {scene.junctions.map((point) => (
        <Circle
          key={`junction-${point.x}-${point.y}`}
          x={point.x}
          y={point.y}
          radius={SUPPLY_JUNCTION_DOT_RADIUS}
          fill={stroke}
          listening={false}
        />
      ))}
    </Group>
  )
})
