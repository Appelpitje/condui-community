import { createContext, useContext } from 'react'

export interface ViewportContextValue {
  panelIndex: number
  getOwnerWindow: () => Window
  detached: boolean
  toggleDetached: () => void
}

export const ViewportContext = createContext<ViewportContextValue | null>(null)
/** Portalled app dialogs retain the window used by their nested controls. */
export const CanvasWindowContext = createContext<Window | null>(null)
export const useViewport = () => useContext(ViewportContext)
export const useCanvasWindow = () => {
  const ownerWindow = useContext(CanvasWindowContext)
  const viewport = useContext(ViewportContext)
  return ownerWindow ?? viewport?.getOwnerWindow() ?? window
}
