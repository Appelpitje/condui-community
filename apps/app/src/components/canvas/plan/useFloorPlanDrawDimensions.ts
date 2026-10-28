import { useCallback, useEffect, useRef, useState } from 'react'
import type { Point2 } from '@/types/schema'

interface DimensionSource {
  isDrawing: boolean
  currentPoints: Point2[]
  rectStartPoint: Point2 | null
  canvasPxPerMeter: number
  window: Window
  scheduleMousePreviewPosition: (point: Point2 | null) => void
}

const sameSource = (previous: readonly unknown[], next: readonly unknown[]) =>
  previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]))

/** Owns the editable dimensions and their native timeout handles. Subscriptions are
 * installed separately so callers can preserve command-before-auto-lock ordering. */
export function useFloorPlanDrawDimensions(source: DimensionSource) {
  const [penDimensionText, setPenDimensionText] = useState('')
  const [penLockedLengthMeters, setPenLockedLengthMeters] = useState<number | null>(null)
  const [rectDimensionTextX, setRectDimensionTextX] = useState('')
  const [rectDimensionTextY, setRectDimensionTextY] = useState('')
  const [rectLockedXMeters, setRectLockedXMeters] = useState<number | null>(null)
  const [rectLockedYMeters, setRectLockedYMeters] = useState<number | null>(null)
  const [rectActiveAxis, setRectActiveAxis] = useState<'x' | 'y'>('x')
  const penTimer = useRef<number | null>(null)
  const rectXTimer = useRef<number | null>(null)
  const rectYTimer = useRef<number | null>(null)

  const penKey = [penDimensionText, source.isDrawing, source.canvasPxPerMeter,
    source.scheduleMousePreviewPosition, source.currentPoints, source.window]
  const rectXKey = [rectDimensionTextX, source.rectStartPoint, source.canvasPxPerMeter,
    source.scheduleMousePreviewPosition, source.window]
  const rectYKey = [rectDimensionTextY, source.rectStartPoint, source.canvasPxPerMeter,
    source.scheduleMousePreviewPosition, source.window]
  const [previousPenKey, setPreviousPenKey] = useState(penKey)
  const [previousRectXKey, setPreviousRectXKey] = useState(rectXKey)
  const [previousRectYKey, setPreviousRectYKey] = useState(rectYKey)
  if (!sameSource(previousPenKey, penKey)) {
    setPreviousPenKey(penKey)
    if (!source.isDrawing || !penDimensionText.trim()) setPenLockedLengthMeters(null)
  }
  const rectXChanged = !sameSource(previousRectXKey, rectXKey)
  const rectYChanged = !sameSource(previousRectYKey, rectYKey)
  if (rectXChanged) setPreviousRectXKey(rectXKey)
  if (rectYChanged) setPreviousRectYKey(rectYKey)
  if ((rectXChanged || rectYChanged) && !source.rectStartPoint) {
    setRectDimensionTextX('')
    setRectDimensionTextY('')
    setRectLockedXMeters(null)
    setRectLockedYMeters(null)
    setRectActiveAxis('x')
  } else {
    if (rectXChanged && !rectDimensionTextX.trim()) setRectLockedXMeters(null)
    if (rectYChanged && !rectDimensionTextY.trim()) setRectLockedYMeters(null)
  }

  const cancelPenAutoLock = useCallback(() => {
    if (penTimer.current != null) {
      clearTimeout(penTimer.current)
      penTimer.current = null
    }
  }, [])
  const cancelRectXAutoLock = useCallback(() => {
    if (rectXTimer.current != null) {
      clearTimeout(rectXTimer.current)
      rectXTimer.current = null
    }
  }, [])
  const cancelRectYAutoLock = useCallback(() => {
    if (rectYTimer.current != null) {
      clearTimeout(rectYTimer.current)
      rectYTimer.current = null
    }
  }, [])
  const cancelRectAutoLocks = useCallback(() => {
    cancelRectXAutoLock()
    cancelRectYAutoLock()
  }, [cancelRectXAutoLock, cancelRectYAutoLock])
  const startPenAutoLock = useCallback((owner: Window, complete: () => void) => {
    if (penTimer.current != null) clearTimeout(penTimer.current)
    penTimer.current = owner.setTimeout(complete, 250)
  }, [])
  const startRectXAutoLock = useCallback((owner: Window, complete: () => void) => {
    if (rectXTimer.current != null) clearTimeout(rectXTimer.current)
    rectXTimer.current = owner.setTimeout(complete, 250)
  }, [])
  const startRectYAutoLock = useCallback((owner: Window, complete: () => void) => {
    if (rectYTimer.current != null) clearTimeout(rectYTimer.current)
    rectYTimer.current = owner.setTimeout(complete, 250)
  }, [])
  const clearPenConstraints = useCallback(() => {
    cancelPenAutoLock()
    setPenDimensionText('')
    setPenLockedLengthMeters(null)
  }, [cancelPenAutoLock])
  const clearRectConstraints = useCallback(() => {
    cancelRectAutoLocks()
    setRectDimensionTextX('')
    setRectDimensionTextY('')
    setRectLockedXMeters(null)
    setRectLockedYMeters(null)
    setRectActiveAxis('x')
  }, [cancelRectAutoLocks])

  return {
    penDimensionText, setPenDimensionText, penLockedLengthMeters, setPenLockedLengthMeters,
    rectDimensionTextX, setRectDimensionTextX, rectDimensionTextY, setRectDimensionTextY,
    rectLockedXMeters, setRectLockedXMeters, rectLockedYMeters, setRectLockedYMeters,
    rectActiveAxis, setRectActiveAxis, clearPenConstraints, clearRectConstraints,
    cancelPenAutoLock, cancelRectXAutoLock, cancelRectYAutoLock, cancelRectAutoLocks,
    startPenAutoLock, startRectXAutoLock, startRectYAutoLock,
  }
}

