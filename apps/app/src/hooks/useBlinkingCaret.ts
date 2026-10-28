import { useEffect, useState } from 'react'

export function useBlinkingCaret(active: boolean, intervalMs = 530): boolean {
  const [blink, setBlink] = useState({ active, intervalMs, visible: active })
  if (blink.active !== active || blink.intervalMs !== intervalMs) {
    setBlink({ active, intervalMs, visible: active })
  }

  useEffect(() => {
    if (!active) return
    const interval = window.setInterval(() => {
      setBlink((current) => ({ ...current, visible: !current.visible }))
    }, intervalMs)
    return () => window.clearInterval(interval)
  }, [active, intervalMs])

  return active && blink.visible
}

export function withDimensionCaret(
  value: string,
  suffix: string,
  active: boolean,
  caretVisible: boolean
): string {
  const caret = active ? (caretVisible ? '|' : ' ') : ''
  return `${value}${caret}${value ? suffix : ''}`
}
