import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'


export type MenuActionItem = {
  id: string
  label: string
  /** Small icon for the submenu row. */
  icon: ReactNode
  /** Large icon for the picker tile. */
  largeIcon: ReactNode
  onSelect: () => void
  disabled?: boolean
  /** Shown greyed out but still selectable (e.g. opens an upgrade prompt). */
  muted?: boolean
  title?: string
  
  testId?: string
}

/** Marks flyout content so the main menu's outside-click handler ignores it. */
export const MENU_FLYOUT_ATTRIBUTE = 'data-app-menu-flyout'

const CLOSE_DELAY_MS = 220



/**
 * A main-menu entry with a hover flyout for quick picks. Clicking the entry itself opens the
 * picker dialog, which is also the only behaviour on touch devices (no hover there).
 */
export function MenuSubmenu({
  label,
  icon,
  items,
  onOpenPicker,
  itemClassName,
  disabledItemClassName,
  iconClassName,
  hoverEnabled,
  testId,
}: {
  label: string
  icon: ReactNode
  items: MenuActionItem[]
  onOpenPicker: () => void
  itemClassName: string
  disabledItemClassName: string
  iconClassName: string
  hoverEnabled: boolean
  testId?: string
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const flyoutRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])
  // A short delay lets the pointer travel diagonally into the flyout without closing it.
  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
  }, [cancelClose])
  useEffect(() => cancelClose, [cancelClose])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const flyoutHeight = flyoutRef.current?.offsetHeight ?? 0
    const top = Math.max(8, Math.min(rect.top - 6, window.innerHeight - flyoutHeight - 8))
    setPosition({ left: rect.right + 2, top })
  }, [open])

  const focusItem = (index: number) => {
    const buttons = flyoutRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    if (!buttons?.length) return
    buttons[(index + buttons.length) % buttons.length]?.focus()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        onClick={() => {
          setOpen(false)
          onOpenPicker()
        }}
        onMouseEnter={() => {
          if (!hoverEnabled) return
          cancelClose()
          setOpen(true)
        }}
        onMouseLeave={() => {
          if (hoverEnabled) scheduleClose()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowRight') return
          event.preventDefault()
          setOpen(true)
          window.requestAnimationFrame(() => focusItem(0))
        }}
        className={itemClassName}
      >
        {icon}
        <span className="min-w-0 flex-1">{label}…</span>
        <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
      </button>
      {open
        ? createPortal(
            <div
              ref={flyoutRef}
              role="menu"
              aria-label={label}
              {...{ [MENU_FLYOUT_ATTRIBUTE]: '' }}
              onMouseEnter={cancelClose}
              onMouseLeave={() => {
                if (hoverEnabled) scheduleClose()
              }}
              onKeyDown={(event) => {
                const buttons = Array.from(
                  flyoutRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
                )
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  focusItem(index + 1)
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  focusItem(index - 1)
                } else if (event.key === 'ArrowLeft' || event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  setOpen(false)
                  triggerRef.current?.focus()
                }
              }}
              className="fixed z-[240] min-w-[13rem] rounded-md border border-gray-200 bg-white py-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-800"
              style={{
                left: position?.left ?? -9999,
                top: position?.top ?? -9999,
              }}
            >
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  data-testid={item.testId}
                  disabled={item.disabled}
                  title={item.title}
                  onClick={() => {
                    setOpen(false)
                    item.onSelect()
                  }}
                  className={item.disabled || item.muted ? disabledItemClassName : itemClassName}
                >
                  <span className={iconClassName}>{item.icon}</span>
                  <span className="min-w-0 flex-1">{item.label}</span>
                  {}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}

/** Big-icon tiles for the Import/Export picker dialog; friendly on touch screens. */
export function MenuActionPicker({
  items,
  onPicked,
}: {
  items: MenuActionItem[]
  onPicked: () => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          data-testid={item.testId ? `${item.testId}-tile` : undefined}
          disabled={item.disabled}
          title={item.title}
          onClick={() => {
            onPicked()
            item.onSelect()
          }}
          className={`${item.muted ? 'opacity-60 ' : ''}relative flex min-h-[7rem] flex-col items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-4 text-center text-sm font-medium text-gray-800 transition-colors hover:border-sky-400 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-sky-500 dark:hover:bg-gray-700`}
        >
          {}
          <span className="text-sky-600 dark:text-sky-400">{item.largeIcon}</span>
          {item.label}
        </button>
      ))}
    </div>
  )
}
