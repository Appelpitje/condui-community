import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  loadInspectionAgencyCatalog,
  type InspectionAgencyCatalogEntry,
} from '@/lib/inspectionAgencyCatalog'

interface InspectionAgencyPickerProps {
  open: boolean
  onClose: () => void
  onFill: (entry: InspectionAgencyCatalogEntry) => void
}

function normalizeSearchValue(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function entryMatches(entry: InspectionAgencyCatalogEntry, query: string): boolean {
  const needle = normalizeSearchValue(query)
  if (!needle) return true
  const haystack = normalizeSearchValue(
    [
      entry.name,
      entry.city,
      entry.companyNumber,
      entry.email,
      entry.phone,
      entry.website,
      entry.activityDomains.join(' '),
    ]
      .filter(Boolean)
      .join(' ')
  )
  return needle.split(/\s+/).every((token) => haystack.includes(token))
}

export function InspectionAgencyPicker({ open, onClose, onFill }: InspectionAgencyPickerProps) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<InspectionAgencyCatalogEntry[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(open)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const [requestOpen, setRequestOpen] = useState(open)
  if (requestOpen !== open) {
    setRequestOpen(open)
    if (open) {
      setLoading(true)
      setError(null)
    } else setQuery('')
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    loadInspectionAgencyCatalog()
      .then((rows) => {
        if (cancelled) return
        setEntries(rows)
        setSelectedKey((current) => current ?? rows[0]?.sourceKey ?? null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  const filteredEntries = useMemo(
    () => entries.filter((entry) => entryMatches(entry, query)),
    [entries, query]
  )

  if (open && !filteredEntries.some((entry) => entry.sourceKey === selectedKey)) {
    const nextKey = filteredEntries[0]?.sourceKey ?? null
    if (selectedKey !== nextKey) setSelectedKey(nextKey)
  }

  if (!open) return null

  const selectedEntry = filteredEntries.find((entry) => entry.sourceKey === selectedKey) ?? null

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
      onMouseDown={(event) => {
        if (dialogRef.current?.contains(event.target as Node)) event.stopPropagation()
        else if (dialogRef.current) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inspection-agency-picker-title"
        className="flex h-[min(680px,calc(100vh-32px))] w-[min(980px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
      >
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="min-w-0 flex-1">
            <h2
              id="inspection-agency-picker-title"
              className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
            >
              {t('inspectionAgencies.picker.title', 'Approved inspection agencies')}
            </h2>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
              {t(
                'inspectionAgencies.picker.subtitle',
                'Pick an approved agency and fill the inspection info box.'
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

        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              placeholder={t(
                'inspectionAgencies.picker.searchPlaceholder',
                'Search name, city, KBO, email or domain'
              )}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          {loading ? (
            <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
              {t('inspectionAgencies.picker.loading', 'Loading approved agencies...')}
            </div>
          ) : error ? (
            <div className="px-4 py-6 text-sm text-red-600 dark:text-red-300">
              {t('inspectionAgencies.picker.error', 'Could not load inspection agencies')}: {error}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
              {t('inspectionAgencies.picker.empty', 'No matching agencies')}
            </div>
          ) : (
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 text-xs font-semibold uppercase text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <tr>
                  <th className="w-[26%] px-3 py-2">
                    {t('inspectionAgencies.picker.columns.name', 'Name')}
                  </th>
                  <th className="w-[16%] px-3 py-2">
                    {t('inspectionAgencies.picker.columns.city', 'City')}
                  </th>
                  <th className="w-[14%] px-3 py-2">
                    {t('inspectionAgencies.picker.columns.companyNumber', 'KBO')}
                  </th>
                  <th className="w-[22%] px-3 py-2">
                    {t('inspectionAgencies.picker.columns.email', 'Email')}
                  </th>
                  <th className="w-[12%] px-3 py-2">
                    {t('inspectionAgencies.picker.columns.phone', 'Phone')}
                  </th>
                  <th className="w-[10%] px-3 py-2">
                    {t('inspectionAgencies.picker.columns.domains', 'Domains')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => {
                  const active = entry.sourceKey === selectedKey
                  const domains = entry.activityDomains.join(', ') || '-'
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
                      <td className="truncate px-3 py-2" title={entry.name}>
                        {entry.name}
                      </td>
                      <td className="truncate px-3 py-2" title={entry.city ?? undefined}>
                        {entry.city ?? '-'}
                      </td>
                      <td className="truncate px-3 py-2 font-mono text-xs" title={entry.companyNumber ?? undefined}>
                        {entry.companyNumber ?? '-'}
                      </td>
                      <td className="truncate px-3 py-2" title={entry.email ?? undefined}>
                        {entry.email ?? '-'}
                      </td>
                      <td className="truncate px-3 py-2" title={entry.phone ?? undefined}>
                        {entry.phone ?? '-'}
                      </td>
                      <td className="truncate px-3 py-2" title={domains}>
                        {domains}
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
            {t('inspectionAgencies.picker.resultCount', '{{count}} agencies', {
              count: filteredEntries.length,
            })}
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
            {t('inspectionAgencies.picker.fill', 'Fill')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
