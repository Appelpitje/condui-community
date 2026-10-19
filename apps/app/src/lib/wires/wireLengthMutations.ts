import { estimateCableRoutes } from '@/lib/cableRouting/estimateCableRoutes'
import { findWireRunForAnchor, selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import type { ProjectV2 } from '@/types/projectV2'
import type { CableSpec } from '@/types/schema'
import { editWireRunAtAnchor } from './editWireRun'

export interface AcceptedWireLengthEstimate {
  anchor: string
  cable: CableSpec
  lengthM: number
}

/** Persist reviewed plan estimates as measured-per-anchor wire lengths. */
export function acceptWireLengthEstimatesInProject(
  project: ProjectV2,
  entries: readonly AcceptedWireLengthEstimate[],
  newId?: () => string
): boolean {
  if (entries.length === 0) return false
  const calibratedAnchors = new Set(
    estimateCableRoutes(project)
      .routes.filter((route) => route.scaleCalibrated !== false && route.highM > 0)
      .flatMap((route) => [route.anchor, ...(route.aliasAnchors ?? [])])
  )
  const runs = selectProjectWireRuns(project)
  let changed = false
  for (const entry of entries) {
    if (!calibratedAnchors.has(entry.anchor)) continue
    const existing = findWireRunForAnchor(runs, entry.anchor)
    if (
      existing?.segmentLengths?.[entry.anchor] === entry.lengthM &&
      existing.segmentLengthSources?.[entry.anchor] === 'estimated'
    )
      continue
    editWireRunAtAnchor(
      project,
      entry.anchor,
      entry.cable,
      {
        lengthM: entry.lengthM,
        lengthSource: 'estimated',
      },
      newId
    )
    changed = true
  }
  return changed
}
