import { useCallback, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import { clamp } from '@/lib/geometry'

const DIVIDER_SIZE_PX = 4
/** ~Tailwind `3` (0.75rem): legacy default hit padding each side of the bar. */
const DEFAULT_PERP_SLOP_PX = 12
/** Show the hover grip only when this close to the visible bar (perpendicular axis). */
const HOVER_PREVIEW_ENTER_PERP_PX = 3

interface ResizableDividerProps {
  direction: 'horizontal' | 'vertical'
  startRatio: number
  onRatioChange: (ratio: number, containerSize: number) => void
  onDragStart?: () => void
  onDragEnd?: (ratio: number, containerSize: number) => void
  ratio?: number
  heightFraction?: number
  topFraction?: number
  /**
   * Extra pointer target beyond the visible bar, on the perpendicular axis.
   * For a vertical bar: negative = toward smaller X (e.g. left dock panel), positive = toward larger X (canvas).
   * Defaults match the previous symmetric ~12px slop on both sides.
   */
  perpSlopNegativePx?: number
  perpSlopPositivePx?: number
}

export function ResizableDivider({
  direction,
  startRatio,
  onRatioChange,
  onDragStart,
  onDragEnd,
  ratio,
  heightFraction,
  topFraction,
  perpSlopNegativePx = DEFAULT_PERP_SLOP_PX,
  perpSlopPositivePx = DEFAULT_PERP_SLOP_PX,
}: ResizableDividerProps) {
  const { t } = useTranslation()
  const window = useCanvasWindow()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<HTMLDivElement | null>(null)
  const handlePositionRafRef = useRef<number | null>(null)
  const pendingHandleRatioRef = useRef<number>(0.5)
  const startRatioRef = useRef(startRatio)
  useLayoutEffect(() => {
    startRatioRef.current = startRatio
  }, [startRatio])
  const hoverActiveRef = useRef(false)

  const startDrag = useCallback(
    (startPos: number, container: HTMLElement) => {
      const document = container.ownerDocument
      const dragStartRatio = startRatioRef.current
      let lastRatio = dragStartRatio
      const containerSize =
        direction === 'vertical' ? container.offsetWidth : container.offsetHeight
      let latestRatio = dragStartRatio
      let rafId: number | null = null
      onDragStart?.()

      const update = (currentPos: number) => {
        const delta = currentPos - startPos
        latestRatio = dragStartRatio + delta / containerSize
        lastRatio = latestRatio
        if (rafId != null) return
        rafId = window.requestAnimationFrame(() => {
          rafId = null
          onRatioChange(latestRatio, containerSize)
        })
      }

      const handleMouseMove = (e: MouseEvent) =>
        update(direction === 'vertical' ? e.clientX : e.clientY)
      const handleTouchMove = (e: TouchEvent) => {
        e.preventDefault()
        if (e.touches[0])
          update(direction === 'vertical' ? e.touches[0].clientX : e.touches[0].clientY)
      }

      const cleanup = () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', cleanup)
        document.removeEventListener('touchmove', handleTouchMove)
        document.removeEventListener('touchend', cleanup)
        document.removeEventListener('touchcancel', cleanup)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        if (rafId != null) {
          window.cancelAnimationFrame(rafId)
          rafId = null
          onRatioChange(latestRatio, containerSize)
        }
        onDragEnd?.(lastRatio, containerSize)
      }

      document.body.style.cursor = direction === 'vertical' ? 'ew-resize' : 'ns-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', cleanup)
      document.addEventListener('touchmove', handleTouchMove, { passive: false })
      document.addEventListener('touchend', cleanup)
      document.addEventListener('touchcancel', cleanup)
    },
    [direction, onDragEnd, onDragStart, onRatioChange, window]
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const container = rootRef.current?.parentElement ?? null
      if (!container) return
      startDrag(direction === 'vertical' ? e.clientX : e.clientY, container)
    },
    [direction, startDrag]
  )

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault()
      const container = rootRef.current?.parentElement ?? null
      const touch = e.touches[0]
      if (!container || !touch) return
      startDrag(direction === 'vertical' ? touch.clientX : touch.clientY, container)
    },
    [direction, startDrag]
  )

  const updateHandlePositionFromPointer = useCallback(
    (offsetAlongAxis: number, axisSize: number) => {
      const handle = handleRef.current
      if (!handle) return
      const rawRatio = axisSize > 0 ? offsetAlongAxis / axisSize : 0.5
      pendingHandleRatioRef.current = clamp(rawRatio, 0.04, 0.96)
      if (handlePositionRafRef.current != null) return
      handlePositionRafRef.current = window.requestAnimationFrame(() => {
        handlePositionRafRef.current = null
        const ratioValue = pendingHandleRatioRef.current
        if (direction === 'vertical') {
          handle.style.top = `${ratioValue * 100}%`
        } else {
          handle.style.left = `${ratioValue * 100}%`
        }
      })
    },
    [direction, window]
  )

  const setHandleVisible = useCallback((visible: boolean) => {
    const handle = handleRef.current
    if (!handle) return
    if (visible) {
      handle.style.opacity = '1'
      handle.style.transitionDuration = '0ms'
      hoverActiveRef.current = true
      return
    }
    handle.style.opacity = '0'
    handle.style.transitionDuration = '130ms'
    hoverActiveRef.current = false
  }, [])

  /** Strict threshold to *show*; once shown, stay on until `mouseLeave` of the full slop layer. */
  const updateHoverPreviewFromClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (hoverActiveRef.current) return
      const root = rootRef.current
      if (!root) return
      const rect = root.getBoundingClientRect()
      const perpDist =
        direction === 'vertical'
          ? Math.abs(clientX - (rect.left + rect.width / 2))
          : Math.abs(clientY - (rect.top + rect.height / 2))
      if (perpDist <= HOVER_PREVIEW_ENTER_PERP_PX) setHandleVisible(true)
    },
    [direction, setHandleVisible]
  )

  const isAbsolute = ratio != null

  const hitSlopStyle: CSSProperties =
    direction === 'vertical'
      ? {
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: -perpSlopNegativePx,
          right: -perpSlopPositivePx,
        }
      : {
          position: 'absolute',
          left: 0,
          right: 0,
          top: -perpSlopNegativePx,
          bottom: -perpSlopPositivePx,
        }

  useEffect(() => {
    return () => {
      if (handlePositionRafRef.current != null) {
        window.cancelAnimationFrame(handlePositionRafRef.current)
        handlePositionRafRef.current = null
      }
    }
  }, [window])
  const style: CSSProperties = { touchAction: 'none' }
  if (isAbsolute) {
    const half = DIVIDER_SIZE_PX / 2
    style.position = 'absolute'
    style.zIndex = 40
    if (direction === 'vertical') {
      style.left = `calc(${ratio * 100}% - ${half}px)`
      style.top = topFraction != null ? `${topFraction * 100}%` : '0'
      style.width = DIVIDER_SIZE_PX
      style.height = heightFraction != null ? `${heightFraction * 100}%` : '100%'
    } else {
      style.top = `calc(${ratio * 100}% - ${half}px)`
      style.left = '0'
      style.height = DIVIDER_SIZE_PX
      style.width = '100%'
    }
  }

  const resizeFromKeyboard = (nextRatio: number) => {
    const container = rootRef.current?.parentElement
    if (!container) return
    const containerSize = direction === 'vertical' ? container.offsetWidth : container.offsetHeight
    if (containerSize <= 0) return
    onDragStart?.()
    onRatioChange(nextRatio, containerSize)
    onDragEnd?.(nextRatio, containerSize)
  }

  return (
    <div
      ref={rootRef}
      className={`group pointer-events-auto relative bg-gray-300 dark:bg-gray-600 ${
        direction === 'vertical' ? 'cursor-ew-resize' : 'cursor-ns-resize'
      } ${isAbsolute ? '' : `flex-shrink-0 ${direction === 'vertical' ? 'w-1' : 'h-1'}`}`}
      style={style}
    >
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(clamp(startRatio, 0, 1) * 100)}
        aria-label={t('commandPalette.resizePanel')}
        aria-orientation={direction === 'vertical' ? 'horizontal' : 'vertical'}
        className={`peer absolute z-20 m-0 opacity-0 ${
          direction === 'vertical' ? 'cursor-ew-resize' : 'cursor-ns-resize'
        }`}
        style={{
          ...hitSlopStyle,
          width: direction === 'vertical'
            ? `calc(100% + ${perpSlopNegativePx + perpSlopPositivePx}px)` : '100%',
          height: direction === 'vertical'
            ? '100%' : `calc(100% + ${perpSlopNegativePx + perpSlopPositivePx}px)`,
        }}
        onFocus={() => setHandleVisible(true)}
        onBlur={() => setHandleVisible(false)}
        onChange={(event) => resizeFromKeyboard(Number(event.currentTarget.value) / 100)}
        onKeyDown={(event) => {
          const decreaseKey = direction === 'vertical' ? 'ArrowLeft' : 'ArrowUp'
          const increaseKey = direction === 'vertical' ? 'ArrowRight' : 'ArrowDown'
          if (event.key !== decreaseKey && event.key !== increaseKey) return
          event.preventDefault()
          event.stopPropagation()
          const nextRatio = clamp(startRatio + (event.key === increaseKey ? 0.01 : -0.01), 0, 1)
          resizeFromKeyboard(nextRatio)
        }}
        onMouseMove={(e) => {
          const axisSize =
            direction === 'vertical' ? e.currentTarget.clientHeight : e.currentTarget.clientWidth
          const offsetAlongAxis =
            direction === 'vertical' ? e.nativeEvent.offsetY : e.nativeEvent.offsetX
          updateHandlePositionFromPointer(offsetAlongAxis, axisSize)
          updateHoverPreviewFromClientPoint(e.clientX, e.clientY)
        }}
        onMouseEnter={(e) => {
          const axisSize =
            direction === 'vertical' ? e.currentTarget.clientHeight : e.currentTarget.clientWidth
          const offsetAlongAxis =
            direction === 'vertical' ? e.nativeEvent.offsetY : e.nativeEvent.offsetX
          updateHandlePositionFromPointer(offsetAlongAxis, axisSize)
          updateHoverPreviewFromClientPoint(e.clientX, e.clientY)
        }}
        onMouseLeave={() => setHandleVisible(false)}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      />
      <div
        ref={handleRef}
        aria-hidden
        className={`pointer-events-none absolute z-10 rounded-md border border-gray-300/90 bg-white/95 shadow-sm transition-opacity ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-sky-500 dark:border-gray-500/90 dark:bg-gray-700/95 ${
          direction === 'vertical'
            ? 'left-1/2 h-7 w-4 -translate-x-1/2 -translate-y-1/2'
            : 'top-1/2 h-4 w-7 -translate-x-1/2 -translate-y-1/2'
        }`}
        style={{
          opacity: 0,
          transitionDuration: '130ms',
          top: direction === 'vertical' ? '50%' : '50%',
          left: direction === 'vertical' ? '50%' : '50%',
        }}
      >
        <div
          className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${
            direction === 'vertical' ? 'flex flex-col gap-1' : 'flex gap-1'
          }`}
        >
          <span className="block h-0.5 w-0.5 rounded-full bg-gray-500 dark:bg-gray-300" />
          <span className="block h-0.5 w-0.5 rounded-full bg-gray-500 dark:bg-gray-300" />
          <span className="block h-0.5 w-0.5 rounded-full bg-gray-500 dark:bg-gray-300" />
        </div>
      </div>
    </div>
  )
}

export default ResizableDivider
