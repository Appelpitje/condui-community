import { useEffect, useRef } from 'react'
import type { EditorCapabilities } from '@/lib/viewerMode'
import { editorCommandRegistry } from '@/handlers/commands/editorCommandRegistry'
import {
  cancelPendingViewportFocusToggle,
  findViewportPanelIndexAtPoint,
  findViewportPanelIndexFromTarget,
} from '@/handlers/commands/viewport'

/**
 * Routes global keyboard shortcuts to the editor command registry
 * (`handlers/commands/editorCommands.ts`), which owns every binding.
 */
export function useKeyboardShortcuts(options?: { capabilities?: EditorCapabilities }) {
  const canEditProject = options?.capabilities?.canEditProject ?? true
  const canPlaceSymbols = options?.capabilities?.canPlaceSymbols ?? true
  const mousePos = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      cancelPendingViewportFocusToggle()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Panel lookups read layout, so resolve them only for keys a command handles.
      let pointerPanelIndex: number | null | undefined
      const handled = editorCommandRegistry.handleKeyEvent(e, {
        source: 'keyboard',
        capabilities: { canEditProject, canPlaceSymbols },
        get pointerPanelIndex() {
          if (pointerPanelIndex === undefined) {
            pointerPanelIndex = findViewportPanelIndexAtPoint(
              mousePos.current.x,
              mousePos.current.y
            )
          }
          return pointerPanelIndex
        },
        get targetPanelIndex() {
          return findViewportPanelIndexFromTarget(e.target)
        },
        event: e,
      })
      if (handled) e.preventDefault()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canEditProject, canPlaceSymbols])
}
