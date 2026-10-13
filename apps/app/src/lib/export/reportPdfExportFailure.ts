import { reportCrash } from '@/lib/crashReporting/reportCrash'
import { describeExportError } from '@/lib/export/describeExportError'
import { ExportError, type ExportDiagnostic, type ExportOptions } from '@/lib/export/types'

function optionsSummary(options: ExportOptions): string {
  return [
    `eendraad=${options.includeEendraad}`,
    `sitplan=${options.includeSitplan}`,
    `panel=${options.includePanel}`,
    `mode=${options.outputMode}`,
    `theme=${options.theme}`,
  ].join(' ')
}

/** Appends the crash report id to a user-facing message so support can find the report. */
export function withCrashId(message: string, crashId: string | undefined): string {
  return crashId ? `${message}\n\nID: ${crashId}` : message
}

/**
 * PDF export is critical: report every failed page or failed export to ops.
 * Returns the crash id to show the user, when a report was sent.
 */
export function reportPdfExportFailure(input: {
  options: ExportOptions
  diagnostics?: ExportDiagnostic[]
  error?: unknown
}): string | undefined {
  const diagnostics =
    input.diagnostics ??
    (input.error instanceof ExportError ? input.error.diagnostics : undefined)
  const failedPages = (diagnostics ?? []).filter((d) => d.level === 'error')
  if (!input.error && failedPages.length === 0) return undefined

  const summary = input.error
    ? `pdf_export failed: ${describeExportError(input.error)}`
    : `pdf_export completed with ${failedPages.length} page error(s)`
  const pageLines = failedPages.map(
    (d) => `- ${d.code} page=${d.pageId ?? '?'}: ${d.message}`
  )

  return reportCrash({
    errorType: 'manual',
    message: [summary, `(${optionsSummary(input.options)})`, ...pageLines].join('\n'),
    stack: input.error instanceof Error ? input.error.stack : undefined,
  })
}
