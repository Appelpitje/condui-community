import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** A short hover delay shared by the label, info marker and control, including disabled choices. */
export function LabelSettingHelp({
  text,
  children,
  className = '',
  descriptionId,
}: {
  text?: string
  children: ReactNode
  className?: string
  descriptionId?: string
}) {
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number; ownerDocument: Document } | null>(null)
  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setPosition(null)
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  const show = () => {
    if (!text) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const element = ref.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      const view = element.ownerDocument.defaultView
      setPosition({
        ownerDocument: element.ownerDocument,
        left: Math.max(8, Math.min(rect.left, (view?.innerWidth ?? 1024) - 296)),
        top: rect.top,
      })
    }, 150)
  }
  return (
    <span
      role="presentation"
      ref={ref}
      className={`inline-flex min-w-0 ${className}`}
      aria-describedby={position ? id : undefined}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') show()
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape') hide()
      }}
    >
      {children}
      {descriptionId && text ? <span id={descriptionId} className="sr-only">{text}</span> : null}
      {position && text
        ? createPortal(
            <span
              id={id}
              role="tooltip"
              data-testid="label-setting-help"
              className="pointer-events-none fixed z-[1200] w-72 -translate-y-full rounded-md bg-gray-950 px-3 py-2 text-xs text-white shadow-lg"
              style={{ left: position.left, top: position.top - 8 }}
            >
              {text}
            </span>,
            position.ownerDocument.body
          )
        : null}
    </span>
  )
}
