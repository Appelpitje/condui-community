import { editProperties } from '@/handlers/properties/editProperties'
import type { TFunction } from 'i18next'
import type { Circuit, SymbolKey } from '@/types/schema'
import type { SynergridCatalogFocus } from '@/lib/synergridCatalog'
import {
  getInstallDateTargetInheritedYear,
  type InstallDateTarget,
} from '@/lib/installDatePropagation'
import {
  getInstallYearColorKey,
  pickInstallYearColor,
} from '@/lib/installDates'
import { type ProjectState } from '@/stores/projectStore'

export const selectClass =
  'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500'

export const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

export const visibilityToggleClass = (enabled: boolean) =>
  enabled
    ? 'one-wire-visibility-toggle p-1 rounded border border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-600 dark:bg-sky-900/30 dark:text-sky-300 hover:border-gray-300 hover:bg-gray-100 hover:text-gray-600 dark:hover:border-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300 transition-colors [&_svg]:w-3.5 [&_svg]:h-3.5'
    : 'one-wire-visibility-toggle p-1 rounded border border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400 hover:border-sky-300 hover:bg-sky-100 hover:text-sky-700 dark:hover:border-sky-600 dark:hover:bg-sky-900/30 dark:hover:text-sky-300 transition-colors [&_svg]:w-3.5 [&_svg]:h-3.5'

/** i18next may return rich-text objects; panel chrome always needs plain strings. */
export function panelT(t: TFunction, key: string, defaultValue?: string): string {
  return (defaultValue === undefined ? t(key) : t(key, defaultValue)) as string
}

export function panelStringT(t: TFunction): (key: string, defaultValue?: string) => string {
  return (key, defaultValue) => panelT(t, key, defaultValue)
}

export function getSynergridFocusForCircuit(
  circuit: Circuit | undefined | null,
  symbol?: SymbolKey
): SynergridCatalogFocus {
  const endpointSymbols = circuit?.endpoints?.map((endpoint) => endpoint.symbol) ?? []
  const hasSolar = endpointSymbols.includes('solar_panel')
  const hasBattery = endpointSymbols.includes('battery')
  if (hasSolar && hasBattery) return 'solarAndStorage'
  if (hasSolar) return 'solar'
  if (hasBattery) return 'storage'
  if (symbol === 'inverter') return 'solar'
  if (symbol === 'rectifier') return 'storage'
  return 'relevant'
}

type Project = NonNullable<ProjectState['currentProject']>

export function ensureInstallDateTargetColors(
  project: Project | null | undefined,
  targets: InstallDateTarget[],
  year: number | undefined
): void {
  if (!project) return
  let nextColors = project.project.installDateColors ?? {}
  let changedColors = false
  for (const target of targets) {
    const inheritedYear = getInstallDateTargetInheritedYear(project, target)
    const requestedYear = target.preserveYear ?? year
    if (
      target.clearOverride ||
      requestedYear == null ||
      (!target.forceOverride && requestedYear === inheritedYear)
    ) continue
    const key = getInstallYearColorKey(requestedYear)
    if (nextColors[key]) continue
    nextColors = {
      ...nextColors,
      [key]: pickInstallYearColor(nextColors),
    }
    changedColors = true
  }
  if (changedColors) {
    editProperties({ seedInstallDateColors: { targets, year } })
  }
}
