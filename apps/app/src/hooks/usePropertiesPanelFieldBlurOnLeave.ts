import { useCallback, useEffect, useRef } from 'react'
import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import {
  PROPERTIES_FIELD_BLUR_DELAY_MS,
  PROPERTIES_FIELD_BLUR_DELAY_AFTER_SPACE_MS,
  PROPERTIES_PANEL_EXTEND_BLUR_EVENT,
} from '@/lib/ui/propertiesPanelFieldBlur'

function isPanelEditableField(el: HTMLElement): boolean {
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

/**
 * Defers blurring properties text fields when the pointer leaves the panel so
 * canvas interaction (e.g. spacebar viewport focus) does not instantly end editing.
 */
export function usePropertiesPanelFieldBlurOnLeave() {
  const ownerWindow = useCanvasWindow()
  const ownerDocument = ownerWindow.document
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelRefRef = useRef<HTMLElement | null>(null)

  const clearScheduledBlur = useCallback(() => {
    if (blurTimeoutRef.current != null) {
      clearTimeout(blurTimeoutRef.current)
      blurTimeoutRef.current = null
    }
  }, [])

  const runBlurIfStillInPanel = useCallback(() => {
    blurTimeoutRef.current = null
    const panelEl = panelRefRef.current
    const activeEl = ownerDocument.activeElement as HTMLElement | null
    if (!panelEl || !activeEl || activeEl.nodeType !== 1) return
    if (!panelEl.contains(activeEl)) return
    if (!isPanelEditableField(activeEl)) return
    activeEl.blur()
  }, [ownerDocument])

  const scheduleBlur = useCallback(
    (delayMs: number, panelEl: HTMLElement) => {
      clearScheduledBlur()
      panelRefRef.current = panelEl
      blurTimeoutRef.current = setTimeout(runBlurIfStillInPanel, delayMs)
    },
    [clearScheduledBlur, runBlurIfStillInPanel]
  )

  const extendScheduledBlur = useCallback(() => {
    const panelEl = panelRefRef.current
    if (!panelEl || blurTimeoutRef.current == null) return
    scheduleBlur(PROPERTIES_FIELD_BLUR_DELAY_AFTER_SPACE_MS, panelEl)
  }, [scheduleBlur])

  const blurActiveFieldOnPanelLeave = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const activeEl = ownerDocument.activeElement as HTMLElement | null
      if (!activeEl || activeEl.nodeType !== 1) return
      if (!e.currentTarget.contains(activeEl)) return
      if (!isPanelEditableField(activeEl)) return
      scheduleBlur(PROPERTIES_FIELD_BLUR_DELAY_MS, e.currentTarget)
    },
    [scheduleBlur, ownerDocument]
  )

  const cancelBlurOnPanelEnter = useCallback(() => {
    clearScheduledBlur()
  }, [clearScheduledBlur])

  useEffect(() => {
    const onExtend = () => extendScheduledBlur()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      extendScheduledBlur()
    }

    ownerWindow.addEventListener(PROPERTIES_PANEL_EXTEND_BLUR_EVENT, onExtend)
    ownerWindow.addEventListener('keydown', onKeyDown, true)
    return () => {
      ownerWindow.removeEventListener(PROPERTIES_PANEL_EXTEND_BLUR_EVENT, onExtend)
      ownerWindow.removeEventListener('keydown', onKeyDown, true)
      clearScheduledBlur()
    }
  }, [extendScheduledBlur, clearScheduledBlur, ownerWindow])

  return { blurActiveFieldOnPanelLeave, cancelBlurOnPanelEnter }
}
