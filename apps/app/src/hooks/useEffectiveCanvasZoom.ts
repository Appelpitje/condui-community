import { ZOOM_100 } from '@/constants/canvasConstants'
import { useViewportUIStore as useUIStore } from '@/components/viewport/ViewportUIStore'
import type { CanvasType } from '@/types/ui'

/**
 * Canvas-space UI sizing uses the committed view zoom from the UI store.
 *
 * Wheel and pinch gestures update the Konva layer imperatively until the gesture settles. Subscribing
 * every symbol to live gesture zoom forced the whole canvas tree to re-render on each zoom frame in
 * Chrome, which showed up as long requestAnimationFrame handlers.
 */
export function useEffectiveCanvasZoom(fallbackZoom: number, canvas: CanvasType): number {
  const viewZoom = useUIStore((s) => {
    switch (canvas) {
      case 'eendraad':
        return s.eendraadView.zoom
      case 'plan':
        return s.planView.zoom
      case 'panel':
        return s.panelView.zoom
      case 'structure':
        return s.structureView.zoom
      default:
        return fallbackZoom
    }
  })
  const safe =
    Number.isFinite(viewZoom) && viewZoom > 0
      ? viewZoom
      : Number.isFinite(fallbackZoom) && fallbackZoom > 0
        ? fallbackZoom
        : ZOOM_100
  return safe
}
