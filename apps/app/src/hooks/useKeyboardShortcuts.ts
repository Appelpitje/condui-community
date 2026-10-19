import { useLayoutEffect } from 'react'
import { useViewportWindowApi } from '@/components/viewport/ViewportWindowStore'
import { activateViewportPanel, getViewportPanelUI } from '@/components/viewport/ViewportUIStore'
import type { EditorCapabilities } from '@/lib/viewerMode'
import { editorCommandRegistry } from '@/handlers/commands/editorCommandRegistry'
import {
  viewportShortcutRouter,
  forwardedViewportKeys,
  type ViewportShortcutTarget,
} from '@/lib/viewport/viewportShortcutRouting'
import {
  cancelPendingViewportFocusToggle,
  findViewportPanelIndexAtPoint,
  findViewportPanelIndexFromTarget,
} from '@/handlers/commands/viewport'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'

/**
 * Routes global keyboard shortcuts to the editor command registry
 * (`handlers/commands/editorCommands.ts`), which owns every binding.
 */
export function useKeyboardShortcuts(options?: {
  capabilities?: EditorCapabilities
  targetWindow?: Window
  enabled?: boolean
}) {
  const ownerWindow = options?.targetWindow ?? window
  const windowUI = useViewportWindowApi()
  const enabled = options?.enabled ?? true
  const canEditProject = options?.capabilities?.canEditProject ?? true
  const canPlaceSymbols = options?.capabilities?.canPlaceSymbols ?? true

  useLayoutEffect(() => {
    if (!enabled) return
    let mousePos = { x: 0, y: 0 }
    const windowTarget: ViewportShortcutTarget = {
      viewport: {
        ui: windowUI,
        getOwnerWindow: () => ownerWindow,
        getPanelUI: (index) => getViewportPanelUI(ownerWindow.document, index),
      },
      capabilities: { canEditProject, canPlaceSymbols },
      getPointerPanelIndex: () =>
        findViewportPanelIndexAtPoint(
          mousePos.x,
          mousePos.y,
          ownerWindow.document,
          windowUI.getState().viewportLayout
        ),
    }
    const handleMouseMove = (e: MouseEvent) => {
      mousePos = { x: e.clientX, y: e.clientY }
      viewportShortcutRouter.hover(windowTarget)
    }
    const leave = () => viewportShortcutRouter.leave(windowTarget)
    const handleMouseOut = (e: MouseEvent) => {
      if (e.relatedTarget == null) leave()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = windowTarget
      // Panel lookups read layout, so resolve them only for keys a command handles.
      let pointerPanelIndex: number | null | undefined
      const handled = editorCommandRegistry.handleKeyEvent(e, {
        source: 'keyboard',
        capabilities: target.capabilities,
        viewport: target.viewport,
        get pointerPanelIndex() {
          if (pointerPanelIndex === undefined) {
            pointerPanelIndex = target.getPointerPanelIndex()
          }
          return pointerPanelIndex
        },
        get targetPanelIndex() {
          return target === windowTarget ? findViewportPanelIndexFromTarget(e.target) : null
        },
        event: e,
      })
      if (handled) e.preventDefault()
    }

    const captureKey = (e: KeyboardEvent) => {
      if (forwardedViewportKeys.has(e)) return
      if (e.type === 'keydown' && (e.isComposing || isKeyboardTypingTarget(e.target))) return
      const element = e.target as Element | null
      if (
        e.type === 'keydown' &&
        e.key === 'Enter' &&
        element?.nodeType === 1 &&
        element.closest('button')
      )
        return
      if (
        e.key === 'Tab' &&
        element?.nodeType === 1 &&
        element.closest('a,button,input,textarea,select,[tabindex]')
      )
        return
      const target =
        e.type === 'keyup'
          ? viewportShortcutRouter.release(e, windowTarget)
          : viewportShortcutRouter.press(e, windowTarget)
      // A button in the other window may retain focus after a mouse interaction.
      // Space still belongs to the canvas currently hovered across windows.
      if (
        e.type === 'keydown' &&
        e.key === ' ' &&
        target === windowTarget &&
        element?.nodeType === 1 &&
        element.closest('button')
      )
        return
      const panelIndex = target.getPointerPanelIndex()
      const targetWindow = target.viewport.getOwnerWindow()
      if (panelIndex != null) activateViewportPanel(targetWindow.document, panelIndex)
      if (target === windowTarget) return
      const forwarded = new KeyboardEvent(e.type, {
        key: e.key,
        code: e.code,
        location: e.location,
        repeat: e.repeat,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        bubbles: true,
        cancelable: true,
        view: targetWindow,
      })
      forwardedViewportKeys.add(forwarded)
      const surface = targetWindow.document.querySelector(`[data-viewport-panel="${panelIndex}"]`)
      ;(surface ?? targetWindow.document.body).dispatchEvent(forwarded)
      if (forwarded.defaultPrevented) e.preventDefault()
      e.stopImmediatePropagation()
    }

    ownerWindow.addEventListener('mousemove', handleMouseMove)
    ownerWindow.addEventListener('mouseout', handleMouseOut)
    ownerWindow.addEventListener('pagehide', leave)
    ownerWindow.addEventListener('keydown', handleKeyDown)
    ownerWindow.addEventListener('keydown', captureKey, true)
    ownerWindow.addEventListener('keyup', captureKey, true)
    return () => {
      ownerWindow.removeEventListener('mousemove', handleMouseMove)
      ownerWindow.removeEventListener('mouseout', handleMouseOut)
      ownerWindow.removeEventListener('pagehide', leave)
      ownerWindow.removeEventListener('keydown', handleKeyDown)
      ownerWindow.removeEventListener('keydown', captureKey, true)
      ownerWindow.removeEventListener('keyup', captureKey, true)
      viewportShortcutRouter.remove(windowTarget)
      cancelPendingViewportFocusToggle(ownerWindow)
    }
  }, [canEditProject, canPlaceSymbols, enabled, ownerWindow, windowUI])
}
