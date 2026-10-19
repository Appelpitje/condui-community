import { useCallback, useEffect, useState } from 'react'
import { createStore } from 'zustand/vanilla'

type Point = { x: number; y: number }
export type PointerPreviewStore = ReturnType<typeof createPointerPreviewStore>

function createPointerPreviewStore() {
  return createStore<{ point: Point | null }>(() => ({ point: null }))
}

/** Keep pointer-only feedback below the canvas owner, scoped to this viewport. */
export function usePointerPreview() {
  const [pointStore] = useState(createPointerPreviewStore)
  const setPoint = useCallback(
    (point: Point | null) => {
      const previous = pointStore.getState().point
      if (previous?.x === point?.x && previous?.y === point?.y) return
      pointStore.setState({ point })
    },
    [pointStore]
  )
  useEffect(
    () => () => {
      pointStore.setState({ point: null })
    },
    [pointStore]
  )
  return { pointStore, setPoint }
}
