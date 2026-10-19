import { useEffect, useRef, type MutableRefObject } from 'react'
import { useCanvasWindow, useViewport } from '@/components/viewport/ViewportContext'
import { viewportShortcutRouter } from '@/lib/viewport/viewportShortcutRouting'
import { useViewportUIApi, useIsActiveViewport } from '@/components/viewport/ViewportUIStore'
import {
  applyEendraadCircuitFocus,
  listCircuitsWithSingleLetterCode,
} from '@/lib/eendraad/focusCircuit'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'

type CircuitLetterHotkeyProject = ProjectWithOptionalV2Electrical & {
  project: {
    id: string
  }
}

/**
 * Shift + physical letter (KeyA…KeyZ): focus a circuit whose code is that single letter (A–Z only).
 * Repeating the same shortcut cycles when multiple circuits share the code (e.g. two panels both "A").
 * Only active while the pointer is over the 1‑wire canvas container.
 */
export function useEendraadCircuitLetterHotkeys(
  currentProject: CircuitLetterHotkeyProject | null,
  pointerOverEendraadRef: MutableRefObject<boolean>
) {
  const window = useCanvasWindow()
  const viewport = useViewport()
  const viewportUI = useViewportUIApi()
  const isActiveViewport = useIsActiveViewport()
  const cycleIndexByLetterRef = useRef<Record<string, number>>({})
  const lastProjectIdRef = useRef<string | null>(null)

  useEffect(() => {
    const pid = currentProject?.project.id ?? null
    if (pid !== lastProjectIdRef.current) {
      lastProjectIdRef.current = pid
      cycleIndexByLetterRef.current = {}
    }
  }, [currentProject?.project.id])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActiveViewport()) return
      if (e.repeat) return
      if (
        !pointerOverEendraadRef.current &&
        !(viewport && viewportShortcutRouter.isHoveredViewport(window, viewport.panelIndex))
      )
        return
      if (!currentProject) return
      if (isKeyboardTypingTarget(e.target)) return
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
      if (!e.code.startsWith('Key') || e.code.length !== 4) return
      const letter = e.code.slice(3)
      if (letter.length !== 1 || letter < 'A' || letter > 'Z') return

      const matches = listCircuitsWithSingleLetterCode(currentProject, letter)
      if (matches.length === 0) return

      e.preventDefault()
      e.stopPropagation()

      const map = cycleIndexByLetterRef.current
      let idx = (map[letter] ?? -1) + 1
      if (idx >= matches.length) idx = 0
      map[letter] = idx
      const circuit = matches[idx]!

      applyEendraadCircuitFocus({
        circuitId: circuit.id,
        setSelection: viewportUI.getState().setSelection,
        requestFitToView: viewportUI.getState().requestFitToView,
      })
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [currentProject, pointerOverEendraadRef, viewportUI, window, isActiveViewport, viewport])
}
