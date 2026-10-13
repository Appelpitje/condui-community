import type { Point2 } from '@/types/schema'
import { useProjectStore } from '@/stores/projectStore'
import { ensureEarthingSitplanPlacementInProject } from '@/lib/plan/placementMutations'

/**
 * Ensure the earthing symbol exists on the given sitplan floor when ground is enabled.
 * Returns placement id, or null when ground is disabled or there is no project.
 *
 * Kept apart from the pure earthing placement helpers so the validation worker,
 * which reaches those helpers, never loads the project store.
 */
export function ensureEarthingSitplanPlacement(floorId: string, pos?: Point2): string | null {
  let placementId: string | null = null
  useProjectStore.setState((state) => {
    if (!state.currentProject) return
    const result = ensureEarthingSitplanPlacementInProject(state.currentProject, floorId, pos)
    placementId = result?.placementId ?? null
    if (result?.changed) state.isDirty = true
  })
  return placementId
}
