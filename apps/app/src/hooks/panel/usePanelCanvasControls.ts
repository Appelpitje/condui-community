import { useCallback, useState } from 'react'
import { ZOOM_MAX } from '@/constants/canvasConstants'
import { useProjectStore } from '@/stores/projectStore'
import { getPanelCanvasZoomMinimum } from '@/lib/panel/panelCanvasZoom'
import { clamp } from '@/lib/geometry'
import { useViewportUIStore as useUIStore } from '@/components/viewport/ViewportUIStore'
import type { Point } from '@/types/ui'

export function usePanelViewportHandlers() {
  const setPanelView = useUIStore((s) => s.setPanelView)
  const minZoom = useProjectStore((state) => getPanelCanvasZoomMinimum(state.currentProject))

  const handleZoomChange = useCallback(
    (zoom: number) => {
      setPanelView({ zoom: clamp(zoom, minZoom, ZOOM_MAX) })
    },
    [setPanelView, minZoom]
  )

  const handlePanChange = useCallback(
    (pan: { x: number; y: number }) => {
      setPanelView({ pan })
    },
    [setPanelView]
  )

  const handleViewTransformCommit = useCallback(
    (patch: { pan?: Point; zoom?: number }) => {
      const next: { pan?: Point; zoom?: number } = { ...patch }
      if (typeof next.zoom === 'number') {
        next.zoom = clamp(next.zoom, minZoom, ZOOM_MAX)
      }
      setPanelView(next)
    },
    [setPanelView, minZoom]
  )

  return {
    handlePanChange,
    handleViewTransformCommit,
    handleZoomChange,
  }
}

export function usePanelOptionsMenuState() {
  const [feedSideDirection, setFeedSideDirection] = useState<'left' | 'right'>('left')
  const [panelOptionsMenuOpen, setPanelOptionsMenuOpen] = useState(false)

  const closePanelOptionsMenu = useCallback(() => {
    setPanelOptionsMenuOpen(false)
  }, [])

  return {
    closePanelOptionsMenu,
    feedSideDirection,
    panelOptionsMenuOpen,
    setFeedSideDirection,
    setPanelOptionsMenuOpen,
  }
}
