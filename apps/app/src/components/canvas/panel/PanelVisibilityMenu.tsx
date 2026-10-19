import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getSymbolById, getSymbolIconPath } from '@/lib/symbols'
import { preventCanvasToolbarMouseFocus } from '@/lib/ui/preventCanvasToolbarMouseFocus'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import type { PanelGridModuleRef } from '@/types/schema'
import {
  getPanelHiddenModulePresentation,
  getPanelModuleSelection,
  type PanelHiddenModulePresentation,
} from './panelHiddenModulePresentation'

export interface PanelVisibilityTarget {
  panelId: string
  panelName: string
}

interface PanelVisibilityItem extends PanelHiddenModulePresentation {
  panelId: string
  panelName: string
  ref: PanelGridModuleRef
}

interface PanelVisibilityMenuProps {
  readOnly?: boolean
  showPanelName?: boolean
  targets: PanelVisibilityTarget[]
  onShow: (panelId: string, moduleKey: string) => void
}

export function PanelVisibilityMenu({
  readOnly = false,
  showPanelName = false,
  targets,
  onShow,
}: PanelVisibilityMenuProps) {
  const { t } = useTranslation()
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)
  const getPanelHiddenModuleRefs = useProjectStore(
    (state: ProjectState) => state.getPanelHiddenModuleRefs
  )
  const setSelection = useUIStore((state) => state.setSelection)
  const setHover = useUIStore((state) => state.setHover)
  const clearHover = useUIStore((state) => state.clearHover)

  const items = useMemo<PanelVisibilityItem[]>(() => {
    if (!currentProject) return []
    return targets.flatMap(({ panelId, panelName }) =>
      getPanelHiddenModuleRefs(panelId).map((ref) => ({
        ...getPanelHiddenModulePresentation(ref, currentProject, t),
        panelId,
        panelName,
        ref,
      }))
    )
  }, [currentProject, getPanelHiddenModuleRefs, t, targets])

  useEffect(() => clearHover, [clearHover])

  return (
    <div
      className="w-80 overflow-hidden rounded-md border border-gray-200 bg-white text-sm shadow-lg dark:border-gray-700 dark:bg-gray-800"
      role="region"
      aria-label={t('panelCanvas.visibility', 'Visibility')}
    >
      <div className="border-b border-gray-100 px-3 py-2 text-xs font-medium text-gray-500 dark:border-gray-700 dark:text-gray-400">
        {t('panelCanvas.hiddenDevices', 'Hidden devices')}
      </div>

      {items.length === 0 ? (
        <p className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
          {t('hiddenItemsDialog.none', 'There are no hidden items in this view.')}
        </p>
      ) : (
        <div className="max-h-80 overflow-y-auto p-1.5">
          {items.map((item) => {
            const symbol = item.symbolId ? getSymbolById(item.symbolId) : undefined
            const selection = getPanelModuleSelection(item.ref)
            const subtitle = [item.typeLabel, showPanelName ? item.panelName : undefined]
              .filter(Boolean)
              .join(' · ')

            return (
              <div
                key={`${item.panelId}\u0000${item.key}`}
                className="group flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700"
                onMouseEnter={() => setHover(selection)}
                onMouseLeave={clearHover}
              >
                <button
                  type="button"
                  onPointerDown={(event) => preventCanvasToolbarMouseFocus(event)}
                  onClick={() => setSelection(selection)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                  aria-label={t('hiddenItemsDialog.selectSymbol', 'Select {{symbol}}', {
                    symbol: item.label,
                  })}
                  title={t('hiddenItemsDialog.selectSymbol', 'Select {{symbol}}', {
                    symbol: item.label,
                  })}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-700">
                    {symbol ? (
                      <img
                        src={getSymbolIconPath(symbol)}
                        alt=""
                        className="h-7 w-7 object-contain dark:invert"
                      />
                    ) : (
                      <span className="text-lg text-gray-400" aria-hidden>
                        ◇
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-gray-800 dark:text-gray-100">
                      {item.label}
                    </span>
                    {subtitle && (
                      <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                        {subtitle}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={readOnly}
                  onPointerDown={(event) => preventCanvasToolbarMouseFocus(event)}
                  onClick={() => onShow(item.panelId, item.key)}
                  className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-600"
                >
                  {t('hiddenItemsDialog.confirm', 'Show')}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
