import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Keep a fast local draft value and commit it after inactivity.
 *
 * Intended for text inputs where committing every keystroke to the global store
 * causes expensive downstream recomputation (layout, history snapshots, etc.).
 *
 * Behavior:
 * - Draft updates immediately via setDraft (use as input value)
 * - Commit fires after `delayMs` of no draft changes
 * - Commit flushes on blur via `flush()`
 */
export function useDebouncedCommit<T>(
  committedValue: T,
  onCommit: (value: T) => void,
  options: {
    delayMs?: number
    identityKey?: unknown
    /**
     * Equality check to avoid redundant commits. Defaults to Object.is.
     */
    equals?: (a: T, b: T) => boolean
  } = {}
): {
  draft: T
  setDraft: (value: T) => void
  flush: () => void
  resetDraft: () => void
  isDirty: boolean
} {
  const delayMs = options.delayMs ?? 500
  const equals = options.equals ?? Object.is
  const identityKey = options.identityKey

  const [state, setState] = useState({ identityKey, committedValue, draft: committedValue })
  if (!Object.is(state.identityKey, identityKey) || !Object.is(state.committedValue, committedValue)) {
    setState({ identityKey, committedValue, draft: committedValue })
  }
  const draft = state.draft
  const committedRef = useRef(committedValue)
  const draftRef = useRef(draft)
  useLayoutEffect(() => {
    committedRef.current = committedValue
    draftRef.current = draft
  }, [committedValue, draft])

  const timerRef = useRef<number | null>(null)

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const flush = useCallback(() => {
    clearTimer()
    const latestDraft = draftRef.current
    const latestCommitted = committedRef.current
    if (!equals(latestDraft, latestCommitted)) {
      onCommit(latestDraft)
    }
  }, [equals, onCommit])

  const resetDraft = useCallback(() => {
    clearTimer()
    const value = committedRef.current
    setState((current) => ({ ...current, draft: value }))
  }, [])

  const setDraft = useCallback(
    (value: T) => {
      setState((current) => ({ ...current, draft: value }))
      clearTimer()
      timerRef.current = window.setTimeout(() => {
        flush()
      }, delayMs)
    },
    [delayMs, flush]
  )

  // Do not commit from passive unmount cleanup. Selection/layout changes can
  // unmount property inputs while the store is already updating; committing a
  // stale draft from here can create nested Zustand/React update loops.
  useEffect(() => {
    return () => {
      clearTimer()
    }
  }, [])

  // The render above adopts external values. Cancel the previous entity's timer
  // before events can observe the newly committed draft.
  useLayoutEffect(() => {
    clearTimer()
  }, [identityKey, committedValue])

  const isDirty = !equals(draft, committedValue)

  return { draft, setDraft, flush, resetDraft, isDirty }
}
