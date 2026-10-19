import { useEffect, useId, useMemo, useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { editProperties } from '@/handlers/properties/editProperties'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { getChangeoverGridSourceControlState } from '@/lib/supplyAssembly/changeoverGridSourceEdit'
import type { ChangeoverGridSource } from '@/lib/supplyAssembly/changeoverGridSource'

const SOURCES: readonly ChangeoverGridSource[] = ['grid', 'converter-input']

const optionClass = (selected: boolean, blocked: boolean) =>
  `flex min-w-0 w-full flex-col items-center justify-start gap-1 rounded-md border-2 px-2 pb-1.5 pt-2 text-center text-xs font-medium leading-tight transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-gray-900 ${
    selected
      ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
      : 'border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300'
  } ${blocked ? 'cursor-not-allowed opacity-50' : selected ? '' : 'hover:border-sky-300'}`

/**
 * Simplified topology of each option, drawn like the one-wire changeover: the grid line at the
 * bottom, the inverter on its grid-input leg, the inverter output on input 2 (upper contact),
 * the blade and the output up to a rail stub. Only the input-1 feed (lower contact) is
 * highlighted: a riser from the grid line, or a T on the inverter leg.
 * Neutral 1px strokes sit on half pixels and the 2px highlight on whole pixels, so both stay crisp.
 */
export function ChangeoverGridSourceIcon({ source }: { source: ChangeoverGridSource }) {
  return (
    <svg
      viewBox="0 0 68 40"
      width={68}
      height={40}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-gray-500 dark:text-gray-400"
    >
      <g strokeWidth={1}>
        {/* Grid line, continuing to the normal busbar */}
        <path d="M2.5 34.5H41.5" />
        {/* Inverter on its grid-input leg; its output feeds input 2 */}
        <path d="M20.5 34.5V18.5" />
        <rect x={14.5} y={6.5} width={12} height={12} />
        <path d="M14.5 18.5L26.5 6.5" />
        <path d="M26.5 12.5H44.5" />
        {/* Changeover: inputs 2 (top) and 1 (bottom), blade, output up to the rail */}
        <circle cx={46.5} cy={12.5} r={2} />
        <circle cx={46.5} cy={23} r={2} />
        <path d="M55.5 18L48.3 22.1" />
        <path d="M55.5 18H60.5V5" />
      </g>
      <circle cx={20.5} cy={34.5} r={1.5} fill="currentColor" stroke="none" />
      <circle cx={55.5} cy={18} r={1.5} fill="currentColor" stroke="none" />
      <path d="M54 4H67" strokeWidth={2} strokeLinecap="butt" />
      <g className="text-sky-600 dark:text-sky-400" strokeWidth={2}>
        {source === 'grid' ? (
          <>
            <path d="M36 34.5V23H44.5" />
            <circle cx={36} cy={34.5} r={2.25} fill="currentColor" stroke="none" />
          </>
        ) : (
          <>
            <path d="M20.5 23H44.5" />
            <circle cx={20.5} cy={23} r={2.25} fill="currentColor" stroke="none" />
          </>
        )}
      </g>
    </svg>
  )
}

/**
 * Where a split-switchable panel's changeover port 1 is fed: the main grid line or the
 * inverter's grid-input leg. Hovering or focusing the other option previews it on the
 * one-wire canvas; choosing it runs one `properties.edit` command.
 */
export function ChangeoverGridSourcePicker({
  panelId,
  readOnly = false,
}: {
  panelId: string
  readOnly?: boolean
}) {
  const { t } = useTranslation()
  const headingId = useId()
  const project = useProjectStore((state: ProjectState) => state.currentProject)
  const setPreview = useUIStore((state) => state.setChangeoverGridSourcePreview)
  const control = useMemo(
    () => (project ? getChangeoverGridSourceControlState(project, panelId) : null),
    [project, panelId]
  )
  const buttons = useRef<Partial<Record<ChangeoverGridSource, HTMLButtonElement | null>>>({})

  // Leaving the control (unmount, other selection) never leaves a preview behind.
  useEffect(
    () => () => {
      if (useUIStore.getState().changeoverGridSourcePreview?.panelId === panelId) setPreview(null)
    },
    [panelId, setPreview]
  )
  const visible = control != null
  useEffect(() => {
    if (!visible || readOnly) setPreview(null)
  }, [readOnly, setPreview, visible])

  if (!control) return null

  const blockerText = t(
    'feedOrganization.inverterGridInputDisconnected',
    'Inverter grid input not connected'
  )
  const isBlocked = (source: ChangeoverGridSource) =>
    readOnly || (source === 'converter-input' && control.converterInputBlocker != null)
  const preview = (source: ChangeoverGridSource) => {
    if (isBlocked(source) || source === control.selected) setPreview(null)
    else setPreview({ panelId, source })
  }
  const choose = (source: ChangeoverGridSource) => {
    setPreview(null)
    if (isBlocked(source) || source === control.selected) return
    editProperties({ actions: [{ kind: 'changeoverGridSource', panelId, source }] })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (!step) return
    event.preventDefault()
    const current = SOURCES.findIndex((source) => buttons.current[source] === document.activeElement)
    const next = SOURCES[(Math.max(current, 0) + step + SOURCES.length) % SOURCES.length]!
    // Arrow keys move focus (and so the preview); Space or Enter applies the focused option.
    buttons.current[next]?.focus()
  }

  return (
    <div className="mt-3">
      <div id={headingId} className="mb-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
        {t('feedOrganization.changeoverInput1', 'Input 1')}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={headingId}
        className="grid grid-cols-2 gap-2"
        onKeyDown={onKeyDown}
        onMouseLeave={() => setPreview(null)}
      >
        {SOURCES.map((source) => {
          const selected = control.selected === source
          const blocked = isBlocked(source)
          const blockedByTopology = source === 'converter-input' && control.converterInputBlocker
          return (
            <button
              key={source}
              ref={(node) => {
                buttons.current[source] = node
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={blocked || undefined}
              tabIndex={selected ? 0 : -1}
              title={blockedByTopology ? blockerText : undefined}
              data-testid={`changeover-grid-source-${source}`}
              className={optionClass(selected, blocked)}
              onMouseEnter={() => preview(source)}
              onFocus={() => preview(source)}
              onBlur={() => setPreview(null)}
              onClick={() => choose(source)}
            >
              <ChangeoverGridSourceIcon source={source} />
              <span className="w-full break-words [hyphens:auto]">
                {source === 'grid'
                  ? t('feedOrganization.changeoverInputGrid', 'Grid')
                  : t('feedOrganization.changeoverInputConverter', 'Inverter supply')}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
