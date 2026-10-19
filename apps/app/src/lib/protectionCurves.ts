import type { CurveType } from '@/types/schema'

/** Characteristics that need a deliberate choice beyond the usual B/C household breakers. */
export function isSpecialistProtectionCurve(curve: CurveType | undefined): boolean {
  return curve != null && curve !== 'B' && curve !== 'C'
}
