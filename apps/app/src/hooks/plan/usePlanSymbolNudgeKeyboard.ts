import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react'
import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import { useIsActiveViewport, useViewportUIApi } from '@/components/viewport/ViewportUIStore'
import type { Point } from '@/types/ui'
import {
  addCanvasDeltas,
  buildNudgePreviewPositions,
  canPlanSymbolNudgeSelection,
  commitPlanSymbolNudge,
  computeNudgeDeltaCanvas,
  isPlanArrowKey,
  PLAN_NUDGE_COMMIT_COALESCE_MS,
  resolvePlanNudgePlacements,
  resolvePlanNudgePxPerMeter,
  type PlanArrowKey,
  type PlanNudgePlacementRow,
} from '@/lib/plan/planSymbolNudge'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'

export type PlanSymbolNudgeKeyboardOptions = {
  activeFloorId: string | null
  pxPerMeter?: number | null
  disabled?: boolean
  /** Live preview while keys are held (same map as drag overrides). */
  setPreviewPositions: (positions: Map<string, Point>) => void
  isDraggingRef?: MutableRefObject<boolean>
  onCommit?: () => void
}

/**
 * Arrow-key nudge for selected plan symbols while PlanCanvas is mounted.
 * Tap: 1 cm (preview instant). Hold: 10→18 cm/s after 250 ms delay. Store commits coalesced.
 */
