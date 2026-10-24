import type { LabelScheme } from '@/types/schema'
import { CLASSIC_LABEL_SCHEME, resolveLabelScheme } from './labelScheme'

/**
 * Label scheme used by naming helpers that only see a circuit, not the project (branch and
 * domotica output relabelling after topology edits). The project store registers a resolver for
 * the open project; a full naming pass pins its own scheme with {@link withLabelScheme} so it
 * never depends on store timing. Without either, labels use the classic scheme.
 */
let resolveStoredScheme: () => unknown = () => undefined
const pinnedSchemes: LabelScheme[] = []

export function registerActiveLabelSchemeResolver(resolver: () => unknown): void {
  resolveStoredScheme = resolver
}

export function getActiveLabelScheme(): LabelScheme {
  const pinned = pinnedSchemes[pinnedSchemes.length - 1]
  if (pinned) return pinned
  return resolveLabelScheme(resolveStoredScheme()) ?? CLASSIC_LABEL_SCHEME
}

export function withLabelScheme<T>(scheme: LabelScheme, run: () => T): T {
  pinnedSchemes.push(scheme)
  try {
    return run()
  } finally {
    pinnedSchemes.pop()
  }
}
