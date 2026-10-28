import { useId, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export interface HiddenItem {
  id: string
  label: string
  icon?: ReactNode
  subtitle?: string
  onSelect?: () => void
  onHoverChange?: (hovered: boolean) => void
  selectAriaLabel?: string
}

interface HiddenItemsDialogProps {
  items: HiddenItem[]
  initialSelectedIds?: string[]
  description?: string
  showMoveToCurrentView?: boolean
  getMoveToCurrentViewDefault?: (selectedIds: string[]) => boolean
  onConfirm: (
    selectedIds: string[],
    options: { moveToCurrentView: boolean; moveToCurrentViewOverridden: boolean }
  ) => void
  onCancel: () => void
}

export default function HiddenItemsDialog({
  items,
  initialSelectedIds,
  description,
  showMoveToCurrentView = false,
  getMoveToCurrentViewDefault,
  onConfirm,
  onCancel,
}: HiddenItemsDialogProps) {
  const { t } = useTranslation()
  const checkboxIdPrefix = useId()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelectedIds ?? items.map((item) => item.id))
  )
  const selectedIdList = useMemo(() => Array.from(selectedIds), [selectedIds])
  const defaultMoveToCurrentView = getMoveToCurrentViewDefault?.(selectedIdList) ?? true
  const [moveToCurrentView, setMoveToCurrentView] = useState(defaultMoveToCurrentView)
  const [moveToCurrentViewOverridden, setMoveToCurrentViewOverridden] = useState(false)
  const [previousDefaultMoveToCurrentView, setPreviousDefaultMoveToCurrentView] = useState(defaultMoveToCurrentView)
  if (previousDefaultMoveToCurrentView !== defaultMoveToCurrentView) {
    setPreviousDefaultMoveToCurrentView(defaultMoveToCurrentView)
    setMoveToCurrentView(defaultMoveToCurrentView)
    setMoveToCurrentViewOverridden(false)
  }

  const allChecked = useMemo(() => {
    if (items.length === 0) return false
    return items.every((item) => selectedIds.has(item.id))
  }, [items, selectedIds])

  const someChecked = useMemo(() => {
    if (items.length === 0) return false
    return items.some((item) => selectedIds.has(item.id)) && !allChecked
  }, [items, selectedIds, allChecked])

  const handleToggleAll = () => {
    setMoveToCurrentViewOverridden(false)
    if (allChecked) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(items.map((item) => item.id)))
    }
  }

  const handleToggleItem = (id: string) => {
    setMoveToCurrentViewOverridden(false)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleConfirm = () => {
    onConfirm(selectedIdList, { moveToCurrentView, moveToCurrentViewOverridden })
  }

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t('hiddenItemsDialog.none', 'There are no hidden items in this view.')}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {t('common.close', 'Close')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {description ?? t('hiddenItemsDialog.description', 'Select one or more items to show again on the plan.')}
      </p>

      <div className="border border-gray-200 dark:border-gray-700 rounded-md max-h-64 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
        <label className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
          <input
            type="checkbox"
            checked={allChecked}
            ref={(el) => {
              if (el) {
                el.indeterminate = someChecked
              }
            }}
            onChange={handleToggleAll}
            className="rounded border-gray-400"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t('hiddenItemsDialog.selectAll', 'Select all')}
          </span>
        </label>

        {items.map((item, index) => (
          <div
            key={item.id}
            className="relative flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            onMouseEnter={() => item.onHoverChange?.(true)}
            onMouseLeave={() => item.onHoverChange?.(false)}
          >
            <label htmlFor={`${checkboxIdPrefix}-${index}`} className="absolute inset-0 cursor-pointer">
              <span className="sr-only">{item.label}</span>
            </label>
            <input
              id={`${checkboxIdPrefix}-${index}`}
              type="checkbox"
              checked={selectedIds.has(item.id)}
              onChange={() => handleToggleItem(item.id)}
              onClick={(event) => event.stopPropagation()}
              className="relative z-10 rounded border-gray-400 mt-0.5"
            />
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {item.icon && (
                item.onSelect ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      item.onSelect?.()
                    }}
                    className="relative z-10 flex-shrink-0 w-9 h-9 flex items-center justify-center bg-gray-100 hover:bg-sky-50 dark:bg-gray-700 dark:hover:bg-sky-900/30 rounded border border-gray-200 hover:border-sky-400 dark:border-gray-600 dark:hover:border-sky-500 overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    aria-label={item.selectAriaLabel}
                    title={item.selectAriaLabel}
                  >
                    {item.icon}
                  </button>
                ) : (
                  <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600 overflow-hidden">
                    {item.icon}
                  </div>
                )
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                  {item.label}
                </div>
                {item.subtitle && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {item.subtitle}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {showMoveToCurrentView && (
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={moveToCurrentView}
            onChange={(event) => {
              setMoveToCurrentView(event.target.checked)
              setMoveToCurrentViewOverridden(true)
            }}
            className="rounded border-gray-400"
          />
          <span>{t('hiddenItemsDialog.moveToCurrentView', 'Move to current view')}</span>
        </label>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          disabled={selectedIds.size === 0}
        >
          {t('hiddenItemsDialog.confirm', 'Show')}
        </button>
      </div>
    </div>
  )
}
