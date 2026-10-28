import { useCallback, useMemo } from 'react'

import { Line } from 'react-konva'

import type { CanvasSize, Point } from '@/types/ui'

import { clamp } from '@/lib/geometry'

const GRID_HIDE_ZOOM_BELOW = 0.06
const GRID_MIN_CELL_SCREEN_PX = 12
interface BaseCanvasGridOptions {
  actualBackgroundColor: string
  gridColor: string
  gridInTransformedLayer: boolean
  gridOpacity: number
  gridSize: number
  safePan: Point
  safeZoom: number
  showGrid: boolean
  size: CanvasSize
}

export function useBaseCanvasGrid({
  actualBackgroundColor,
  gridColor,
  gridInTransformedLayer,
  gridOpacity,
  gridSize,
  safePan,
  safeZoom,
  showGrid,
  size,
}: BaseCanvasGridOptions) {
  // Generate grid lines
  const generateGrid = useCallback(() => {
    if (!showGrid) return []
    if (safeZoom < GRID_HIDE_ZOOM_BELOW) return []

    // Interpret gridOpacity as a theme-aware intensity parameter rather than real alpha.
    // Clamp to 0–0.75 in practice; 0.75 is treated as “full strength” in the UI.
    const clamped = clamp(gridOpacity, 0, 0.75)
    const t = clamped <= 0 ? 0 : clamped / 0.75 // 0–1

    // Lerp grid stroke between background and theme grid color.
    // At low intensity it's close to background; at high intensity it's close to colors.grid.
    const lerpColor = (a: string, b: string, amount: number): string => {
      const parse = (hex: string) => {
        const m = hex.trim().match(/^#?([0-9a-f]{6})$/i)
        if (!m) return [0, 0, 0] as const
        const int = parseInt(m[1]!, 16)
        return [(int >> 16) & 255, (int >> 8) & 255, int & 255] as const
      }
      const [r1, g1, b1] = parse(a)
      const [r2, g2, b2] = parse(b)
      const mix = (c1: number, c2: number) => Math.round(c1 + (c2 - c1) * amount)
      const r = mix(r1, r2)
      const g = mix(g1, g2)
      const blue = mix(b1, b2)
      return `rgb(${r}, ${g}, ${blue})`
    }

    const strokeColor = lerpColor(actualBackgroundColor, gridColor, 0.3 + 0.7 * t)

    const lines: React.JSX.Element[] = []

    if (gridInTransformedLayer) {
      // Grid moves with canvas (for Plan canvas)
      // Calculate visible area in world coordinates (use safe values to avoid NaN on Safari)
      const worldLeft = -safePan.x / safeZoom
      const worldTop = -safePan.y / safeZoom
      const worldRight = (size.width - safePan.x) / safeZoom
      const worldBottom = (size.height - safePan.y) / safeZoom

      // Keep the visible grid from collapsing into blurry overdraw when zoomed out.
      // When a cell gets too small in screen-space, draw every 2nd/4th/... line.
      const screenCellSizePx = gridSize * safeZoom
      if (screenCellSizePx < GRID_MIN_CELL_SCREEN_PX / 64) {
        return []
      }
      const minVisibleCellPx = GRID_MIN_CELL_SCREEN_PX
      const lodFactor =
        screenCellSizePx >= minVisibleCellPx
          ? 1
          : Math.pow(2, Math.ceil(Math.log2(minVisibleCellPx / Math.max(screenCellSizePx, 0.0001))))
      const effectiveGridSize = gridSize * lodFactor

      // Add modest overscan for panning without drawing multiple hidden viewports during resize.
      const padding = Math.min(240, Math.max(size.width, size.height) * 0.25) / safeZoom
      const startX = Math.floor((worldLeft - padding) / effectiveGridSize) * effectiveGridSize
      const endX = Math.ceil((worldRight + padding) / effectiveGridSize) * effectiveGridSize
      const startY = Math.floor((worldTop - padding) / effectiveGridSize) * effectiveGridSize
      const endY = Math.ceil((worldBottom + padding) / effectiveGridSize) * effectiveGridSize
      const verticalLineCount = Math.floor((endX - startX) / effectiveGridSize) + 1
      const horizontalLineCount = Math.floor((endY - startY) / effectiveGridSize) + 1
      if (verticalLineCount + horizontalLineCount > 700) return []

      // Vertical lines
      for (let x = startX; x <= endX; x += effectiveGridSize) {
        lines.push(
          <Line
            key={`v-${x}`}
            points={[x, startY, x, endY]}
            stroke={strokeColor}
            strokeWidth={1}
            strokeScaleEnabled={false}
            opacity={1}
            listening={false}
          />
        )
      }

      // Horizontal lines
      for (let y = startY; y <= endY; y += effectiveGridSize) {
        lines.push(
          <Line
            key={`h-${y}`}
            points={[startX, y, endX, y]}
            stroke={strokeColor}
            strokeWidth={1}
            strokeScaleEnabled={false}
            opacity={1}
            listening={false}
          />
        )
      }
    } else {
      // Static grid in background layer (for Eendraad - very faint or disabled)
      const padding = 1000
      const startX = Math.floor((-safePan.x - padding) / (gridSize * safeZoom)) * gridSize
      const endX = Math.ceil((size.width - safePan.x + padding) / (gridSize * safeZoom)) * gridSize
      const startY = Math.floor((-safePan.y - padding) / (gridSize * safeZoom)) * gridSize
      const endY = Math.ceil((size.height - safePan.y + padding) / (gridSize * safeZoom)) * gridSize

      // Vertical lines
      for (let x = startX; x <= endX; x += gridSize) {
        lines.push(
          <Line
            key={`v-${x}`}
            points={[x, startY, x, endY]}
            stroke={strokeColor}
            strokeWidth={1 / safeZoom}
            opacity={1}
            listening={false}
          />
        )
      }

      // Horizontal lines
      for (let y = startY; y <= endY; y += gridSize) {
        lines.push(
          <Line
            key={`h-${y}`}
            points={[startX, y, endX, y]}
            stroke={strokeColor}
            strokeWidth={1 / safeZoom}
            opacity={1}
            listening={false}
          />
        )
      }
    }

    return lines
  }, [
    showGrid,
    gridSize,
    safeZoom,
    safePan,
    size,
    gridColor,
    actualBackgroundColor,
    gridInTransformedLayer,
    gridOpacity,
  ])
  // Local touch/overlay state must not recreate grid Line points and dirty the
  // whole plan layer when its camera, dimensions and appearance did not change.
  const gridElements = useMemo(() => generateGrid(), [generateGrid])

  return { gridElements }
}
