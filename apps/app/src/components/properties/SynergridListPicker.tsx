import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  formatSynergridPower,
  loadSynergridCatalog,
  type SynergridCatalogEntry,
  type SynergridCatalogFocus,
} from '@/lib/synergridCatalog'

interface SynergridListPickerProps {
  open: boolean
  plugAndPlayOnly: boolean
  focus?: SynergridCatalogFocus
  onClose: () => void
  onFill: (entry: SynergridCatalogEntry) => void
}

const INITIAL_VISIBLE_ROWS = 80
const ROW_INCREMENT = 80
const SCROLL_LOAD_THRESHOLD_PX = 120
const SEARCH_DEBOUNCE_MS = 200

function searchableFields(entry: SynergridCatalogEntry): string[] {
  return [
    entry.brandName,
    entry.productSeries,
    entry.modelReference,
    entry.c10Reference,
    entry.phase,
    entry.additionalInformation,
  ].filter((value): value is string => Boolean(value))
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return '-'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function SynergridListPicker({
  open,
  plugAndPlayOnly,
  focus = 'relevant',
  onClose,
  onFill,
}: SynergridListPickerProps) {
  const { t, i18n } = useTranslation()
  const [entries, setEntries] = useState<SynergridCatalogEntry[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_ROWS)
  const [loading, setLoading] = useState(open)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const [requestSource, setRequestSource] = useState({ open, debouncedQuery, focus, plugAndPlayOnly })
  if (requestSource.open !== open || requestSource.debouncedQuery !== debouncedQuery ||
    requestSource.focus !== focus || requestSource.plugAndPlayOnly !== plugAndPlayOnly) {
    setRequestSource({ open, debouncedQuery, focus, plugAndPlayOnly })
    if (requestSource.open !== open && !open) {
      setQuery('')
      setDebouncedQuery('')
    }
    if (open && debouncedQuery.trim().length < 2) {
      setLoading(true)
      setError(null)
    }
    setVisibleLimit(INITIAL_VISIBLE_ROWS)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!open || debouncedQuery.trim().length >= 2) return
    let cancelled = false
    loadSynergridCatalog({ plugAndPlayOnly, focus })
      .then((rows) => {
        if (cancelled) return
        setEntries(rows)
        setSelectedKey((current) => current ?? rows[0]?.sourceKey ?? null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, focus, open, plugAndPlayOnly])

  useEffect(() => {
    if (!open || plugAndPlayOnly || debouncedQuery.trim().length < 2) return
    let cancelled = false
    loadSynergridCatalog({ plugAndPlayOnly: false, includePeripheral: true })
      .then((rows) => {
        if (!cancelled) setEntries(rows)
      })
      .catch(() => {
        // Keep the initial relevant list usable; explicit load errors are shown on initial open.
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, open, plugAndPlayOnly])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  const filteredEntries = useMemo(() => {
    const needle = debouncedQuery.trim()
    if (!needle) return entries
    return entries
      .map((entry) => ({ entry, score: fuzzyEntryScore(entry, needle) }))
      .filter((result): result is { entry: SynergridCatalogEntry; score: number } => result.score != null)
      .sort((a, b) => a.score - b.score)
      .map((result) => result.entry)
  }, [debouncedQuery, entries])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [debouncedQuery, focus, open, plugAndPlayOnly])

  if (open && !filteredEntries.some((entry) => entry.sourceKey === selectedKey)) {
    const nextKey = filteredEntries[0]?.sourceKey ?? null
    if (selectedKey !== nextKey) setSelectedKey(nextKey)
  }

  if (!open) return null

  const selectedEntry = filteredEntries.find((entry) => entry.sourceKey === selectedKey) ?? null
  const visibleEntries = filteredEntries.slice(0, visibleLimit)
  const hasMoreRows = visibleEntries.length < filteredEntries.length

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
      onMouseDown={(event) => {
        if (dialogRef.current?.contains(event.target as Node)) event.stopPropagation()
        else if (dialogRef.current) {
          onClose()
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="synergrid-picker-title"
        className="flex h-[min(760px,calc(100vh-32px))] w-[min(1120px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
      >
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <img
            src="/logos/synergrid_logo_square.png"
            alt=""
            className="h-8 w-8 flex-shrink-0 object-contain"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <h2
              id="synergrid-picker-title"
              className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
            >
              {t('synergrid.picker.title', 'Synergrid C10/26 approved list')}
            </h2>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
              {t(
                'synergrid.picker.subtitle',
                'Pick an entry from the official list and use it to fill the properties.'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:ring-2 focus:ring-sky-500 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            title={t('common.close', 'Close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              placeholder={t('synergrid.picker.searchPlaceholder', 'Search brand, model or reference')}
            />
          </div>
          {plugAndPlayOnly ? (
            <div className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-700 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200">
              {t('synergrid.picker.plugAndPlayOnly', 'Plug-and-play only')}
            </div>
          ) : null}
        </div>

        <div
          ref={scrollRef}
          data-library-scroll="true"
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
          onScroll={(event) => {
            const target = event.currentTarget
            const distanceFromBottom =
              target.scrollHeight - target.scrollTop - target.clientHeight
            if (distanceFromBottom <= SCROLL_LOAD_THRESHOLD_PX && hasMoreRows) {
              setVisibleLimit((current) =>
                Math.min(current + ROW_INCREMENT, filteredEntries.length)
              )
            }
          }}
        >
          {loading ? (
            <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
              {t('synergrid.picker.loading', 'Loading Synergrid list...')}
            </div>
          ) : error ? (
            <div className="px-4 py-6 text-sm text-red-600 dark:text-red-300">
              {t('synergrid.picker.error', 'Could not load the Synergrid list')}: {error}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
              {t('synergrid.picker.empty', 'No matching entries')}
            </div>
          ) : (
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 text-xs font-semibold uppercase text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <tr>
                  <th className="w-[15%] px-3 py-2">
                    {t('synergrid.picker.columns.brand', 'Brand')}
                  </th>
                  <th className="w-[17%] px-3 py-2">
                    {t('synergrid.picker.columns.productSeries', 'Product series')}
                  </th>
                  <th className="w-[24%] px-3 py-2">
                    {t('synergrid.picker.columns.model', 'Model')}
                  </th>
                  <th className="w-[8%] px-3 py-2">
                    {t('synergrid.picker.columns.power', 'Power')}
                  </th>
                  <th className="w-[8%] px-3 py-2">
                    {t('synergrid.picker.columns.phase', 'Phase')}
                  </th>
                  <th className="w-[13%] px-3 py-2">
                    {t('synergrid.picker.columns.type', 'Type')}
                  </th>
                  <th className="w-[8%] px-3 py-2">
                    {t('synergrid.picker.columns.approved', 'Approved')}
                  </th>
                  <th className="w-[7%] px-3 py-2">
                    {t('synergrid.picker.columns.reference', 'Reference')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((entry) => {
                  const active = entry.sourceKey === selectedKey
                  const power = formatSynergridPower(entry.ratedActivePowerW) || '-'
                  const phase = formatPhase(entry.phase, t)
                  const type = formatEntryType(entry, t)
                  const approvalDate = formatDate(entry.synergridApprovalDate, i18n.language)
                  return (
                    <tr
                      key={entry.sourceKey}
                      onClick={() => setSelectedKey(entry.sourceKey)}
                      onDoubleClick={() => {
                        onFill(entry)
                        onClose()
                      }}
                      className={`cursor-pointer border-t border-gray-100 dark:border-gray-800 ${
                        active
                          ? 'bg-sky-50 text-sky-950 dark:bg-sky-950/50 dark:text-sky-100'
                          : 'text-gray-800 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      <td className="truncate px-3 py-2" title={entry.brandName ?? undefined}>
                        {entry.brandName ?? '-'}
                      </td>
                      <td className="truncate px-3 py-2" title={entry.productSeries ?? undefined}>
                        {entry.productSeries ?? '-'}
                      </td>
                      <td className="truncate px-3 py-2" title={entry.modelReference ?? undefined}>
                        {entry.modelReference ?? '-'}
                      </td>
                      <td className="truncate px-3 py-2" title={power}>
                        {power}
                      </td>
                      <td className="truncate px-3 py-2" title={phase}>
                        {phase}
                      </td>
                      <td className="truncate px-3 py-2" title={type}>
                        {type}
                      </td>
                      <td className="truncate px-3 py-2" title={approvalDate}>
                        {approvalDate}
                      </td>
                      <td className="truncate px-3 py-2 font-mono text-xs" title={entry.c10Reference}>
                        {entry.c10Reference}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('synergrid.picker.resultCount', '{{count}} entries', {
              count: filteredEntries.length,
            })}
            {hasMoreRows
              ? ` ${t('synergrid.picker.resultVisible', 'showing {{visible}} of {{count}}', {
                  visible: visibleEntries.length,
                  count: filteredEntries.length,
                })}`
              : ''}
          </p>
          <button
            type="button"
            disabled={!selectedEntry}
            onClick={() => {
              if (!selectedEntry) return
              onFill(selectedEntry)
              onClose()
            }}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
          >
            {t('synergrid.picker.fill', 'Fill')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function normalizeSearchValue(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function compactSearchValue(value: string): string {
  return normalizeSearchValue(value).replace(/\s+/g, '')
}

function fuzzyEntryScore(entry: SynergridCatalogEntry, query: string): number | null {
  const queryText = normalizeSearchValue(query)
  if (!queryText) return 0

  const fields = searchableFields(entry)
  let bestScore: number | null = null
  for (const [index, field] of fields.entries()) {
    const fieldScore = fuzzyTextScore(field, queryText)
    if (fieldScore == null) continue
    const score = fieldScore + index * 0.05
    if (score != null && (bestScore == null || score < bestScore)) {
      bestScore = score
    }
  }
  return bestScore
}

function fuzzyTextScore(value: string, normalizedQuery: string): number | null {
  const text = normalizeSearchValue(value)
  const compactText = compactSearchValue(value)
  const compactQuery = normalizedQuery.replace(/\s+/g, '')
  if (!text || !compactQuery) return null
  if (text === normalizedQuery || compactText === compactQuery) return 0
  if (text.includes(normalizedQuery) || compactText.includes(compactQuery)) return 1

  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean)
  const textTokens = text.split(/\s+/).filter(Boolean)
  let score = 2

  for (const token of queryTokens) {
    const tokenScore = fuzzyTokenScore(token, textTokens, compactText)
    if (tokenScore == null) return null
    score += tokenScore
  }

  return score
}

function fuzzyTokenScore(
  token: string,
  textTokens: string[],
  compactText: string
): number | null {
  const compactToken = token.replace(/\s+/g, '')
  if (compactText.includes(compactToken)) return 0
  if (compactToken.length < 3) return null

  let bestScore: number | null = null
  for (const textToken of textTokens) {
    let score: number | null = null
    if (textToken.includes(compactToken)) {
      score = 0
    } else if (withinTypoTolerance(compactToken, textToken)) {
      score = 1
    } else if (isOrderedSubsequence(compactToken, textToken)) {
      score = 2
    }

    if (score != null && (bestScore == null || score < bestScore)) {
      bestScore = score
    }
  }

  if (bestScore != null) return bestScore
  return isOrderedSubsequence(compactToken, compactText) ? 3 : null
}

function withinTypoTolerance(query: string, candidate: string): boolean {
  if (Math.abs(query.length - candidate.length) > 2) return false
  const tolerance = query.length >= 7 ? 2 : 1
  return levenshteinDistance(query, candidate, tolerance) <= tolerance
}

function levenshteinDistance(a: string, b: string, maxDistance: number): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(
        (previous[j] ?? Number.POSITIVE_INFINITY) + 1,
        (current[j - 1] ?? Number.POSITIVE_INFINITY) + 1,
        (previous[j - 1] ?? Number.POSITIVE_INFINITY) + cost
      )
      current[j] = value
      rowMin = Math.min(rowMin, value)
    }
    if (rowMin > maxDistance) return rowMin
    previous = current
  }
  return previous[b.length] ?? Number.POSITIVE_INFINITY
}

function isOrderedSubsequence(query: string, candidate: string): boolean {
  let queryIndex = 0
  for (let index = 0; index < candidate.length && queryIndex < query.length; index += 1) {
    if (candidate[index] === query[queryIndex]) queryIndex += 1
  }
  return queryIndex === query.length
}

function formatEntryType(
  entry: SynergridCatalogEntry,
  t: TFunction
): string {
  const parts: string[] = []
  if (entry.applicationSolarEnergy) parts.push(t('synergrid.types.solar', 'Solar'))
  if (entry.applicationEnergyStorage) parts.push(t('synergrid.types.storage', 'Storage'))
  if (entry.applicationBackupPowerSystem) parts.push(t('synergrid.types.backup', 'Backup'))
  if (entry.applicationWindEnergy) parts.push(t('synergrid.types.wind', 'Wind'))
  if (entry.applicationChp) parts.push(t('synergrid.types.chp', 'CHP'))
  if (entry.applicationOther) parts.push(entry.applicationOther)
  if (parts.length === 0) return '-'
  if (parts.length === 1) return parts[0]!
  return parts.join(' + ')
}

function formatPhase(value: string | null, t: TFunction): string {
  if (!value) return '-'
  const normalized = value.toLowerCase()
  if (normalized === '1-phase' || normalized === '1 phase') {
    return t('synergrid.phases.single', '1-phase')
  }
  if (normalized === '3-phase' || normalized === '3 phase') {
    return t('synergrid.phases.three', '3-phase')
  }
  return value
}
