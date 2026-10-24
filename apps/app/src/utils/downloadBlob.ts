/** Download in the invoking window, including detached editor windows. */
export function downloadBlob(blob: Blob, filename: string, ownerDocument: Document): void {
  const url = URL.createObjectURL(blob)
  const anchor = ownerDocument.createElement('a')
  anchor.href = url
  anchor.download = filename
  ownerDocument.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
