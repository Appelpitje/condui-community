import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useProjectStore } from '@/stores/projectStore'
import { liveProjectSession } from '@/stores/liveProjectCommandSession'
import {
  HardwareTallyIcon,
  LibraryIcon,
  QuickPlacerIcon,
  RedoIcon,
  UndoIcon,
} from '@/components/icons/UiIcons'
import { ValidationStateIcon } from '@/components/validation/ValidationStatusIcon'
import { eendraChromeHeaderBackgroundClass } from '@/lib/ui/chromeLayoutStyles'
import { COLLAPSED_PANEL_SIGNIFIER_WIDTH_PX } from '@/constants/layoutConstants'
import type { EditorCapabilities } from '@/lib/viewerMode'
import { useViewportWindowStore } from './ViewportWindowStore'
import {
  DockablePanelShell,
  type DockablePanelOption,
} from '@/components/panels/DockablePanelShell'
import type { LeftDockPanel } from '@/stores/uiStore'
import ArmedPlacementController from '@/components/library/ArmedPlacementController'
import LibraryPanel from '@/components/library/LibraryPanel'
import PropertiesPanel from '@/components/properties/PropertiesPanel'
import { HardwareTallyPanelContent as Tally } from '@/components/tally/HardwareTallyPanel'
import Validation from '@/components/validation/ValidationIssuesDialog'
import { getProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import { getValidationJurisdiction } from '@/lib/validation/core/jurisdiction'

/** Supplied by the hosted layout so Community keeps its existing feature boundary. */
export interface PopupComments {
  title: string
  icon: ReactNode
  render: () => ReactNode
  renderOverlays?: () => ReactNode
}

const buttonClass =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-700 hover:bg-slate-200 disabled:opacity-40 aria-pressed:bg-sky-100 aria-pressed:text-sky-700 dark:aria-pressed:bg-sky-900/40 dark:aria-pressed:text-sky-300 dark:text-slate-200 dark:hover:bg-slate-700'

/** Each popup owns its chrome; expensive panel contents mount only when opened. */
export function PopupEditorShell({
  children,
  capabilities,
  comments,
  panelOptions,
}: {
  children: ReactNode
  capabilities?: EditorCapabilities
  comments?: PopupComments
  panelOptions?: DockablePanelOption[]
}) {
  const { t } = useTranslation()
  const country = useProjectStore((s) =>
    s.currentProject
      ? getProjectElectricalInstallation(s.currentProject)?.address.country
      : undefined
  )
  const canUndo = useProjectStore((s) => s.undoStack.length > 0)
  const canRedo = useProjectStore((s) => s.redoStack.length > 0)
  const selectedLeftPanel = useViewportWindowStore((s) => s.leftDockPanel)
  const leftCollapsed = useViewportWindowStore((s) => s.leftDockCollapsed)
  const propertiesVisible = useViewportWindowStore((s) => s.panels.properties.visible)
  const setLeftPanel = useViewportWindowStore((s) => s.setLeftDockPanel)
  const setLeftCollapsed = useViewportWindowStore((s) => s.setLeftDockCollapsed)
  const togglePanel = useViewportWindowStore((s) => s.togglePanel)
  const canPlace = capabilities?.canPlaceSymbols ?? true
  const canEdit = capabilities?.canEditProject ?? true
  const planVisible = useViewportWindowStore((s) =>
    s.viewportLayout.panels.some((panel) => panel.canvas === 'plan')
  )
  const libraryTitle = t('symbols.library')
  const propertiesTitle = t('properties.title')
  const options = panelOptions ?? [
    ...(canPlace
      ? [{ id: 'library' as const, title: libraryTitle, icon: <LibraryIcon className="h-4 w-4" /> }]
      : []),
    {
      id: 'tally' as const,
      title: t('tally.title'),
      icon: <HardwareTallyIcon className="h-4 w-4" />,
    },
    {
      id: 'validation' as const,
      title: t('validation.title'),
      icon: <ValidationStateIcon className="h-4 w-4" />,
    },
    ...(canPlace
      ? [
          {
            id: 'quickPlacer' as const,
            title: t('quickPlacer.title'),
            icon: <QuickPlacerIcon className="h-4 w-4" />,
          },
        ]
      : []),
    ...(comments ? [{ id: 'comments' as const, title: comments.title, icon: comments.icon }] : []),
  ]
  const leftPanel = options.some((option) => option.id === selectedLeftPanel)
    ? selectedLeftPanel
    : (options[0]?.id ?? 'library')
  const leftTitle = options.find((option) => option.id === leftPanel)?.title ?? libraryTitle
  const showPanel = (panel: LeftDockPanel) => {
    setLeftCollapsed(leftPanel === panel && !leftCollapsed)
    setLeftPanel(panel)
  }
  const blurButton = (event: React.MouseEvent<HTMLButtonElement>) => event.currentTarget.blur()
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-white text-slate-800 dark:bg-gray-800 dark:text-slate-100"
      data-popup-editor
    >
      <ArmedPlacementController enabled={canPlace} />
      <header
        className={`relative flex h-10 shrink-0 items-center justify-end gap-1 border-b border-slate-200 px-2 dark:border-gray-700 ${eendraChromeHeaderBackgroundClass}`}
      >
        {canEdit && (
          <div
            className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1"
            data-popup-history
          >
            <button
              type="button"
              className={buttonClass}
              title={t('shortcuts.entries.undo.description')}
              aria-label={t('shortcuts.entries.undo.description')}
              disabled={!canUndo}
              onClick={() => liveProjectSession.undo()}
              onMouseUp={blurButton}
            >
              <UndoIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={buttonClass}
              title={t('shortcuts.entries.redo.description')}
              aria-label={t('shortcuts.entries.redo.description')}
              disabled={!canRedo}
              onClick={() => liveProjectSession.redo()}
              onMouseUp={blurButton}
            >
              <RedoIcon className="h-4 w-4" />
            </button>
          </div>
        )}
        {comments && (
          <button
            type="button"
            className={buttonClass}
            title={comments.title}
            aria-label={comments.title}
            aria-pressed={leftPanel === 'comments' && !leftCollapsed}
            onClick={() => showPanel('comments')}
            onMouseUp={blurButton}
          >
            {comments.icon}
          </button>
        )}
        <button
          type="button"
          className={buttonClass}
          title={t('tally.title')}
          aria-label={t('tally.title')}
          aria-pressed={leftPanel === 'tally' && !leftCollapsed}
          onClick={() => showPanel('tally')}
          onMouseUp={blurButton}
        >
          <HardwareTallyIcon className="h-5 w-5" />
        </button>
        <button
          type="button"
          className={buttonClass}
          title={t('validation.title')}
          aria-label={t('validation.title')}
          aria-pressed={leftPanel === 'validation' && !leftCollapsed}
          onClick={() => showPanel('validation')}
          onMouseUp={blurButton}
        >
          <ValidationStateIcon
            className="h-5 w-5"
            disabledOutsideBelgium={
              country !== undefined && getValidationJurisdiction(country) !== 'BE'
            }
          />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          data-popup-rail="library"
          data-collapsed={leftCollapsed}
          className="flex shrink-0 flex-col overflow-hidden border-r border-slate-200 dark:border-gray-700"
          style={{ width: leftCollapsed ? COLLAPSED_PANEL_SIGNIFIER_WIDTH_PX : 'min(280px, 32vw)' }}
        >
          <DockablePanelShell
            panelId={leftPanel}
            title={leftTitle}
            mode="docked"
            dockedCollapsed={leftCollapsed}
            onDockedCollapseToggle={() => setLeftCollapsed(!leftCollapsed)}
            switchOptions={options}
            onSwitchPanel={setLeftPanel}
          >
            {leftPanel === 'tally' ? (
              <Tally />
            ) : leftPanel === 'validation' ? (
              <Validation showHeader={false} />
            ) : leftPanel === 'comments' && comments ? (
              comments.render()
            ) : leftPanel === 'quickPlacer' ? (
              planVisible ? (
                <div id="left-dock-quick-placer-host" className="h-full min-h-0" />
              ) : (
                <div className="flex h-full items-center justify-center p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  {t('quickPlacer.availableWhenPlanOpen')}
                </div>
              )
            ) : canPlace ? (
              <LibraryPanel />
            ) : null}
          </DockablePanelShell>
        </aside>
        <main className="relative min-w-0 flex-1 overflow-hidden">{children}</main>
        <aside
          data-popup-rail="properties"
          data-collapsed={!propertiesVisible}
          className="flex shrink-0 flex-col overflow-hidden border-l border-slate-200 dark:border-gray-700"
          style={{
            width: propertiesVisible ? 'min(320px, 34vw)' : COLLAPSED_PANEL_SIGNIFIER_WIDTH_PX,
          }}
        >
          {propertiesVisible ? (
            <>
              <button
                type="button"
                className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-200 px-2 text-sm font-medium hover:bg-slate-100 dark:border-gray-700 dark:hover:bg-slate-700"
                title={propertiesTitle}
                aria-label={propertiesTitle}
                aria-expanded
                onClick={() => togglePanel('properties')}
                onMouseUp={blurButton}
              >
                <ChevronRight className="h-4 w-4" />
                {propertiesTitle}
              </button>
              <div className="min-h-0 flex-1">
                <PropertiesPanel
                  embedded
                  readOnly={!(capabilities?.canEditProperties ?? true)}
                  showSensitiveInfoNotice={capabilities?.canViewSensitiveProjectInfo === false}
                />
              </div>
            </>
          ) : (
            <button
              type="button"
              className="flex h-full items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700"
              title={propertiesTitle}
              aria-label={propertiesTitle}
              aria-expanded={false}
              onClick={() => togglePanel('properties')}
              onMouseUp={blurButton}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
        </aside>
      </div>
      {comments?.renderOverlays?.()}
    </div>
  )
}
