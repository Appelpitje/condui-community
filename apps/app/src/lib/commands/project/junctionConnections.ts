import type { ProjectV2 } from '@/types/projectV2'
import { inspectJunctionConnectionsForEdition } from '@/lib/junction/junctionCommandHooks'

/** Compact, bounded stable refs for repairing junction findings without returning project data. */
export function inspectJunctionConnections(
  project: ProjectV2,
  assetId: string,
  options: { offset?: number; limit?: number } = {}
) {
  const result = inspectJunctionConnectionsForEdition(
    project,
    assetId,
    options.offset,
    options.limit
  )
  return result ? (JSON.parse(JSON.stringify(result)) as typeof result) : null
}