export function usePlanSymbolNudgeKeyboard({
  activeFloorId,
  pxPerMeter: pxPerMeterOption,
  disabled = false,
  setPreviewPositions,
  isDraggingRef,
  onCommit,
}: PlanSymbolNudgeKeyboardOptions) {
  const window = useCanvasWindow()
  const viewportUI = useViewportUIApi()
  const isActiveViewport = useIsActiveViewport()
  const heldArrowsRef = useRef(new Set<PlanArrowKey>())
  const keyDownTimesRef = useRef(new Map<PlanArrowKey, number>())
  const frozenLiveDeltaRef = useRef({ x: 0, y: 0 })
  const baselineDeltaRef = useRef({ x: 0, y: 0 })
  const rafRef = useRef<number | null>(null)
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionRowsRef = useRef<PlanNudgePlacementRow[] | null>(null)
  const lastPreviewKeyRef = useRef('')

  const setPreviewRef = useRef(setPreviewPositions)
  const onCommitRef = useRef(onCommit)
  useLayoutEffect(() => {
    setPreviewRef.current = setPreviewPositions
    onCommitRef.current = onCommit
  }, [setPreviewPositions, onCommit])

  useEffect(() => {
    if (disabled) return

    const resolvePxPerMeter = () =>
      pxPerMeterOption !== undefined ? pxPerMeterOption : resolvePlanNudgePxPerMeter(activeFloorId)

    const computeLiveDelta = (nowMs: number) =>
      computeNudgeDeltaCanvas({
        nowMs,
        held: heldArrowsRef.current,
        keyDownTimes: keyDownTimesRef.current,
        frozenDeltaCanvas: frozenLiveDeltaRef.current,
        pxPerMeter: resolvePxPerMeter(),
      })

    const computeTotalDelta = (nowMs: number) =>
      addCanvasDeltas(baselineDeltaRef.current, computeLiveDelta(nowMs))

    const syncPreview = (nowMs: number) => {
      const rows = sessionRowsRef.current
      if (!rows) {
        if (lastPreviewKeyRef.current !== '') {
          lastPreviewKeyRef.current = ''
          setPreviewRef.current(new Map())
        }
        return
      }

      const delta = computeTotalDelta(nowMs)
      if (delta.x === 0 && delta.y === 0) {
        if (lastPreviewKeyRef.current !== '') {
          lastPreviewKeyRef.current = ''
          setPreviewRef.current(new Map())
        }
        return
      }

      const previewKey = `${delta.x.toFixed(3)}:${delta.y.toFixed(3)}`
      if (previewKey === lastPreviewKeyRef.current) return
      lastPreviewKeyRef.current = previewKey

      setPreviewRef.current(buildNudgePreviewPositions(rows, delta))
    }

    const stopLoop = () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }

    const cancelCommitTimer = () => {
      if (commitTimerRef.current != null) {
        clearTimeout(commitTimerRef.current)
        commitTimerRef.current = null
      }
    }

    const resetSession = () => {
      cancelCommitTimer()
      sessionRowsRef.current = null
      keyDownTimesRef.current.clear()
      frozenLiveDeltaRef.current = { x: 0, y: 0 }
      baselineDeltaRef.current = { x: 0, y: 0 }
      lastPreviewKeyRef.current = ''
      setPreviewRef.current(new Map())
    }

    const flushCommit = () => {
      cancelCommitTimer()
      const rows = sessionRowsRef.current
      const delta = baselineDeltaRef.current
      if (!rows || (delta.x === 0 && delta.y === 0)) {
        resetSession()
        return
      }

      commitPlanSymbolNudge({
        rows,
        deltaCanvas: delta,
        activeFloorId,
      })
      onCommitRef.current?.()
      resetSession()
    }

    const scheduleCommit = () => {
      cancelCommitTimer()
      commitTimerRef.current = setTimeout(flushCommit, PLAN_NUDGE_COMMIT_COALESCE_MS)
    }

    const ensureSession = () => {
      if (sessionRowsRef.current) return true
      const { selection } = viewportUI.getState()
      const rows = resolvePlanNudgePlacements(selection, activeFloorId).filter((row) => !row.locked)
      if (rows.length === 0) return false
      sessionRowsRef.current = rows
      frozenLiveDeltaRef.current = { x: 0, y: 0 }
      baselineDeltaRef.current = { x: 0, y: 0 }
      return true
    }

    const mergeLiveIntoBaseline = (nowMs: number) => {
      baselineDeltaRef.current = computeTotalDelta(nowMs)
      frozenLiveDeltaRef.current = { x: 0, y: 0 }
      keyDownTimesRef.current.clear()
    }

    const tick = () => {
      if (heldArrowsRef.current.size === 0) {
        rafRef.current = null
        return
      }
      syncPreview(performance.now())
      rafRef.current = window.requestAnimationFrame(tick)
    }

    const startLoop = () => {
      if (rafRef.current != null) return
      rafRef.current = window.requestAnimationFrame(tick)
    }

    const freezeAxisForKey = (code: PlanArrowKey, nowMs: number) => {
      const live = computeLiveDelta(nowMs)
      if (code === 'ArrowLeft' || code === 'ArrowRight') {
        const other =
          code === 'ArrowLeft'
            ? heldArrowsRef.current.has('ArrowRight')
            : heldArrowsRef.current.has('ArrowLeft')
        if (!other) frozenLiveDeltaRef.current.x = live.x
      }
      if (code === 'ArrowUp' || code === 'ArrowDown') {
        const other =
          code === 'ArrowUp'
            ? heldArrowsRef.current.has('ArrowDown')
            : heldArrowsRef.current.has('ArrowUp')
        if (!other) frozenLiveDeltaRef.current.y = live.y
      }
    }

    const canHandle = (target: EventTarget | null): boolean => {
      if (isDraggingRef?.current) return false
      if (!viewportUI.getState().viewportLayout.panels.some((panel) => panel.canvas === 'plan'))
        return false
      if (isKeyboardTypingTarget(target)) return false
      const { selection } = viewportUI.getState()
      return canPlanSymbolNudgeSelection(selection)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActiveViewport()) return
      if (!isPlanArrowKey(e.code)) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (!canHandle(e.target)) return

      e.preventDefault()
      if (e.repeat) return

      const code = e.code
      if (heldArrowsRef.current.has(code)) return
      if (!ensureSession()) return

      cancelCommitTimer()

      const now = performance.now()
      heldArrowsRef.current.add(code)
      keyDownTimesRef.current.set(code, now)
      syncPreview(now)
      startLoop()
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isPlanArrowKey(e.code)) return
      if (!heldArrowsRef.current.has(e.code)) return

      const now = performance.now()
      const isLastKey = heldArrowsRef.current.size === 1

      freezeAxisForKey(e.code, now)
      heldArrowsRef.current.delete(e.code)
      keyDownTimesRef.current.delete(e.code)

      if (isLastKey) {
        stopLoop()
        mergeLiveIntoBaseline(now)
        syncPreview(now)
        scheduleCommit()
      } else {
        syncPreview(now)
        startLoop()
      }
    }

    const handleWindowBlur = () => {
      stopLoop()
      if (heldArrowsRef.current.size > 0) {
        mergeLiveIntoBaseline(performance.now())
      }
      heldArrowsRef.current.clear()
      flushCommit()
    }

    const heldArrows = heldArrowsRef.current
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
      stopLoop()
      heldArrows.clear()
      if (sessionRowsRef.current) {
        flushCommit()
      } else {
        resetSession()
      }
    }
  }, [
    activeFloorId,
    disabled,
    isDraggingRef,
    pxPerMeterOption,
    window,
    isActiveViewport,
    viewportUI,
  ])
}
