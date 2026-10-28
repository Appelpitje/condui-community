import { suppressNextCanvasElementTap } from '@/lib/canvas/syntheticElementTap'
import {
  LONG_PRESS_DELAY_MS,
  LONG_PRESS_FILL_MS,
  LONG_PRESS_READY_MS,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP_PX,
  debugTouchLog,
} from './baseCanvasGestureTiming'
import type { BaseCanvasProps } from './baseCanvasModel'
import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import type { useViewportUIApi } from '@/components/viewport/ViewportUIStore'
import { isNodeDraggableForTouch } from '@/lib/canvas/touchDragOwnership'

import { useEffect, useCallback } from 'react'

import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Point, Selection } from '@/types/ui'
import { ZOOM_MAX } from '@/constants/canvasConstants'

import { selectMultiple } from '@/utils/selection'
import type { useCommitSelection } from '@/editions/community/communityHooks'
import { dismissCanvasOverlays } from '@/lib/ui/canvasOverlayDismiss'

import { isAppDialogOpen } from '@/lib/ui/appModalInteraction'

import type { ContextMenuItem } from '@/components/common/ContextMenu'

import { resolveKonvaElementId } from './baseCanvasElementId'
import { clamp } from '@/lib/geometry'

import {
  isPotentialSecondTap,
  longPressTargetIsSelectionBackground,
  shouldActivateSingleFingerPan,
  shouldIgnoreCanvasTouchForContextMenu,
  shouldScheduleTouchLongPress,
} from '@/lib/canvas/touchGestureIntent'

import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from 'react'

type CanvasSelectionRectangle = { startX: number; startY: number; endX: number; endY: number }
type CanvasContextMenu = { position: Point; items: ContextMenuItem[] } | null
type CanvasTouchEvent = React.TouchEvent<HTMLDivElement> | TouchEvent
interface LongPressGestureState {
  phase: 'idle' | 'filling' | 'ready'
  action: 'idle' | 'duplicate-drag' | 'drag-select'
  origin: Point | null
  screenPos: Point | null
  elementId: string | null
  elementType: Selection['type'] | null
  startedOnDraggable: boolean
  startedAt: number
  delayTimer: ReturnType<typeof setTimeout> | null
  readyTimer: ReturnType<typeof setTimeout> | null
}
interface BaseCanvasTouchGesturesOptions extends Pick<BaseCanvasProps,
  'enableLongPressContextMenu' | 'enableSingleFingerPan' | 'onFindElementsInRectangle' |
  'onMultiFingerSwipe' | 'prioritizeNavigation' | 'zoom' | 'pan'> {
  activateLongPressReady: (clientX?: number, clientY?: number) => boolean
  applyCssCameraTransform: (nextPan: Point, nextZoom: number) => boolean
  beginCssCameraTransform: (startPan: Point, startZoom: number) => void
  cameraGestureActiveRef: RefObject<boolean>
  cameraSyncTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>
  cancelLongPress: () => void
  cancelPendingTouchSelectionClear: () => void
  clearPreviewSelection: () => void
  containerRef: RefObject<HTMLDivElement | null>
  contentLayerRef: RefObject<Konva.Layer | null>
  contextMenu: CanvasContextMenu
  cssCameraTransformRef: RefObject<{
    active: boolean; startPan: Point; startZoom: number; livePan: Point; liveZoom: number
  }>
  dismissLongPressIndicator: (position?: Point) => void
  dragOccurred: boolean
  dragOccurredRef: RefObject<boolean>
  enableLongPressContextMenuRef: RefObject<boolean>
  fin: (n: number, fallback: number) => number
  finishCssCameraTransform: (commitLiveTransform: boolean) => void
  getElementIdAtClientPoint: (clientX: number, clientY: number) => string | null
  handleMouseUp: (event?: KonvaEventObject<MouseEvent>) => void
  handleTouchEndRef: RefObject<(event?: CanvasTouchEvent) => void>
  handleTouchMoveRef: RefObject<(event: CanvasTouchEvent) => void>
  ignoreNextTapClearRef: RefObject<boolean>
  isLongPressFingerAtOrigin: (clientX?: number, clientY?: number, forComplete?: boolean) => boolean
  isSelecting: boolean
  lastProcessedTouchEndRef: RefObject<{
    identifier: number; clientX: number; clientY: number; timeStamp: number
  } | null>
  lastSingleTouchRef: RefObject<Point | null>
  lastTapRef: RefObject<{ time: number; clientX: number; clientY: number; elementId: string | null } | null>
  longPressRef: RefObject<LongPressGestureState>
  longPressDragSelectFromContentRef: RefObject<boolean>
  longPressDuplicateDragRef: RefObject<BaseCanvasProps['longPressDuplicateDrag']>
  maybeCancelLongPressForMovement: (clientX: number, clientY: number) => void
  minZoomRef: RefObject<number>
  multiFingerSwipeRef: RefObject<{
    active: boolean; fingerCount: number; startCenter: Point; lastCenter: Point
  } | null>
  openContextMenuAtClientPoint: (clientX: number, clientY: number) => boolean
  panRef: RefObject<Point>
  pushLiveCameraToStore: (force: boolean) => void
  rectSelectActiveRef: RefObject<boolean>
  resetCanvasTouchGestureForContextMenu: () => void
  safePan: Point
  safeZoom: number
  scheduleCameraSync: () => void
  scheduleMousePanDraw: () => void
  schedulePendingTouchSelectionClear: () => void
  scheduleSelectionDragFrame: () => void
  selectionDragRafRef: RefObject<number | null>
  selectionRect: CanvasSelectionRectangle | null
  selectionRectLiveRef: RefObject<CanvasSelectionRectangle | null>
  setCameraGestureHitTestingDisabled: (disabled: boolean) => void
  setContextMenu: Dispatch<SetStateAction<CanvasContextMenu>>
  setDragOccurred: Dispatch<SetStateAction<boolean>>
  setIsSelecting: Dispatch<SetStateAction<boolean>>
  setLongPressIndicator: Dispatch<SetStateAction<{ phase: 'filling' | 'dismissing'; position: Point } | null>>
  setSelection: ReturnType<typeof useCommitSelection>
  setSelectionRect: Dispatch<SetStateAction<CanvasSelectionRectangle | null>>
  setTouchFingerPanForUI: Dispatch<SetStateAction<boolean>>
  setTouchHasMoved: Dispatch<SetStateAction<boolean>>
  setTouchPanInitialCanvasPan: Dispatch<SetStateAction<Point | null>>
  setTouchPanStart: Dispatch<SetStateAction<Point | null>>
  setTouchStartCenter: Dispatch<SetStateAction<Point | null>>
  setTouchStartDistance: Dispatch<SetStateAction<number | null>>
  setTouchStartPan: Dispatch<SetStateAction<Point>>
  setTouchStartZoom: Dispatch<SetStateAction<number>>
  shouldLongPressBlockSingleFingerPan: () => boolean
  stageRef: RefObject<Konva.Stage | null>
  startLongPressDragSelection: (screenPos: Point) => boolean
  startLongPressTouchWatch: () => void
  stopLongPressTouchWatch: () => void
  suppressSyntheticMouseAfterTouch: (durationMs?: number) => void
  suppressTouchContextMenuUntilRef: RefObject<number>
  touchHasMoved: boolean
  touchPanInitialCanvasPan: Point | null
  touchPanInitialCanvasPanRef: RefObject<Point | null>
  touchPanStart: Point | null
  touchPanStartRef: RefObject<Point | null>
  touchPanWindowCleanupRef: RefObject<(() => void) | null>
  touchSingleFingerPanActiveRef: RefObject<boolean>
  touchStartCenter: Point | null
  touchStartDistance: number | null
  touchStartElementIdRef: RefObject<string | null>
  touchStartPan: Point
  touchStartZoom: number
  touchStartedOnContentRef: RefObject<boolean>
  touchStartedOnDraggableRef: RefObject<boolean>
  viewportUI: ReturnType<typeof useViewportUIApi>
  zoomRef: RefObject<number>
}

