import { useEffect, useRef, useState } from 'react'

/** Drawing suppresses hit testing; leaving it holds suppression for 180 ms.
 * The owner/source transition, rather than unrelated renders, owns the timer. */
export function usePlanDrawHitTestingCooldown(isDrawing: boolean, window: Window) {
  const [transition, setTransition] = useState({
    initialized: false, isDrawing, window, active: false, startTimer: false, token: {},
  })
  let active = transition.active
  let startTimer = transition.startTimer
  if (!transition.initialized || transition.isDrawing !== isDrawing || transition.window !== window) {
    startTimer = !isDrawing && transition.initialized && transition.isDrawing
    active = isDrawing || startTimer
    setTransition({ initialized: true, isDrawing, window, active, startTimer, token: {} })
  }
  const token = transition.token
  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (timer.current != null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (startTimer) {
      timer.current = window.setTimeout(() => {
        setTransition(current => current.token === token ? { ...current, active: false } : current)
        timer.current = null
      }, 180)
    }
  }, [isDrawing, window, startTimer, token])
  useEffect(() => () => {
    if (timer.current != null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])
  return active
}
