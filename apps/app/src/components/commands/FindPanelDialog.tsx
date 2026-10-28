import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CANVAS_ICONS } from '@/components/viewport/CanvasIcons'
import { useProjectStore } from '@/stores/projectStore'
import { findPanels } from '@/lib/panel/findPanels'
import type { CanvasType } from '@/types/ui'

export function FindPanelDialog({
  canvas,
  onChoose,
}: {
  canvas: CanvasType
  onChoose: (panelId: string, canvas: CanvasType) => boolean
}) {
  const { t } = useTranslation()
  const listId = useId()
  const project = useProjectStore((state) => state.currentProject)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  const results = useMemo(() => (project ? findPanels(project, query) : []), [project, query])
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])
  const choose = (index: number) => {
    const result = results[index]
    if (result)
      onChoose(result.id, canvas === 'plan' && !result.placements.length ? 'eendraad' : canvas)
  }
  return (
    <div data-testid="find-panel" className="space-y-3">
      <input
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
        aria-label={t('findPanel.placeholder')}
        placeholder={t('findPanel.placeholder')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (results.length)
              setActive(
                (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length
              )
          } else if (event.key === 'Enter') {
            event.preventDefault()
            choose(active)
          }
        }}
        className="w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 text-gray-900 outline-none focus:border-sky-500 dark:border-gray-600 dark:text-white"
      />
      {results.length === 0 && (
        <p className="py-4 text-center text-sm text-gray-500">{t('findPanel.empty')}</p>
      )}
      <ul
        id={listId}
        ref={list}
        role="listbox"
        data-app-scroll="true"
        className="max-h-[min(28rem,55dvh)] overflow-y-auto"
      >
        {results.map((result, index) => (
          <li
            key={result.id}
            id={`${listId}-${index}`}
            data-index={index}
            role="option"
            tabIndex={-1}
            aria-selected={active === index}
            onMouseMove={() => setActive(index)}
            onClick={() => choose(index)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                choose(index)
              }
            }}
            className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 ${active === index ? 'bg-sky-50 dark:bg-sky-900/30' : ''}`}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                {result.name}
              </div>
              {result.path && (
                <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {result.path}
                </div>
              )}
            </div>
            {(
              [
                ['eendraad', CANVAS_ICONS.eendraad, 'findPanel.oneWire'],
                ['panel', CANVAS_ICONS.panel, 'findPanel.panelView'],
                ['plan', CANVAS_ICONS.plan, 'findPanel.planView'],
              ] as const
            ).map(([target, Icon, label]) => (
              <button
                key={target}
                type="button"
                disabled={target === 'plan' && !result.placements.length}
                aria-label={`${t(label)} · ${result.name}`}
                title={t(
                  target === 'plan' && !result.placements.length ? 'findPanel.unplaced' : label
                )}
                onClick={(event) => {
                  event.stopPropagation()
                  onChoose(result.id, target)
                }}
                className="rounded p-2 text-gray-600 hover:bg-sky-100 hover:text-sky-700 disabled:cursor-default disabled:opacity-30 dark:text-gray-300 dark:hover:bg-sky-900"
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}
