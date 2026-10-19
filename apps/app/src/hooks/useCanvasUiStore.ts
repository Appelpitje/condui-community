import { startTransition, useCallback, useEffect, useRef } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useUIStore } from '@/stores/uiStore'
import type { Endpoint, TrunkDevice } from '@/types/schema'
import type { Selection } from '@/types/ui'
import {
  endpointSelectionMatches,
  trunkDeviceSelectionMatches,
} from '@/lib/ui/crossCanvasSelection'

/** Raw store setter (for effects); use in plan click handlers for immediate symbol feedback. */
export const useSetSelectionStore = () => useUIStore((s) => s.setSelection)

export const useClearSelectionStore = () => useUIStore((s) => s.clearSelection)

let forwardedInputCommitDepth = 0

/** Forwarded lazy-canvas events already run after the native input handler. */
export function commitForwardedCanvasInput<T>(handle: () => T): T {
  forwardedInputCommitDepth++
  try {
    return handle()
  } finally {
    forwardedInputCommitDepth--
  }
}

/** Defer past the current input event (microtasks still run before mouseup ends). */
function scheduleInputCommit(callback: () => void): void {
  if (forwardedInputCommitDepth > 0 || typeof window === 'undefined') {
    callback()
    return
  }
  setTimeout(() => {
    startTransition(callback)
  }, 0)
}

/**
 * Low-priority selection updates (BaseCanvas empty-click deselect, eendraad).
 *
 * Zustand is an external store, so startTransition alone still notifies subscribers during the
 * input event. setTimeout(0) exits Konva's mouseup/tap handler before React reconciles.
 */
/**
 * Drop any stale breadcrumb/callout hover on a selection change. Global hover is
 * set by hover-highlight sources (metadata callouts, breadcrumbs) whose pointer
 * `mouseleave` can be missed; without this, a dashed hover outline would linger on
 * an element after (de)selecting it (notably HVAC/ventilation endpoints, the only
 * eendraad endpoints that render a hover-emitting callout).
 */
function clearStaleHoverOnSelectionChange(): void {
  const { hover, clearHover } = useUIStore.getState()
  if (hover.type !== null) clearHover()
}

export function useCommitSelection() {
  const setSelection = useUIStore((s) => s.setSelection)
  const pendingSelectionRef = useRef<Selection | null>(null)
  const flushScheduledRef = useRef(false)
  const commitGenerationRef = useRef(0)
  useEffect(() => {
    return () => {
      pendingSelectionRef.current = null
      flushScheduledRef.current = false
      commitGenerationRef.current++
    }
  }, [])
  return useCallback(
    (next: Selection) => {
      if (forwardedInputCommitDepth > 0) {
        // A previously queued native click must not keep a forwarded handler
        // pending past the temporary diagram's lifetime or overwrite its result.
        commitGenerationRef.current++
        pendingSelectionRef.current = null
        flushScheduledRef.current = false
        setSelection(next)
        clearStaleHoverOnSelectionChange()
        return
      }
      pendingSelectionRef.current = next
      if (flushScheduledRef.current) return
      flushScheduledRef.current = true
      const generation = ++commitGenerationRef.current
      scheduleInputCommit(() => {
        if (generation !== commitGenerationRef.current) return
        flushScheduledRef.current = false
        const pending = pendingSelectionRef.current
        pendingSelectionRef.current = null
        if (pending) {
          setSelection(pending)
          clearStaleHoverOnSelectionChange()
        }
      })
    },
    [setSelection],
  )
}

export function useCommitClearSelection() {
  const clearSelection = useUIStore((s) => s.clearSelection)
  return useCallback(() => {
    const { selection } = useUIStore.getState()
    // Multi-clear touches many PlacementSymbols + PropertiesPanel; mark low-priority so mouseup exits first.
    if (selection.ids.length > 1) {
      scheduleInputCommit(() => {
        startTransition(() => {
          clearSelection()
          clearStaleHoverOnSelectionChange()
        })
      })
      return
    }
    scheduleInputCommit(() => {
      clearSelection()
      clearStaleHoverOnSelectionChange()
    })
  }, [clearSelection])
}

/** @deprecated Use useCommitSelection in click handlers. */
export const useSetSelection = useCommitSelection
/** @deprecated Use useCommitClearSelection in click handlers. */
export const useClearSelection = useCommitClearSelection
export const useSetHover = () => useUIStore((s) => s.setHover)
export const useClearHover = () => useUIStore((s) => s.clearHover)

/** Skip re-renders when the derived boolean did not change (critical on large eendraad canvases). */
const selectionBoolEqual = (a: boolean, b: boolean) => a === b

/** True when this id is in selection.ids (matches protection/trunk style checks). */
export function useIsIdSelected(id: string): boolean {
  return useStoreWithEqualityFn(useUIStore, (s) => s.selection.ids.includes(id), selectionBoolEqual)
}

export function useIsTypeAndIdSelected(
  type: NonNullable<Selection['type']>,
  id: string,
): boolean {
  return useStoreWithEqualityFn(
    useUIStore,
    (s) => s.selection.type === type && s.selection.ids.includes(id),
    selectionBoolEqual,
  )
}

export function useIsWireSelected(wireId: string): boolean {
  return useStoreWithEqualityFn(
    useUIStore,
    (s) => s.selection.type === 'wire' && s.selection.ids.includes(wireId),
    selectionBoolEqual,
  )
}

export function useEndpointSelected(endpoint: Endpoint): boolean {
  return useStoreWithEqualityFn(
    useUIStore,
    (s) => endpointSelectionMatches(s.selection, endpoint),
    selectionBoolEqual,
  )
}

export function useTrunkDeviceSelected(device: TrunkDevice): boolean {
  return useStoreWithEqualityFn(
    useUIStore,
    (s) => trunkDeviceSelectionMatches(s.selection, device),
    selectionBoolEqual,
  )
}

export function useHoverIncludes(type: Selection['type'], id: string): boolean {
  return useStoreWithEqualityFn(
    useUIStore,
    (s) => s.hover.type === type && s.hover.ids.includes(id),
    selectionBoolEqual,
  )
}

export function useInfoBlockBoxSelected(boxId: string, interactive: boolean): boolean {
  return useStoreWithEqualityFn(
    useUIStore,
    (s) => interactive && s.selection.type === 'infoBlock' && s.selection.ids[0] === boxId,
    selectionBoolEqual,
  )
}
