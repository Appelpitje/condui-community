import { createContext, useContext } from 'react'
import type { CanvasSize } from '@/types/ui'

/** The viewport size measured by MeasuredCanvasViewport before its renderer mounts. */
export const InitialCanvasSizeContext = createContext<CanvasSize | null>(null)

export function useInitialCanvasSize(): CanvasSize | null {
  return useContext(InitialCanvasSizeContext)
}
