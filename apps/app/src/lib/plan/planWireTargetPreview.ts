import {
  buildManualOtherPlanWireRoute,
  buildManualPlanWireRoutesForPlacementMove,
} from './planWiring'

/** Reuse eligibility while the pointer stays on a target; commits still validate afresh. */
export function createPlanWireTargetPreviewQuery(
  project: Parameters<typeof buildManualOtherPlanWireRoute>[0] | null,
  floorId: string | null,
  sourceId: string | null,
  keepAutoSpans: boolean
) {
  const results = new Map<string, boolean>()
  return (targetId: string): boolean => {
    if (!project || !floorId || !sourceId || sourceId === targetId) return false
    if (!results.has(targetId)) {
      const route =
        buildManualOtherPlanWireRoute(project, floorId, sourceId, targetId) ??
        buildManualPlanWireRoutesForPlacementMove(project, floorId, sourceId, targetId, {
          keepAutoSpans,
        })
      results.set(targetId, !!route)
    }
    return results.get(targetId)!
  }
}
