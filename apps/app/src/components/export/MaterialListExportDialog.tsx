import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2 } from 'lucide-react'
import { useHardwareTally } from '@/hooks/useHardwareTally'
import { useProjectStore } from '@/stores/projectStore'
import { useDialogStore } from '@/stores/dialogStore'
import {
  buildMaterialListTable,
  DEFAULT_CABLE_MARGIN_PERCENT,
  isValidCableMarginPercent,
  type MaterialListPreset,
} from '@/lib/tally/materialListExport'
import { tableToXlsx, tableToCsv, XLSX_MIME_TYPE } from '@/utils/tabularWorkbook'
import { downloadBlob } from '@/utils/downloadBlob'
import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import { buildTimestampedExportFilename } from '@/lib/export/exportFilename'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import { logger } from '@/lib/logger'

type Format = 'xlsx' | 'csv'
let retainedSettings = {
  preset: 'standard' as MaterialListPreset,
  format: 'xlsx' as Format,
  includePlanEstimates: true,
  roundCableLengths: false,
  skipSupplyPanel: true,
  cableMarginPercent: DEFAULT_CABLE_MARGIN_PERCENT,
}

export function MaterialListExportDialog() {
  const { t, i18n } = useTranslation()
  const ownerWindow = useCanvasWindow()
  const project = useProjectStore((s) => s.currentProject)
  const close = useDialogStore((s) => s.closeDialog)
  const [settings, setSettings] = useState(retainedSettings)
  const [cableMarginInput, setCableMarginInput] = useState(() =>
    String(retainedSettings.cableMarginPercent)
  )
  const [excludedCategories, setExcludedCategories] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const data = useHardwareTally(settings.includePlanEstimates, settings.skipSupplyPanel)
  const categoryIds = useMemo(
    () => data.filter((c) => !excludedCategories.includes(c.id)).map((c) => c.id),
    [data, excludedCategories]
  )
  const cablesSelected = data.some(
    (category) => category.lengthsOnly && categoryIds.includes(category.id)
  )
  const marginInvalid =
    cableMarginInput.trim() === '' || !isValidCableMarginPercent(Number(cableMarginInput))
  const { table, missingCableRuns } = useMemo(
    () =>
      buildMaterialListTable(
        data,
        {
          ...settings,
          categoryIds,
        },
        {
          category: t('tally.csvCategory'),
          description: t('materialListExport.description'),
          quantity: t('materialListExport.quantity'),
          unit: t('materialListExport.unit'),
          details: t('tally.csvDetails'),
          piece: t('materialListExport.piece'),
          estimated: t('materialListExport.estimated'),
          partialLength: t('materialListExport.partialLength'),
        },
        t
      ),
    [data, settings, categoryIds, t]
  )
  const change = (patch: Partial<typeof settings>) => {
    const next = { ...settings, ...patch }
    retainedSettings = next
    setSettings(next)
  }
  const robaws = settings.preset === 'robaws'
  const exportFile = async () => {
    if (!project || table.rows.length === 0 || busy || (cablesSelected && marginInvalid)) return
    setBusy(true)
    setError(false)
    try {
      const format = robaws ? 'xlsx' : settings.format
      const blob =
        format === 'xlsx'
          ? new Blob([await tableToXlsx(table, robaws ? 'Meetstaat' : t('tally.title'))], {
              type: XLSX_MIME_TYPE,
            })
          : new Blob([tableToCsv(table, i18n.resolvedLanguage ?? i18n.language)], {
              type: 'text/csv;charset=utf-8',
            })
      downloadBlob(
        blob,
        buildTimestampedExportFilename(
          `${project.project.name || 'Condui'}-${robaws ? 'robaws-meetstaat' : 'material-list'}`,
          format
        ),
        ownerWindow.document
      )
      trackGoogleAnalyticsEvent('hardware_tally_export', {
        preset: settings.preset,
        format,
        row_count: table.rows.length,
      })
    } catch (cause) {
      logger.error('Material list export failed', cause)
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  const selectClass =
    'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
  return (
    <div
      className="space-y-4 text-gray-900 dark:text-gray-100"
      data-testid="material-list-export-dialog"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium">
          <span>{t('materialListExport.preset')}</span>
          <select
            className={selectClass}
            aria-label={t('materialListExport.preset')}
            value={settings.preset}
            disabled={busy}
            onChange={(event) => change({ preset: event.target.value as MaterialListPreset })}
          >
            <option value="standard">{t('materialListExport.standard')}</option>
            <option value="robaws">Robaws — meetstaat</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>{t('materialListExport.format')}</span>
          <select
            className={selectClass}
            aria-label={t('materialListExport.format')}
            value={robaws ? 'xlsx' : settings.format}
            disabled={busy || robaws}
            onChange={(event) => change({ format: event.target.value as Format })}
          >
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV (.csv)</option>
          </select>
        </label>
      </div>
      {robaws && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('materialListExport.robawsImport')}
        </p>
      )}
      <fieldset disabled={busy}>
        <legend className="mb-2 text-sm font-medium">{t('materialListExport.categories')}</legend>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {data.map((category) => (
            <label key={category.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-sky-600"
                checked={categoryIds.includes(category.id)}
                onChange={(event) =>
                  setExcludedCategories((previous) =>
                    event.target.checked
                      ? previous.filter((id) => id !== category.id)
                      : [...previous, category.id]
                  )
                }
              />
              {t(category.labelKey)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset
        disabled={busy}
        className="space-y-2 border-t border-gray-200 pt-3 text-sm dark:border-gray-700"
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="accent-sky-600"
            checked={settings.skipSupplyPanel}
            onChange={(event) => change({ skipSupplyPanel: event.target.checked })}
          />
          {t('materialListExport.skipSupplyPanel')}
        </label>
        {data.some((c) => c.lengthsOnly) && (
          <fieldset disabled={busy || !cablesSelected} className="space-y-2 disabled:opacity-50">
            <label className="flex items-center justify-between gap-3">
              <span>{t('materialListExport.cableMargin')}</span>
              <input
                type="number"
                min={0}
                max={Number.MAX_SAFE_INTEGER}
                step="any"
                value={cableMarginInput}
                aria-invalid={cablesSelected && marginInvalid}
                aria-describedby={
                  cablesSelected && marginInvalid ? 'cable-margin-error' : undefined
                }
                onChange={(event) => {
                  const value = event.target.value
                  setCableMarginInput(value)
                  if (value.trim() !== '' && isValidCableMarginPercent(Number(value))) {
                    change({ cableMarginPercent: Number(value) })
                  }
                }}
                className="w-24 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-right tabular-nums dark:border-gray-600 dark:bg-gray-800"
              />
            </label>
            {cablesSelected && marginInvalid && (
              <p
                id="cable-margin-error"
                role="alert"
                className="text-sm text-red-600 dark:text-red-400"
              >
                {t('materialListExport.invalidCableMargin')}
              </p>
            )}
            {isCableRoutesEnabled() && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-sky-600"
                  checked={settings.includePlanEstimates}
                  onChange={(event) => change({ includePlanEstimates: event.target.checked })}
                />
                {t('materialListExport.includePlanEstimates')}
              </label>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-sky-600"
                checked={settings.roundCableLengths}
                onChange={(event) => change({ roundCableLengths: event.target.checked })}
              />
              {t('materialListExport.roundCableLengths')}
            </label>
          </fieldset>
        )}
      </fieldset>
      {missingCableRuns > 0 && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
          {t('materialListExport.missingLengths')}
        </p>
      )}
      <div
        className="max-h-64 overflow-auto rounded-md border border-gray-200 dark:border-gray-700"
        data-app-scroll="true"
      >
        <table className="w-full text-left text-xs" data-testid="material-list-export-preview">
          <thead className="sticky top-0 bg-gray-100 dark:bg-gray-800">
            <tr>
              {table.headers.map((header) => (
                <th key={header} scope="col" className="px-3 py-2 font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index} className="border-t border-gray-100 dark:border-gray-700">
                {row.map((cell, col) => (
                  <td
                    key={col}
                    className={`whitespace-pre-line px-3 py-2 ${typeof cell === 'number' ? 'text-right tabular-nums' : ''}`}
                  >
                    {typeof cell === 'number'
                      ? cell.toLocaleString(i18n.resolvedLanguage ?? i18n.language, {
                          maximumFractionDigits: 2,
                        })
                      : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {table.rows.length === 0 && (
          <p className="p-4 text-sm text-gray-500">{t('materialListExport.empty')}</p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t('materialListExport.error')}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
        <button
          type="button"
          onClick={close}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm dark:border-gray-600"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          disabled={
            busy || !project || table.rows.length === 0 || (cablesSelected && marginInvalid)
          }
          onClick={() => void exportFile()}
          className="flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Download className="h-4 w-4" aria-hidden />
          )}
          {t('materialListExport.export')}
        </button>
      </div>
    </div>
  )
}
