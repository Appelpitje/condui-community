import { z } from 'zod'
import type {
  ValidationCoverageEntry,
  ValidationCoveragePage,
  ValidationCoverageReport,
  ValidationCoverageStatus,
} from './core/types'

export const validationCoverageQuerySchema = z.object({
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  status: z.enum(['passed', 'failed', 'skipped', 'unavailable', 'missing-information']).optional(),
  ruleId: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
}).strict()

export type ValidationCoverageQuery = z.infer<typeof validationCoverageQuerySchema>

function cloneEntry(entry: ValidationCoverageEntry): ValidationCoverageEntry {
  return {
    ruleId: entry.ruleId,
    ...(entry.checkName ? { checkName: entry.checkName } : {}),
    ...(entry.rulePack ? {
      rulePack: {
        id: entry.rulePack.id,
        version: entry.rulePack.version,
        selection: entry.rulePack.selection,
      },
    } : {}),
    scope: { type: entry.scope.type, id: entry.scope.id },
    status: entry.status,
    ...(entry.reason ? { reason: entry.reason } : {}),
    ...(entry.missingFacts ? { missingFacts: [...entry.missingFacts] } : {}),
    issueIds: [...entry.issueIds],
  }
}

function emptyCounts(): Record<ValidationCoverageStatus, number> {
  return {
    passed: 0,
    failed: 0,
    skipped: 0,
    unavailable: 0,
    'missing-information': 0,
  }
}

export function buildValidationCoverageReport(entries: ValidationCoverageEntry[]): ValidationCoverageReport {
  const detachedEntries = entries.map(cloneEntry)
  const counts = emptyCounts()
  for (const entry of detachedEntries) counts[entry.status] += 1
  return { total: detachedEntries.length, counts, entries: detachedEntries }
}

/** Return one bounded page while reporting counts over the complete filtered run. */
export function queryValidationCoverage(
  report: ValidationCoverageReport,
  rawQuery: ValidationCoverageQuery = {}
): ValidationCoveragePage {
  const query = validationCoverageQuerySchema.parse(rawQuery)
  const filtered = report.entries.filter((entry) =>
    (query.status == null || entry.status === query.status) &&
    (query.ruleId == null || entry.ruleId === query.ruleId) &&
    (query.entityId == null || entry.scope.id === query.entityId)
  )
  const counts = emptyCounts()
  for (const entry of filtered) counts[entry.status] += 1
  const offset = query.offset ?? 0
  const limit = query.limit ?? 20
  return {
    total: filtered.length,
    counts,
    offset,
    limit,
    nextOffset: offset + limit < filtered.length ? offset + limit : null,
    entries: filtered.slice(offset, offset + limit).map(cloneEntry),
  }
}