type Dimensions = ReturnType<typeof useFloorPlanDrawDimensions>

/** The three subscriptions retain their pen, X, Y registration order. Geometry
 * sources belong to the scheduled render; only the cursor is read at completion. */
export function useFloorPlanDrawDimensionTimers(
  source: DimensionSource,
  dimensions: Dimensions,
  readMousePreviewPosition: () => Point2 | null,
) {
  const { isDrawing, currentPoints, rectStartPoint, canvasPxPerMeter, window,
    scheduleMousePreviewPosition } = source
  const { penDimensionText, rectDimensionTextX, rectDimensionTextY,
    setPenLockedLengthMeters, setRectLockedXMeters, setRectLockedYMeters,
    startPenAutoLock, startRectXAutoLock, startRectYAutoLock,
    cancelPenAutoLock, cancelRectXAutoLock, cancelRectYAutoLock, cancelRectAutoLocks } = dimensions

  useEffect(() => {
    if (!isDrawing || !penDimensionText.trim()) {
      cancelPenAutoLock()
      return
    }
    startPenAutoLock(window, () => {
      const v = parseFloat(penDimensionText.trim().replace(',', '.'))
      if (Number.isFinite(v) && v > 0) {
        setPenLockedLengthMeters(v / 100)
        const preview = readMousePreviewPosition()
        if (preview && currentPoints.length > 0) {
          const start = currentPoints[currentPoints.length - 1]!
          const dx = preview.x - start.x
          const dy = preview.y - start.y
          const lenPx = Math.sqrt(dx * dx + dy * dy)
          const targetPx = v * canvasPxPerMeter
          if (lenPx > 1e-6 && targetPx > 0) {
            const scale = targetPx / lenPx
            scheduleMousePreviewPosition({ x: start.x + dx * scale, y: start.y + dy * scale })
          }
        }
      } else setPenLockedLengthMeters(null)
    })
    return cancelPenAutoLock
  }, [penDimensionText, isDrawing, canvasPxPerMeter, scheduleMousePreviewPosition,
    currentPoints, window, readMousePreviewPosition, setPenLockedLengthMeters,
    startPenAutoLock, cancelPenAutoLock])

  useEffect(() => {
    if (!rectStartPoint) {
      cancelRectAutoLocks()
      return
    }
    if (!rectDimensionTextX.trim()) return
    startRectXAutoLock(window, () => {
      const v = parseFloat(rectDimensionTextX.trim().replace(',', '.'))
      if (Number.isFinite(v) && v > 0) {
        setRectLockedXMeters(v / 100)
        const preview = readMousePreviewPosition()
        if (preview) {
          const signX = preview.x - rectStartPoint.x >= 0 ? 1 : -1
          scheduleMousePreviewPosition({ ...preview, x: rectStartPoint.x + signX * v * canvasPxPerMeter })
        }
      } else setRectLockedXMeters(null)
    })
    return cancelRectXAutoLock
  }, [rectDimensionTextX, rectStartPoint, canvasPxPerMeter, scheduleMousePreviewPosition,
    window, readMousePreviewPosition, setRectLockedXMeters, startRectXAutoLock,
    cancelRectXAutoLock, cancelRectAutoLocks])

  useEffect(() => {
    if (!rectStartPoint) {
      cancelRectAutoLocks()
      return
    }
    if (!rectDimensionTextY.trim()) return
    startRectYAutoLock(window, () => {
      const v = parseFloat(rectDimensionTextY.trim().replace(',', '.'))
      if (Number.isFinite(v) && v > 0) {
        setRectLockedYMeters(v / 100)
        const preview = readMousePreviewPosition()
        if (preview) {
          const signY = preview.y - rectStartPoint.y >= 0 ? 1 : -1
          scheduleMousePreviewPosition({ ...preview, y: rectStartPoint.y + signY * v * canvasPxPerMeter })
        }
      } else setRectLockedYMeters(null)
    })
    return cancelRectYAutoLock
  }, [rectDimensionTextY, rectStartPoint, canvasPxPerMeter, scheduleMousePreviewPosition,
    window, readMousePreviewPosition, setRectLockedYMeters, startRectYAutoLock,
    cancelRectYAutoLock, cancelRectAutoLocks])
}
