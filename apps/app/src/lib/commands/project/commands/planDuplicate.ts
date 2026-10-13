import { z } from 'zod'
import { canDuplicatePlanItems, duplicatePlanItemsInProject } from '@/lib/plan/planDuplicateCore'
import type { ProjectV2 } from '@/types/projectV2'
import { defineProjectCommand, type EntityRef } from '../types'

const point = z.object({ x: z.number().finite(), y: z.number().finite() })

/**
 * Duplicates situation-plan symbols: multiplier symbols (lights and similar) get extra
 * placements; others get a new one-wire endpoint, or a duplicated branch for several
 * endpoints of one circuit, with a placement each. Selects the copies.
 */
export const planDuplicate = defineProjectCommand({
  id: 'plan.duplicate',
  version: 1,
  input: z.object({
    items: z
      .array(z.object({ endpointId: z.string().min(1), placementId: z.string().min(1).optional() }))
      .min(1),
    activeFloorId: z.string().min(1).nullable(),
    fallbackPosition: point.optional(),
    viewportCenter: point.nullable().optional(),
    symbolBaseSizePx: z.number().positive().optional(),
  }),
  check(project, input) {
    return canDuplicatePlanItems(project, input.items)
      ? { ok: true }
      : {
          ok: false,
          code: 'cannot_duplicate',
          message: 'These symbols cannot be duplicated together',
        }
  },
  apply(draft, input) {
    const outcome = duplicatePlanItemsInProject(draft as ProjectV2, input.items, {
      activeFloorId: input.activeFloorId,
      fallbackPosition: input.fallbackPosition ?? { x: 0, y: 0 },
      viewportCenter: input.viewportCenter,
      symbolBaseSizePx: input.symbolBaseSizePx,
    })
    if (!outcome) throw new Error('Nothing could be duplicated')
    const refs: EntityRef[] = outcome.ids.map((id) => ({ kind: outcome.type, id }))
    return { created: refs, changed: [], removed: [], select: refs }
  },
})
