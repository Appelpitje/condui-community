import { useCallback, useEffect, useRef } from 'react'
import type Konva from 'konva'
import { createCanvasDragImage, type CanvasDragImage } from '@/lib/canvas/dragImage'

export function useCanvasDragImage() {
  const imageRef = useRef<CanvasDragImage | null>(null)
  const end = useCallback(() => {
    imageRef.current?.dispose()
    imageRef.current = null
  }, [])
  useEffect(() => end, [end])
  const begin = useCallback(
    (node: Konva.Node) => {
      end()
      imageRef.current = createCanvasDragImage(node)
      return imageRef.current !== null
    },
    [end]
  )
  const update = useCallback(() => imageRef.current?.update(), [])
  return { begin, update, end }
}
