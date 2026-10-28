import { useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { useDialogStore } from '@/stores/dialogStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import type { CommandRegistry } from '@/lib/commands/ui/registry'
import type { CommandContext } from '@/lib/commands/ui/types'

export const COMMAND_PALETTE_DIALOG_ID = 'command-palette'

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function CommandPalette({
  registry,
  context,
}: {
  registry: CommandRegistry
  context: CommandContext
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const project = useProjectStore((state) => state.currentProject)
  const selection = useUIStore((state) => state.selection)
  const activePanelId = useUIStore((state) => state.activePanelId)
  const activeFloorId = useUIStore((state) => state.activeFloorId)
  const navigationInputs = useMemo(
    () => ({ query, project, selection, activePanelId, activeFloorId }),
    [query, project, selection, activePanelId, activeFloorId]
  )
  const [navigation, setNavigation] = useState({ inputs: navigationInputs, index: 0 })
  const activeIndex = navigation.inputs === navigationInputs ? navigation.index : 0
  const setActiveIndex = (next: SetStateAction<number>) => {
    setNavigation((previous) => {
      const index = previous.inputs === navigationInputs ? previous.index : 0
      return { inputs: navigationInputs, index: typeof next === 'function' ? next(index) : next }
    })
  }

  const items = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean)
    return registry
      .listForPalette(context)
      .map((command) => ({ command, label: t(command.labelKey!) }))
      .filter(({ command, label }) => {
        const haystack = normalize(`${label} ${command.searchKey ? t(command.searchKey) : ''}`)
        return words.every((word) => haystack.includes(word))
      })
  }, [registry, context, query, t])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const runAt = (index: number) => {
    const item = items[index]
    if (!item) return
    useDialogStore.getState().closeDialog()
    registry.execute(item.command.id, context)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (items.length === 0) return
      const delta = e.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((index) => (index + delta + items.length) % items.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runAt(activeIndex)
    }
  }

  return (
    <div className="-mx-4 -my-3 flex flex-col sm:-mx-6 sm:-my-4" data-testid="command-palette">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 dark:border-gray-700">
        <Search className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('commandPalette.placeholder')}
          aria-label={t('commandPalette.placeholder')}
          aria-controls="command-palette-list"
          aria-activedescendant={items[activeIndex] ? `command-${activeIndex}` : undefined}
          role="combobox"
          aria-expanded="true"
          className="h-12 w-full bg-transparent text-base text-gray-900 outline-none placeholder:text-gray-400 dark:text-white"
        />
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
          {t('commandPalette.empty')}
        </p>
      ) : (
        <ul
          id="command-palette-list"
          ref={listRef}
          role="listbox"
          data-app-scroll="true"
          className="max-h-[min(24rem,60dvh)] overflow-y-auto p-1.5"
        >
          {items.map(({ command, label }, index) => (
            <li
              key={command.id}
              id={`command-${index}`}
              data-index={index}
              role="option"
              tabIndex={-1}
              aria-selected={index === activeIndex}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => runAt(index)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  runAt(index)
                }
              }}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm ${
                index === activeIndex
                  ? 'bg-sky-50 text-sky-900 dark:bg-sky-900/30 dark:text-sky-100'
                  : 'text-gray-700 dark:text-gray-200'
              }`}
            >
              <span className="min-w-0 truncate">{label}</span>
              {command.keyLabels?.[0] && (
                <kbd className="flex-shrink-0 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold leading-none text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300">
                  {t(`shortcuts.keys.${command.keyLabels[0]}`)}
                </kbd>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
