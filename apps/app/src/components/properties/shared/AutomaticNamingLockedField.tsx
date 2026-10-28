import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { openEendraadNamingGuidance } from '@/lib/ui/eendraadNamingGuidance'

function NamingIcon() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white shadow-sm dark:border-gray-600 dark:bg-gray-700">
      <span className="flex items-baseline justify-center gap-px text-[11px] font-bold leading-none tracking-tight text-gray-700 dark:text-gray-200 tabular-nums">
        <span>A</span>
        <span className="text-[9px] opacity-80">B</span>
      </span>
    </span>
  )
}

export function AutomaticNamingLockedField({
  locked,
  children,
}: {
  locked: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', dismiss)
    return () => window.removeEventListener('pointerdown', dismiss)
  }, [open])

  if (!locked) return children

  const tooltip = t('canvas.eendraadNaming.lockedTooltip', 'Auto-label is on')

  return (
    <div ref={rootRef} className="group/auto-label relative">
      <div className="cursor-not-allowed">{children}</div>
      <button
        type="button"
        className="absolute inset-0 z-10 cursor-not-allowed rounded-md"
        aria-label={tooltip}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      />

      {!open ? (
        <div className="pointer-events-none absolute bottom-full left-2 z-40 mb-1 hidden rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-lg group-hover/auto-label:block group-focus-within/auto-label:block">
          {tooltip}
        </div>
      ) : null}

      {open ? (
        <div role="presentation" className="contents" onClick={(event) => event.stopPropagation()}>
          <div
            role="dialog"
            aria-label={tooltip}
            className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-600 dark:bg-gray-800"
          >
            <div className="flex items-start gap-3">
              <NamingIcon />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{tooltip}</div>
                <p className="mt-1 text-xs leading-snug text-gray-600 dark:text-gray-300">
                  {t('canvas.eendraadNaming.lockedDescription', 'Turn it off to change this label.')}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="mt-3 w-full rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
              onClick={() => {
                setOpen(false)
                openEendraadNamingGuidance()
              }}
            >
              {t('canvas.eendraadNaming.openAutomaticNaming', 'Open auto-label')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
