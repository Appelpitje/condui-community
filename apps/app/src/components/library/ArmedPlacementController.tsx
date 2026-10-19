import { useEffect } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import { useViewportWindowStore } from '@/components/viewport/ViewportWindowStore'

/**
 * Owns the lifetime of a click-armed library symbol: Esc, view changes and losing placement
 * rights disarm it. Canvases render their own banner (see ArmedSymbolCanvasBanner).
 */
export default function ArmedPlacementController({ enabled }: { enabled: boolean }) {
  const ownerWindow = useCanvasWindow()
  const armed = useUIStore((state) => state.armedLibrarySymbol != null)
  const setArmedLibrarySymbol = useUIStore((state) => state.setArmedLibrarySymbol)
  const viewMode = useViewportWindowStore((state) => state.viewMode)

  useEffect(() => {
    useUIStore.getState().setArmedLibrarySymbol(null)
  }, [viewMode, enabled])

  useEffect(() => {
    if (!armed) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      setArmedLibrarySymbol(null)
    }
    ownerWindow.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => ownerWindow.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [armed, setArmedLibrarySymbol, ownerWindow])

  return null
}
