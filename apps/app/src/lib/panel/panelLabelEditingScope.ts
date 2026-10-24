import type { PanelSceneSurface } from './panelScene'
import { ROW_GAP, type ModulePlacement } from './panelGridLayout'

type LabelSurface = Pick<PanelSceneSurface, 'id' | 'x' | 'y' | 'width' | 'height'> & {
  placements: readonly Pick<ModulePlacement, 'x' | 'y' | 'width' | 'height' | 'terminalStripRail'>[]
}
type View = { pan: { x: number; y: number }; zoom: number; width: number; height: number }

/** Prefer visible label cells over offscreen boards, without building label metadata. */
export function choosePanelLabelSurface<T extends LabelSurface>(
  surfaces: readonly T[],
  view: View,
  preferredSurfaceId?: string | null
): T | undefined {
  let nearest: T | undefined
  let best = Infinity
  let visible: T | undefined
  let bestVisible = Infinity
  for (const surface of surfaces) {
    if (!surface.placements.some((placement) => placement.terminalStripRail == null)) continue
    const left = surface.x * view.zoom + view.pan.x
    const top = surface.y * view.zoom + view.pan.y
    const right = left + surface.width * view.zoom
    const bottom = top + surface.height * view.zoom
    // Distance to the board's rectangle favors a board covering the camera center.
    const dx = Math.max(left - view.width / 2, 0, view.width / 2 - right)
    const dy = Math.max(top - view.height / 2, 0, view.height / 2 - bottom)
    const distance = dx * dx + dy * dy
    if (distance < best) {
      best = distance
      nearest = surface
    }
    for (const placement of surface.placements) {
      if (placement.terminalStripRail != null) continue
      const cellLeft = left + placement.x * view.zoom
      const cellRight = cellLeft + placement.width * view.zoom
      if (cellRight <= 0 || cellLeft >= view.width) continue
      for (const side of ['top', 'bottom'] as const) {
        const cellTop =
          top +
          (placement.y + (side === 'top' ? -ROW_GAP / 2 : placement.height * 0.75)) * view.zoom
        const cellBottom = cellTop + (placement.height * 0.25 + ROW_GAP / 2) * view.zoom
        if (cellBottom <= 0 || cellTop >= view.height) continue
        // Keep an explicitly chosen board while its labels remain on screen.
        if (surface.id === preferredSurfaceId) return surface
        const cellDx = Math.max(cellLeft - view.width / 2, 0, view.width / 2 - cellRight)
        const cellDy = Math.max(cellTop - view.height / 2, 0, view.height / 2 - cellBottom)
        const cellDistance = cellDx * cellDx + cellDy * cellDy
        if (cellDistance < bestVisible) {
          bestVisible = cellDistance
          visible = surface
        }
      }
    }
  }
  return visible ?? nearest
}
