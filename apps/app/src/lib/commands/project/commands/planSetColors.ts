import { z } from 'zod'
import { planCategoryColor } from '@/lib/plan/planColors'
import type { SitplanSymbolCategory } from '@/lib/plan/symbolCategories'
import { defineProjectCommand } from '../types'
import {
  replacePlanWiringVisibilityForProject,
  selectProjectPlanWiringVisibility,
} from '@/lib/projectV2/planWiring'

const color = z.string().regex(/^#[0-9a-f]{6}$/i)

export const planSetColors = defineProjectCommand({
  id: 'plan.setColors',
  version: 1,
  input: z
    .object({
      enabled: z.boolean().optional(),
      colors: z
        .object({
          sockets: color.optional(),
          lights: color.optional(),
          switches: color.optional(),
          panels: color.optional(),
          fixedAppliances: color.optional(),
          dc: color.optional(),
          energyConversion: color.optional(),
          earthing: color.optional(),
          other: color.optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  check: () => ({ ok: true }),
  apply(draft, input) {
    const previous = selectProjectPlanWiringVisibility(draft)
    const next = { ...previous }
    if (input.enabled !== undefined && input.enabled !== (previous.colorCoded ?? false))
      next.colorCoded = input.enabled
    for (const [key, value] of Object.entries(input.colors ?? {})) {
      const category = key as SitplanSymbolCategory
      if (
        value &&
        value.toLowerCase() !== planCategoryColor(category, previous.symbolColors).toLowerCase()
      )
        next.symbolColors = { ...next.symbolColors, [category]: value.toLowerCase() }
    }
    if (JSON.stringify(previous) === JSON.stringify(next))
      return { created: [], changed: [], removed: [] }
    replacePlanWiringVisibilityForProject(draft, next)
    return { created: [], changed: [{ kind: 'project', id: draft.project.id }], removed: [] }
  },
})
