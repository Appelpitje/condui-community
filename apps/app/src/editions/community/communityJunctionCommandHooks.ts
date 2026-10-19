/** Community command seam: preserve offline saved junction data without permitting editor writes. */
export function checkJunctionEditForEdition(_project: unknown, _input: unknown) {
  return {
    ok: false as const,
    code: 'unavailable',
    message: 'Junction editing is unavailable in this edition.',
  }
}

export function applyJunctionEditForEdition(
  _project: unknown,
  _input: unknown,
  _now: string
): never {
  throw new Error('Junction editing is unavailable in this edition.')
}

export function inspectJunctionConnectionsForEdition(
  _project: unknown,
  _assetId: string,
  _offset?: number,
  _limit?: number
): null {
  return null
}

export function checkEnsureJunctionAssetForEdition(_project: unknown, _occurrenceId: string) {
  return {
    ok: false as const,
    code: 'unavailable',
    message: 'Junction editing is unavailable in this edition.',
  }
}

export function applyEnsureJunctionAssetForEdition(
  _project: unknown,
  _occurrenceId: string
): never {
  throw new Error('Junction editing is unavailable in this edition.')
}
