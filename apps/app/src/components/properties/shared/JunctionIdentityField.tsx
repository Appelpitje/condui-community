import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, List } from 'lucide-react'
import { DebouncedTextInput } from '@/components/forms'
import { visibilityToggleClass } from './propertiesSharedUtils'

interface JunctionIdentityFieldProps {
  value: string
  options: string[]
  visible: boolean
  fixedPrefix?: string
  onCommit: (value: string) => void
  onToggleVisible: () => void
  label: string
  pickTitle: string
  toggleTitle: string
  emptyText: string
}

export function JunctionIdentityField({
  value,
  options,
  visible,
  fixedPrefix,
  onCommit,
  onToggleVisible,
  label,
  pickTitle,
  toggleTitle,
  emptyText,
}: JunctionIdentityFieldProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const buttonClass =
    'flex h-[42px] w-9 flex-shrink-0 items-center justify-center rounded-md border border-gray-300 bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-2 focus:ring-sky-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'

  return (
    <div ref={rootRef}>
      <div className="mb-1 flex items-center gap-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
        <button
          type="button"
          onClick={onToggleVisible}
          className={visibilityToggleClass(visible)}
          title={toggleTitle}
        >
          {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </button>
      </div>
      <div className="relative flex items-stretch gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {fixedPrefix && (
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {fixedPrefix}
            </span>
          )}
          <DebouncedTextInput
            type="text"
            value={value}
            onCommit={(next) => onCommit(fixedPrefix ? next.replace(/^X/i, '') : next)}
            className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className={buttonClass}
          title={pickTitle}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <List className="h-5 w-5" aria-hidden />
        </button>
        {open && (
          <div
            className="absolute right-0 top-[44px] z-30 max-h-60 min-w-[180px] overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800"
            role="listbox"
          >
            {options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{emptyText}</div>
            ) : (
              options.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={option === value}
                  className="w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
                  onClick={() => {
                    onCommit(option)
                    setOpen(false)
                  }}
                >
                  {fixedPrefix ? `${fixedPrefix}${option.replace(/^X/i, '')}` : option}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
