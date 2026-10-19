import { useCallback } from 'react'
import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import { useViewportWindowApi } from '@/components/viewport/ViewportWindowStore'
import { focusSelectionOnCanvas } from '@/lib/ui/focusSelectionOnCanvas'
import type { Selection } from '@/types/ui'

/** Panel navigation follows the window containing that panel. */
export function useFocusSelectionOnCanvas() {
  const ui = useViewportWindowApi()
  const ownerWindow = useCanvasWindow()
  return useCallback(
    (selection: Selection, options?: Parameters<typeof focusSelectionOnCanvas>[1]) => {
      focusSelectionOnCanvas(selection, options, {
        getState: ui.getState,
        getWindow: () => ownerWindow,
      })
    },
    [ui, ownerWindow]
  )
}