export function useBaseCanvasTouchGestures({
  activateLongPressReady,
  applyCssCameraTransform,
  beginCssCameraTransform,
  cameraGestureActiveRef,
  cameraSyncTimeoutRef,
  cancelLongPress,
  cancelPendingTouchSelectionClear,
  clearPreviewSelection,
  containerRef,
  contentLayerRef,
  contextMenu,
  cssCameraTransformRef,
  dismissLongPressIndicator,
  dragOccurred,
  dragOccurredRef,
  enableLongPressContextMenu,
  enableLongPressContextMenuRef,
  enableSingleFingerPan,
  fin,
  finishCssCameraTransform,
  getElementIdAtClientPoint,
  handleMouseUp,
  handleTouchEndRef,
  handleTouchMoveRef,
  ignoreNextTapClearRef,
  isLongPressFingerAtOrigin,
  isSelecting,
  lastProcessedTouchEndRef,
  lastSingleTouchRef,
  lastTapRef,
  longPressRef,
  longPressDragSelectFromContentRef,
  longPressDuplicateDragRef,
  maybeCancelLongPressForMovement,
  minZoomRef,
  multiFingerSwipeRef,
  onFindElementsInRectangle,
  onMultiFingerSwipe,
  openContextMenuAtClientPoint,
  pan,
  panRef,
  prioritizeNavigation,
  pushLiveCameraToStore,
  rectSelectActiveRef,
  resetCanvasTouchGestureForContextMenu,
  safePan,
  safeZoom,
  scheduleCameraSync,
  scheduleMousePanDraw,
  schedulePendingTouchSelectionClear,
  scheduleSelectionDragFrame,
  selectionDragRafRef,
  selectionRect,
  selectionRectLiveRef,
  setCameraGestureHitTestingDisabled,
  setContextMenu,
  setDragOccurred,
  setIsSelecting,
  setLongPressIndicator,
  setSelection,
  setSelectionRect,
  setTouchFingerPanForUI,
  setTouchHasMoved,
  setTouchPanInitialCanvasPan,
  setTouchPanStart,
  setTouchStartCenter,
  setTouchStartDistance,
  setTouchStartPan,
  setTouchStartZoom,
  shouldLongPressBlockSingleFingerPan,
  stageRef,
  startLongPressDragSelection,
  startLongPressTouchWatch,
  stopLongPressTouchWatch,
  suppressSyntheticMouseAfterTouch,
  suppressTouchContextMenuUntilRef,
  touchHasMoved,
  touchPanInitialCanvasPan,
  touchPanInitialCanvasPanRef,
  touchPanStart,
  touchPanStartRef,
  touchPanWindowCleanupRef,
  touchSingleFingerPanActiveRef,
  touchStartCenter,
  touchStartDistance,
  touchStartElementIdRef,
  touchStartPan,
  touchStartZoom,
  touchStartedOnContentRef,
  touchStartedOnDraggableRef,
  viewportUI,
  zoom,
  zoomRef,
}: BaseCanvasTouchGesturesOptions) {
  const window = useCanvasWindow()
  // Helper to calculate distance between two touch points
  const getTouchDistance = useCallback((touch1: React.Touch, touch2: React.Touch) => {
    const dx = touch1.clientX - touch2.clientX
    const dy = touch1.clientY - touch2.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }, [])

  // Helper to calculate center point between two touches
  const getTouchCenter = useCallback((touch1: React.Touch, touch2: React.Touch) => {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2,
    }
  }, [])

  // Centroid of N touches (for 3/4-finger swipe)
  const getTouchCentroid = useCallback((touches: React.TouchList | TouchList): Point => {
    let x = 0
    let y = 0
    const n = touches.length
    for (let i = 0; i < n; i++) {
      const t = touches[i]
      if (t) {
        x += t.clientX
        y += t.clientY
      }
    }
    return { x: n ? x / n : 0, y: n ? y / n : 0 }
  }, [])

  const MULTI_FINGER_SWIPE_THRESHOLD = 50

  // Handle touch start
  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (isAppDialogOpen()) return
      if (contextMenu) {
        const target = e.target
        const isInsideContextMenu =
          target instanceof Element && target.closest('[data-canvas-context-menu="true"]')
        if (shouldIgnoreCanvasTouchForContextMenu(true, !!isInsideContextMenu)) {
          resetCanvasTouchGestureForContextMenu()
          return
        }
        if (!isInsideContextMenu) {
          setContextMenu(null)
          resetCanvasTouchGestureForContextMenu()
          ignoreNextTapClearRef.current = true
          return
        }
      }
      debugTouchLog('handleTouchStart', {
        touches: e.touches.length,
        changedTouches: e.changedTouches.length,
      })
      if (e.touches.length >= 3) {
        // 3- or 4-finger gesture - track for swipe (e.g. view switch on iPad)
        e.preventDefault()
        e.stopPropagation()
        lastTapRef.current = null
        touchStartElementIdRef.current = null
        touchStartedOnContentRef.current = false
        cancelLongPress()
        setCameraGestureHitTestingDisabled(true)
        setTouchPanStart(null)
        setTouchPanInitialCanvasPan(null)
        touchPanStartRef.current = null
        touchPanInitialCanvasPanRef.current = null
        setTouchStartDistance(null)
        setTouchStartCenter(null)
        const center = getTouchCentroid(e.touches)
        multiFingerSwipeRef.current = {
          active: true,
          fingerCount: e.touches.length,
          startCenter: center,
          lastCenter: center,
        }
      } else if (e.touches.length === 2) {
        // Two-finger gesture - prepare for pinch zoom or pan
        e.preventDefault()
        e.stopPropagation()
        lastTapRef.current = null
        touchStartElementIdRef.current = null
        touchStartedOnContentRef.current = false
        cancelLongPress()
        setCameraGestureHitTestingDisabled(true)
        const touch1 = e.touches[0]
        const touch2 = e.touches[1]
        if (!touch1 || !touch2 || !containerRef.current) return

        // Cancel any single-finger pan
        setTouchPanStart(null)
        setTouchPanInitialCanvasPan(null)
        touchPanStartRef.current = null
        touchPanInitialCanvasPanRef.current = null
        setTouchHasMoved(false)

        // Get container offset to convert viewport coords to container-relative coords
        const rect = containerRef.current.getBoundingClientRect()

        const touchDistance = getTouchDistance(touch1, touch2)
        const viewportCenter = getTouchCenter(touch1, touch2)

        // Convert viewport coordinates to container-relative coordinates
        const center = {
          x: viewportCenter.x - rect.left,
          y: viewportCenter.y - rect.top,
        }

        setTouchStartDistance(touchDistance)
        const layer = contentLayerRef.current
        const startZoom = layer ? layer.scaleX() || safeZoom : zoom
        const startPan: Point = layer ? { x: layer.x(), y: layer.y() } : { x: pan.x, y: pan.y }
        setTouchStartZoom(startZoom)
        setTouchStartPan(startPan)
        setTouchStartCenter(center)
        beginCssCameraTransform(startPan, startZoom)
      } else if (e.touches.length === 1) {
        suppressTouchContextMenuUntilRef.current = Date.now() + 2000
        // Single-finger touch - might become pan, tap, or node drag (e.g. panel module)
        const touch = e.touches[0]
        if (!touch) return
        suppressSyntheticMouseAfterTouch()
        // Drop marquee left over from synthetic mouse (e.g. wall draw on iOS) before touch handlers run.
        if (
          rectSelectActiveRef.current &&
          longPressRef.current.phase !== 'ready' &&
          longPressRef.current.action !== 'duplicate-drag'
        ) {
          if (selectionDragRafRef.current != null) {
            window.cancelAnimationFrame(selectionDragRafRef.current)
            selectionDragRafRef.current = null
          }
          rectSelectActiveRef.current = false
          setIsSelecting(false)
          selectionRectLiveRef.current = null
          clearPreviewSelection()
          setSelectionRect(null)
        }
        dismissCanvasOverlays()
        debugTouchLog('handleTouchStart one-finger', {
          clientX: touch.clientX,
          clientY: touch.clientY,
        })

        // Hit-test: if touch started on a draggable (e.g. panel module), don't use this gesture for canvas pan
        touchStartedOnDraggableRef.current = false
        touchStartedOnContentRef.current = false
        const rect = containerRef.current?.getBoundingClientRect()
        const stage = stageRef.current
        if (rect && stage) {
          const node = stage.getIntersection({
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top,
          })
          touchStartElementIdRef.current = node ? resolveKonvaElementId(node, stage) : null
          touchStartedOnContentRef.current = !!node
          if (
            node &&
            !prioritizeNavigation &&
            isNodeDraggableForTouch(node, stage, viewportUI.getState().selection)
          ) {
            touchStartedOnDraggableRef.current = true
          }
        } else {
          touchStartElementIdRef.current = null
          touchStartedOnContentRef.current = false
        }

        // Store initial touch position and canvas state (if single-finger pan is enabled and not on draggable)
        if (enableSingleFingerPan && !touchStartedOnDraggableRef.current) {
          if (touchPanWindowCleanupRef.current) {
            touchPanWindowCleanupRef.current()
            touchPanWindowCleanupRef.current = null
          }
          touchSingleFingerPanActiveRef.current = false
          setTouchFingerPanForUI(false)
          const startTouch = { x: touch.clientX, y: touch.clientY }
          setTouchPanStart(startTouch)
          touchPanStartRef.current = startTouch
          const layer = contentLayerRef.current
          const startPan: Point = layer ? { x: layer.x(), y: layer.y() } : { x: pan.x, y: pan.y }
          setTouchPanInitialCanvasPan(startPan)
          touchPanInitialCanvasPanRef.current = startPan
          setTouchHasMoved(false)

          const handleWindowTouchMove = (evt: TouchEvent) => {
            handleTouchMoveRef.current(evt)
          }
          const handleWindowTouchEnd = (evt: TouchEvent) => {
            handleTouchEndRef.current(evt)
          }
          window.addEventListener('touchmove', handleWindowTouchMove, {
            capture: true,
            passive: false,
          })
          window.addEventListener('touchend', handleWindowTouchEnd, true)
          window.addEventListener('touchcancel', handleWindowTouchEnd, true)
          touchPanWindowCleanupRef.current = () => {
            window.removeEventListener('touchmove', handleWindowTouchMove, true)
            window.removeEventListener('touchend', handleWindowTouchEnd, true)
            window.removeEventListener('touchcancel', handleWindowTouchEnd, true)
          }
        } else {
          setTouchPanStart(null)
          setTouchPanInitialCanvasPan(null)
          touchPanStartRef.current = null
          touchPanInitialCanvasPanRef.current = null
          setTouchHasMoved(false)
        }

        const duplicateDragOnTouch = longPressDuplicateDragRef.current
        const potentialSecondTap = isPotentialSecondTap(
          lastTapRef.current,
          {
            time: performance.now(),
            clientX: touch.clientX,
            clientY: touch.clientY,
            elementId: touchStartElementIdRef.current,
          },
          DOUBLE_TAP_MS,
          DOUBLE_TAP_SLOP_PX
        )
        const shouldScheduleLongPress = shouldScheduleTouchLongPress({
          enabled: enableLongPressContextMenuRef.current,
          startedOnDraggable: touchStartedOnDraggableRef.current,
          hasDuplicateDrag: !!duplicateDragOnTouch,
          dragSelectFromContent: longPressDragSelectFromContentRef.current,
          potentialSecondTap,
        })

        if (shouldScheduleLongPress) {
          cancelLongPress()
          lastSingleTouchRef.current = { x: touch.clientX, y: touch.clientY }
          longPressRef.current.origin = { x: touch.clientX, y: touch.clientY }
          longPressRef.current.phase = 'filling'
          longPressRef.current.screenPos = { x: touch.clientX, y: touch.clientY }
          longPressRef.current.startedOnDraggable = touchStartedOnDraggableRef.current
          longPressRef.current.startedAt = performance.now()
          setLongPressIndicator({
            phase: 'filling',
            position: { x: touch.clientX, y: touch.clientY },
          })
          startLongPressTouchWatch()
          const touchX = touch.clientX
          const touchY = touch.clientY
          debugTouchLog('longPress schedule delayTimer', {
            touchX,
            touchY,
            delayMs: LONG_PRESS_DELAY_MS,
            readyAfterMs: LONG_PRESS_READY_MS,
          })
          longPressRef.current.delayTimer = setTimeout(() => {
            longPressRef.current.delayTimer = null
            if (cameraGestureActiveRef.current) {
              debugTouchLog('longPress delayTimer ignored: camera gesture active', {
                elapsedMs: Math.round(performance.now() - longPressRef.current.startedAt),
              })
              return
            }
            if (!isLongPressFingerAtOrigin(undefined, undefined, true)) {
              debugTouchLog('longPress delayTimer cancelling: finger moved', {
                elapsedMs: Math.round(performance.now() - longPressRef.current.startedAt),
                origin: longPressRef.current.origin,
                last: lastSingleTouchRef.current,
              })
              cancelLongPress()
              return
            }
            const pos = longPressRef.current.screenPos ?? { x: touchX, y: touchY }
            debugTouchLog('longPress delayTimer fired -> filling', {
              pos,
              elapsedMs: Math.round(performance.now() - longPressRef.current.startedAt),
            })

            // Resolve element while Konva is still listening (for selection)
            const rect = containerRef.current?.getBoundingClientRect()
            const stage = stageRef.current
            if (rect && stage) {
              const node = stage.getIntersection({
                x: touchX - rect.left,
                y: touchY - rect.top,
              })
              if (node) {
                const id = resolveKonvaElementId(node, stage)
                longPressRef.current.elementId = id
                // Infer selection type from node name prefixes
                const resolveTypeFromNode = (n: Konva.Node): Selection['type'] | null => {
                  const name = n.name()
                  if (!name) return null
                  if (name.startsWith('endpoint-')) return 'endpoint'
                  if (name.startsWith('protection-')) return 'protection'
                  if (name.startsWith('panel-')) return 'panel'
                  if (name.startsWith('supplyPanel-')) return 'supplyPanel'
                  if (name.startsWith('trunkDevice-') || name.startsWith('panelModule-'))
                    return 'trunkDevice'
                  if (name === 'ground-ground') return 'ground'
                  return null
                }
                let t = resolveTypeFromNode(node)
                let parent = node.getParent()
                let depth = 0
                while (!t && parent && parent !== stage && depth < 10) {
                  t = resolveTypeFromNode(parent)
                  parent = parent.getParent()
                  depth++
                }
                if (
                  longPressTargetIsSelectionBackground(
                    t,
                    longPressDragSelectFromContentRef.current
                  )
                ) {
                  longPressRef.current.elementId = null
                  longPressRef.current.elementType = null
                } else {
                  longPressRef.current.elementType = t
                }
                debugTouchLog('longPress resolved element', {
                  elementId: id,
                  elementType: t,
                })
              } else {
                longPressRef.current.elementId = null
                longPressRef.current.elementType = null
                debugTouchLog('longPress no element under finger')
              }
            }

            // Do NOT disable listening here: keep Konva listening so a quick release
            // still fires tap/selection. We only disable when the ring has filled ('ready').

            longPressRef.current.readyTimer = setTimeout(() => {
              longPressRef.current.readyTimer = null
              if (cameraGestureActiveRef.current) {
                debugTouchLog('longPress readyTimer ignored: camera gesture active', {
                  elapsedMs: Math.round(performance.now() - longPressRef.current.startedAt),
                })
                return
              }
              if (!isLongPressFingerAtOrigin(undefined, undefined, true)) {
                debugTouchLog('longPress readyTimer cancelling: finger moved', {
                  elapsedMs: Math.round(performance.now() - longPressRef.current.startedAt),
                  origin: longPressRef.current.origin,
                  last: lastSingleTouchRef.current,
                })
                cancelLongPress()
                return
              }
              const readyAt = lastSingleTouchRef.current ?? pos
              longPressRef.current.phase = 'ready'
              longPressRef.current.screenPos = readyAt
              dismissLongPressIndicator(readyAt)
              debugTouchLog('longPress readyTimer fired -> ready', {
                screenPos: readyAt,
                elementId: longPressRef.current.elementId,
                elementType: longPressRef.current.elementType,
                elapsedMs: Math.round(performance.now() - longPressRef.current.startedAt),
              })

              const duplicateDrag = longPressDuplicateDragRef.current
              const lpElementId = longPressRef.current.elementId
              const lpElementType = longPressRef.current.elementType
              if (
                duplicateDrag &&
                lpElementId &&
                lpElementType &&
                duplicateDrag.elementTypes.includes(lpElementType)
              ) {
                longPressRef.current.action = 'duplicate-drag'
                stopLongPressTouchWatch()
                duplicateDrag.onStart({
                  elementId: lpElementId,
                  elementType: lpElementType,
                  clientX: readyAt.x,
                  clientY: readyAt.y,
                })
                suppressNextCanvasElementTap(window)
                debugTouchLog('longPress ready -> duplicate-drag', {
                  elementId: lpElementId,
                  elementType: lpElementType,
                })
                return
              }

              if (
                longPressRef.current.screenPos &&
                (longPressDragSelectFromContentRef.current ||
                  !longPressRef.current.elementId)
              ) {
                startLongPressDragSelection(longPressRef.current.screenPos)
              }
            }, LONG_PRESS_FILL_MS)
          }, LONG_PRESS_DELAY_MS)
        }
      }
    },
    [
      zoom,
      pan,
      getTouchDistance,
      getTouchCenter,
      getTouchCentroid,
      cancelLongPress,
      clearPreviewSelection,
      enableSingleFingerPan,
      prioritizeNavigation,
      isLongPressFingerAtOrigin,
      setCameraGestureHitTestingDisabled,
      safeZoom,
      contextMenu,
      resetCanvasTouchGestureForContextMenu,
      startLongPressTouchWatch,
      stopLongPressTouchWatch,
      dismissLongPressIndicator,
      suppressSyntheticMouseAfterTouch,
      beginCssCameraTransform,
      startLongPressDragSelection,
      window,
      viewportUI,
      setContextMenu,
      ignoreNextTapClearRef,
      lastTapRef,
      touchStartElementIdRef,
      touchStartedOnContentRef,
      setTouchPanStart,
      setTouchPanInitialCanvasPan,
      touchPanStartRef,
      touchPanInitialCanvasPanRef,
      setTouchStartDistance,
      setTouchStartCenter,
      multiFingerSwipeRef,
      containerRef,
      setTouchHasMoved,
      contentLayerRef,
      setTouchStartZoom,
      setTouchStartPan,
      suppressTouchContextMenuUntilRef,
      rectSelectActiveRef,
      longPressRef,
      touchStartedOnDraggableRef,
      stageRef,
      longPressDuplicateDragRef,
      enableLongPressContextMenuRef,
      longPressDragSelectFromContentRef,
      selectionDragRafRef,
      setIsSelecting,
      selectionRectLiveRef,
      setSelectionRect,
      touchPanWindowCleanupRef,
      touchSingleFingerPanActiveRef,
      setTouchFingerPanForUI,
      handleTouchMoveRef,
      handleTouchEndRef,
      lastSingleTouchRef,
      setLongPressIndicator,
      cameraGestureActiveRef,
    ]
  )

  // Handle touch move
  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement> | TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0]
        if (touch) {
          lastSingleTouchRef.current = { x: touch.clientX, y: touch.clientY }
          maybeCancelLongPressForMovement(touch.clientX, touch.clientY)
          activateLongPressReady(touch.clientX, touch.clientY)
        }
      }

      if (e.touches.length >= 2 && !cameraGestureActiveRef.current) {
        setCameraGestureHitTestingDisabled(true)
      }
      if (e.touches.length >= 3 && multiFingerSwipeRef.current?.active) {
        e.preventDefault()
        e.stopPropagation()
        multiFingerSwipeRef.current.lastCenter = getTouchCentroid(e.touches)
      } else if (
        e.touches.length === 2 &&
        touchStartDistance !== null &&
        touchStartCenter !== null
      ) {
        // Two-finger gesture - pinch zoom and pan
        e.preventDefault()
        e.stopPropagation()
        const touch1 = e.touches[0]
        const touch2 = e.touches[1]
        if (!touch1 || !touch2 || !containerRef.current) return

        // Get container offset to convert viewport coords to container-relative coords
        const rect = containerRef.current.getBoundingClientRect()

        const currentDistance = getTouchDistance(touch1, touch2)
        const viewportCenter = getTouchCenter(touch1, touch2)

        // Convert viewport coordinates to container-relative coordinates
        const currentCenter = {
          x: viewportCenter.x - rect.left,
          y: viewportCenter.y - rect.top,
        }

        // Calculate zoom based on pinch distance change
        const scale = currentDistance / touchStartDistance

        // Add damping to reduce shakiness - only zoom if change is significant
        const zoomThreshold = 0.03 // 5% change threshold
        if (Math.abs(scale - 1.0) < zoomThreshold) {
          // Distance change is too small, just do pan without zoom
          const deltaX = currentCenter.x - touchStartCenter.x
          const deltaY = currentCenter.y - touchStartCenter.y

          const layer = contentLayerRef.current
          if (layer) {
            const nextPan: Point = {
              x: fin(touchStartPan.x + deltaX, safePan.x),
              y: fin(touchStartPan.y + deltaY, safePan.y),
            }
            if (!applyCssCameraTransform(nextPan, touchStartZoom)) {
              layer.x(nextPan.x)
              layer.y(nextPan.y)
              scheduleMousePanDraw()
            }
            panRef.current = nextPan
            if (!cssCameraTransformRef.current.active) scheduleCameraSync()
          }
          return
        }

        const newZoom = clamp(touchStartZoom * scale, minZoomRef.current, ZOOM_MAX)

        // Zoom towards the INITIAL gesture center point (more natural feeling)
        // Convert initial touch center to world coordinates
        const worldPointX = (touchStartCenter.x - touchStartPan.x) / touchStartZoom
        const worldPointY = (touchStartCenter.y - touchStartPan.y) / touchStartZoom

        // Calculate new pan to keep that world point under the CURRENT gesture center
        // This allows both zooming and panning simultaneously
        const newPan = {
          x: currentCenter.x - worldPointX * newZoom,
          y: currentCenter.y - worldPointY * newZoom,
        }

        const layer = contentLayerRef.current
        if (layer) {
          const clampedZoom = Math.max(minZoomRef.current, Math.min(ZOOM_MAX, fin(newZoom, safeZoom)))
          const clampedPan: Point = {
            x: fin(newPan.x, safePan.x),
            y: fin(newPan.y, safePan.y),
          }
          if (!applyCssCameraTransform(clampedPan, clampedZoom)) {
            layer.x(clampedPan.x)
            layer.y(clampedPan.y)
            layer.scale({
              x: clampedZoom,
              y: clampedZoom,
            })
            scheduleMousePanDraw()
          }
          panRef.current = clampedPan
          zoomRef.current = clampedZoom
          if (!cssCameraTransformRef.current.active) scheduleCameraSync()
        }
      } else if (
        rectSelectActiveRef.current &&
        selectionRectLiveRef.current &&
        e.touches.length === 1 &&
        onFindElementsInRectangle
      ) {
        // Update selection rectangle for touch-based drag-select (started via long-press on empty space)
        const touch = e.touches[0]
        if (!touch) return
        const rect = containerRef.current?.getBoundingClientRect()
        const stage = stageRef.current
        if (!rect || !stage) return
        const pointerStageX = touch.clientX - rect.left
        const pointerStageY = touch.clientY - rect.top
        const base = selectionRectLiveRef.current
        selectionRectLiveRef.current = {
          ...base,
          endX: pointerStageX,
          endY: pointerStageY,
        }
        const w = Math.abs(selectionRectLiveRef.current.endX - selectionRectLiveRef.current.startX)
        const h = Math.abs(selectionRectLiveRef.current.endY - selectionRectLiveRef.current.startY)
        if (w > 5 || h > 5) {
          dragOccurredRef.current = true
        }
        scheduleSelectionDragFrame()
      } else if (
        enableSingleFingerPan &&
        e.touches.length === 1 &&
        (touchPanStartRef.current ?? touchPanStart) &&
        (touchPanInitialCanvasPanRef.current ?? touchPanInitialCanvasPan) &&
        !touchStartedOnDraggableRef.current &&
        !shouldLongPressBlockSingleFingerPan()
      ) {
        // Single-finger touch - check if it's a drag (moved beyond threshold). Skip when touch started on a draggable (e.g. panel module).
        const touch = e.touches[0]
        if (!touch) return

        const panStart = touchPanStartRef.current ?? touchPanStart
        const initialPan = touchPanInitialCanvasPanRef.current ?? touchPanInitialCanvasPan
        if (!panStart || !initialPan) return
        const dx = touch.clientX - panStart.x
        const dy = touch.clientY - panStart.y
        const tapDistance = Math.sqrt(dx * dx + dy * dy)

        // Threshold for distinguishing tap from drag (10px)
        const dragThreshold = 10

        if (tapDistance > dragThreshold) {
          // This is a drag, not a tap
          e.preventDefault()
          e.stopPropagation()

          if (!dragOccurredRef.current) {
            dragOccurredRef.current = true
            if (stageRef.current) {
              stageRef.current.listening(false)
            }
          }
          const layer = contentLayerRef.current
          if (
            shouldActivateSingleFingerPan(
              tapDistance,
              dragThreshold,
              touchSingleFingerPanActiveRef.current
            )
          ) {
            touchSingleFingerPanActiveRef.current = true
            if (layer) {
              beginCssCameraTransform(initialPan, layer.scaleX() || safeZoom)
            }
          }

          // Move the existing canvas bitmap via the compositor. The Konva camera is
          // committed once on touch end instead of redrawing the scene every move.
          if (layer) {
            const nextPan: Point = {
              x: fin(initialPan.x + dx, safePan.x),
              y: fin(initialPan.y + dy, safePan.y),
            }
            if (!applyCssCameraTransform(nextPan, layer.scaleX() || safeZoom)) {
              layer.x(nextPan.x)
              layer.y(nextPan.y)
              scheduleMousePanDraw()
            }
            panRef.current = nextPan
            if (!cssCameraTransformRef.current.active) scheduleCameraSync()
          }
          debugTouchLog('handleTouchMove single-finger pan', {
            dx,
            dy,
            distance: tapDistance,
          })
        }
      }
    },
    [
      touchStartDistance,
      touchStartZoom,
      touchStartPan,
      touchStartCenter,
      touchPanStart,
      touchPanInitialCanvasPan,
      getTouchDistance,
      getTouchCenter,
      getTouchCentroid,
      activateLongPressReady,
      maybeCancelLongPressForMovement,
      safePan,
      safeZoom,
      enableSingleFingerPan,
      setCameraGestureHitTestingDisabled,
      scheduleCameraSync,
      scheduleSelectionDragFrame,
      scheduleMousePanDraw,
      fin,
      onFindElementsInRectangle,
      applyCssCameraTransform,
      beginCssCameraTransform,
      shouldLongPressBlockSingleFingerPan,
      cameraGestureActiveRef,
      multiFingerSwipeRef,
      rectSelectActiveRef,
      selectionRectLiveRef,
      touchPanStartRef,
      touchPanInitialCanvasPanRef,
      touchStartedOnDraggableRef,
      lastSingleTouchRef,
      containerRef,
      minZoomRef,
      contentLayerRef,
      panRef,
      cssCameraTransformRef,
      zoomRef,
      stageRef,
      dragOccurredRef,
      touchSingleFingerPanActiveRef,
    ]
  )

  // Handle touch end
  const handleTouchEnd = useCallback(
    (e?: React.TouchEvent<HTMLDivElement> | TouchEvent) => {
      suppressSyntheticMouseAfterTouch()
      debugTouchLog('handleTouchEnd start', {
        hasEvent: !!e,
        changedTouches: e?.changedTouches.length,
        touches: e?.touches.length,
        dragOccurred,
        touchHasMoved,
        dragOccurredRef: dragOccurredRef.current,
        longPressPhase: longPressRef.current.phase,
        longPressScreenPos: longPressRef.current.screenPos,
        longPressElementId: longPressRef.current.elementId,
        longPressElementType: longPressRef.current.elementType,
        longPressElapsedMs: longPressRef.current.startedAt
          ? Math.round(performance.now() - longPressRef.current.startedAt)
          : null,
        hasLongPressDelayTimer: longPressRef.current.delayTimer != null,
        hasLongPressReadyTimer: longPressRef.current.readyTimer != null,
        isSelecting,
        hasSelectionRect: !!selectionRect,
      })
      // 3/4-finger swipe: resolve direction and notify (touches may be empty here)
      const mf = multiFingerSwipeRef.current
      if (mf?.active && onMultiFingerSwipe) {
        const dx = mf.lastCenter.x - mf.startCenter.x
        const dy = mf.lastCenter.y - mf.startCenter.y
        const adx = Math.abs(dx)
        const ady = Math.abs(dy)
        if (adx >= MULTI_FINGER_SWIPE_THRESHOLD || ady >= MULTI_FINGER_SWIPE_THRESHOLD) {
          const direction: 'left' | 'right' | 'up' | 'down' =
            adx >= ady ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
          onMultiFingerSwipe(direction, mf.fingerCount, mf.startCenter.x)
        }
      }
      if (mf?.active) {
        multiFingerSwipeRef.current = null
        ignoreNextTapClearRef.current = true
      }
      if (touchPanWindowCleanupRef.current) {
        touchPanWindowCleanupRef.current()
        touchPanWindowCleanupRef.current = null
      }

      if (cameraGestureActiveRef.current) {
        cancelPendingTouchSelectionClear()
        ignoreNextTapClearRef.current = true
        cancelLongPress()
        touchStartedOnDraggableRef.current = false
        touchStartElementIdRef.current = null
        touchStartedOnContentRef.current = false
        if (cameraSyncTimeoutRef.current != null) {
          clearTimeout(cameraSyncTimeoutRef.current)
          cameraSyncTimeoutRef.current = null
        }
        finishCssCameraTransform(true)
        pushLiveCameraToStore(true)
        setTouchStartDistance(null)
        setTouchStartCenter(null)
        setTouchPanStart(null)
        setTouchPanInitialCanvasPan(null)
        touchPanStartRef.current = null
        touchPanInitialCanvasPanRef.current = null
        setTouchHasMoved(false)
        setDragOccurred(false)
        dragOccurredRef.current = false
        touchSingleFingerPanActiveRef.current = false
        setTouchFingerPanForUI(false)
        setTimeout(() => {
          setCameraGestureHitTestingDisabled(false)
        }, 50)
        debugTouchLog('handleTouchEnd early return: cameraGestureActive')
        return
      }

      if (
        longPressRef.current.action === 'duplicate-drag' &&
        longPressRef.current.phase === 'ready'
      ) {
        debugTouchLog('handleTouchEnd long-press duplicate-drag complete')
        cancelLongPress()
        cancelPendingTouchSelectionClear()
        touchStartedOnDraggableRef.current = false
        touchStartElementIdRef.current = null
        touchStartedOnContentRef.current = false
        setTouchStartDistance(null)
        setTouchStartCenter(null)
        setTouchPanStart(null)
        setTouchPanInitialCanvasPan(null)
        touchPanStartRef.current = null
        touchPanInitialCanvasPanRef.current = null
        setTouchHasMoved(false)
        return
      }

      // Long-press behavior: if the ring filled completely on an element, toggle selection for that element.
      // Empty-space long-press starts drag-rect in the ready timer and is finalized by the generic drag-rect branch below.
      if (
        enableLongPressContextMenu &&
        longPressRef.current.phase === 'ready' &&
        longPressRef.current.action !== 'drag-select' &&
        longPressRef.current.screenPos &&
        longPressRef.current.elementId &&
        longPressRef.current.elementType
      ) {
        const elementId = longPressRef.current.elementId
        const elementType = longPressRef.current.elementType

        // Toggle element in selection
        const currentSel = viewportUI.getState().selection
        const isSameType = currentSel.type === elementType
        const alreadySelected = isSameType && currentSel.ids.includes(elementId)

        if (alreadySelected) {
          const remainingIds = currentSel.ids.filter((id) => id !== elementId)
          if (remainingIds.length === 0) {
            viewportUI.getState().clearSelection()
          } else {
            setSelection({ ...currentSel, ids: remainingIds })
          }
        } else {
          const nextIds = isSameType ? [...currentSel.ids, elementId] : [elementId]
          setSelection(selectMultiple(elementType, nextIds))
        }
        debugTouchLog('handleTouchEnd long-press toggle selection', {
          elementId,
          elementType,
          selectionBefore: currentSel,
          selectionAfter: viewportUI.getState().selection,
        })

        // Suppress the synthetic element tap/click that Konva emits after touchend,
        // so it doesn't immediately overwrite this long-press-driven selection.
        suppressNextCanvasElementTap(window)

        cancelLongPress()
        cancelPendingTouchSelectionClear()
        touchStartedOnDraggableRef.current = false
        touchStartElementIdRef.current = null
        touchStartedOnContentRef.current = false

        setTouchStartDistance(null)
        setTouchStartCenter(null)
        setTouchPanStart(null)
        setTouchPanInitialCanvasPan(null)
        touchPanStartRef.current = null
        touchPanInitialCanvasPanRef.current = null
        setTouchHasMoved(false)
        return
      }
      cancelLongPress()
      touchStartedOnDraggableRef.current = false
      const touchStartElementId = touchStartElementIdRef.current
      const touchStartedOnContent = touchStartedOnContentRef.current
      touchStartElementIdRef.current = null
      touchStartedOnContentRef.current = false

      if (touchSingleFingerPanActiveRef.current) {
        touchSingleFingerPanActiveRef.current = false
        if (cameraSyncTimeoutRef.current != null) {
          clearTimeout(cameraSyncTimeoutRef.current)
          cameraSyncTimeoutRef.current = null
        }
        finishCssCameraTransform(true)
        pushLiveCameraToStore(true)
      }

      setTouchStartDistance(null)
      setTouchStartCenter(null)
      setTouchPanStart(null)
      setTouchPanInitialCanvasPan(null)
      touchPanStartRef.current = null
      touchPanInitialCanvasPanRef.current = null

      // If a touch-based drag-rect is active, finalize selection using the existing mouse-up logic.
      if (
        rectSelectActiveRef.current &&
        (selectionRectLiveRef.current ?? selectionRect) &&
        onFindElementsInRectangle
      ) {
        debugTouchLog('handleTouchEnd finalize drag-rect selection', {
          selectionRect: selectionRectLiveRef.current ?? selectionRect,
        })
        cancelPendingTouchSelectionClear()
        dragOccurredRef.current = true
        handleMouseUp()
        return
      }

      const gestureWasDragOrPan =
        dragOccurred || touchHasMoved || dragOccurredRef.current

      if (gestureWasDragOrPan) {
        // Drag or pan consumed this gesture – don't treat as tap/double-tap.
        setTimeout(() => {
          setDragOccurred(false)
          setTouchHasMoved(false)
          dragOccurredRef.current = false
          if (stageRef.current) {
            stageRef.current.listening(true)
          }
        }, 100)
      } else {
        setTouchHasMoved(false)

        // Double-tap / single-tap detection (only when gesture was not a drag/pan/long-press).
        if (e?.changedTouches && e.changedTouches.length === 1 && !cameraGestureActiveRef.current) {
          const t = e.changedTouches[0]
          if (t) {
            const touchTimeStamp =
              typeof e.timeStamp === 'number' && Number.isFinite(e.timeStamp) ? e.timeStamp : 0
            const prevProcessedTouchEnd = lastProcessedTouchEndRef.current
            const isDuplicateTouchEnd =
              !!prevProcessedTouchEnd &&
              prevProcessedTouchEnd.identifier === t.identifier &&
              Math.abs(prevProcessedTouchEnd.timeStamp - touchTimeStamp) < 1 &&
              prevProcessedTouchEnd.clientX === t.clientX &&
              prevProcessedTouchEnd.clientY === t.clientY

            if (isDuplicateTouchEnd) {
              debugTouchLog('handleTouchEnd ignored duplicate touchend', {
                identifier: t.identifier,
                clientX: t.clientX,
                clientY: t.clientY,
                timeStamp: touchTimeStamp,
              })
              return
            }

            lastProcessedTouchEndRef.current = {
              identifier: t.identifier,
              clientX: t.clientX,
              clientY: t.clientY,
              timeStamp: touchTimeStamp,
            }
            // Konva can emit a synthetic stage tap after touchend on empty space.
            // For touch, selection clearing is handled here so the stage tap does not
            // run a second clear after the touch gesture has already been classified.
            ignoreNextTapClearRef.current = true

            const endClient = { x: t.clientX, y: t.clientY }
            const now = performance.now()
            const prev = lastTapRef.current
            const elementId =
              getElementIdAtClientPoint(endClient.x, endClient.y) ?? touchStartElementId

            const isDoubleTap =
              !!prev &&
              now - prev.time <= DOUBLE_TAP_MS &&
              prev.elementId === elementId &&
              Math.hypot(endClient.x - prev.clientX, endClient.y - prev.clientY) <= DOUBLE_TAP_SLOP_PX

            debugTouchLog('handleTouchEnd tap evaluation', {
              endClient,
              now,
              prev,
              dt: prev ? now - prev.time : null,
              isDoubleTap,
            })

            if (isDoubleTap) {
              lastTapRef.current = null
              cancelPendingTouchSelectionClear()
              suppressNextCanvasElementTap(window)
              const opened = openContextMenuAtClientPoint(endClient.x, endClient.y)
              if (opened) {
                ignoreNextTapClearRef.current = true
                debugTouchLog('handleTouchEnd double-tap -> menu opened')
              } else {
                debugTouchLog('handleTouchEnd double-tap but no menu items')
              }
            } else {
              if (elementId == null && !touchStartedOnContent) {
                schedulePendingTouchSelectionClear()
              } else {
                cancelPendingTouchSelectionClear()
              }
              lastTapRef.current = {
                time: now,
                clientX: endClient.x,
                clientY: endClient.y,
                elementId,
              }
              debugTouchLog('handleTouchEnd stored single tap', {
                tap: lastTapRef.current,
              })
            }
          }
        }
      }
    },
    [
      dragOccurred,
      touchHasMoved,
      cancelLongPress,
      cancelPendingTouchSelectionClear,
      enableLongPressContextMenu,
      getElementIdAtClientPoint,
      onMultiFingerSwipe,
      openContextMenuAtClientPoint,
      setSelection,
      setCameraGestureHitTestingDisabled,
      isSelecting,
      selectionRect,
      onFindElementsInRectangle,
      handleMouseUp,
      pushLiveCameraToStore,
      schedulePendingTouchSelectionClear,
      suppressSyntheticMouseAfterTouch,
      finishCssCameraTransform,
      window,
      viewportUI,
      dragOccurredRef,
      longPressRef,
      multiFingerSwipeRef,
      touchPanWindowCleanupRef,
      cameraGestureActiveRef,
      touchStartedOnDraggableRef,
      touchStartElementIdRef,
      touchStartedOnContentRef,
      touchSingleFingerPanActiveRef,
      setTouchStartDistance,
      setTouchStartCenter,
      setTouchPanStart,
      setTouchPanInitialCanvasPan,
      touchPanStartRef,
      touchPanInitialCanvasPanRef,
      rectSelectActiveRef,
      selectionRectLiveRef,
      ignoreNextTapClearRef,
      cameraSyncTimeoutRef,
      setTouchHasMoved,
      setDragOccurred,
      setTouchFingerPanForUI,
      stageRef,
      lastProcessedTouchEndRef,
      lastTapRef,
    ]
  )

  useEffect(() => {
    handleTouchMoveRef.current = handleTouchMove
  }, [handleTouchMove, handleTouchMoveRef])
  useEffect(() => {
    handleTouchEndRef.current = handleTouchEnd
  }, [handleTouchEnd, handleTouchEndRef])

  return { handleTouchStart, handleTouchMove, handleTouchEnd }
}
