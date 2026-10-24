import type { TallyData } from './buildHardwareTally'
import type { ExportTable } from '@/utils/tabularWorkbook'

export type MaterialListPreset = 'standard' | 'robaws'
export const DEFAULT_CABLE_MARGIN_PERCENT = 30

export function isValidCableMarginPercent(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
}

export interface MaterialListExportOptions {
  preset: MaterialListPreset
  categoryIds: string[]
  roundCableLengths: boolean
  cableMarginPercent: number
}

export interface MaterialListExportLabels {
  category: string
  description: string
  quantity: string
  unit: string
  details: string
  piece: string
  estimated: string
  partialLength: string
}

/** One row per tally group, never per detail: detail rows repeat the group's total count. */
export function buildMaterialListTable(
  data: TallyData,
  options: MaterialListExportOptions,
  labels: MaterialListExportLabels,
  translate: (key: string) => string
): { table: ExportTable; missingCableRuns: number } {
  if (!isValidCableMarginPercent(options.cableMarginPercent)) {
    throw new RangeError('Cable margin must be a valid non-negative percentage')
  }
  const robaws = options.preset === 'robaws'
  // Robaws' in-offer "Upload" maps these columns; this is not its articles import template.
  // https://support.robaws.com/nl/article/meetstaat-uploaden-in-offerte-1evshtx/
  const table: ExportTable = {
    headers: robaws
      ? ['Omschrijving', 'Aantal', 'Eenheid']
      : [labels.category, labels.description, labels.quantity, labels.unit, labels.details],
    rows: [],
    widths: robaws ? [72, 14, 14] : [24, 60, 14, 14, 60],
  }
  let missingCableRuns = 0
  for (const category of data) {
    if (!options.categoryIds.includes(category.id)) continue
    for (const group of category.groups) {
      const cable = category.lengthsOnly === true
      if (cable)
        missingCableRuns += group.missingLengthCount ?? (group.totalLengthM ? 0 : group.count)
      const rawQuantity = cable ? (group.totalLengthM ?? 0) : group.count
      if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) continue
      const adjustedQuantity = cable
        ? (rawQuantity * (100 + options.cableMarginPercent)) / 100
        : rawQuantity
      const quantity = cable
        ? options.roundCableLengths
          ? Math.ceil(adjustedQuantity)
          : Math.round(adjustedQuantity * 100) / 100
        : rawQuantity
      // Do not round a known, short cable down to a zero-quantity line.
      const exportQuantity = cable ? Math.max(0.01, quantity) : quantity
      const details = cable ? [] : [...(group.specLines ?? [])]
      if (cable && group.lengthIncludesEstimates) details.push(labels.estimated)
      if (cable && group.missingLengthCount) details.push(labels.partialLength)
      const description = [group.summaryLabel, ...(robaws ? details : [])].join(' — ')
      const unit = cable ? 'm' : robaws ? 'stuk' : labels.piece
      table.rows.push(
        robaws
          ? [description, exportQuantity, unit]
          : [translate(category.labelKey), description, exportQuantity, unit, details.join('\n')]
      )
    }
  }
  return { table, missingCableRuns }
}
