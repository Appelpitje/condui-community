/**
 * Readable text for anything an export step can throw. Libraries such as svg2pdf
 * reject with raw DOM events (an XMLHttpRequest `ProgressEvent`), which would
 * otherwise read as "[object XMLHttpRequestProgressEvent]".
 */
export function describeExportError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof Event !== 'undefined' && error instanceof Event) {
    const target = error.target as { responseURL?: string; status?: number } | null
    const url = target?.responseURL ? ` ${target.responseURL.slice(0, 80)}` : ''
    const status = target?.status ? ` status ${target.status}` : ''
    return `${error.constructor.name} "${error.type}"${status}${url}`.trim()
  }
  return String(error)
}
