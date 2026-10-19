import { z } from 'zod'
import { ensureSecondaryPanelEarthingStemInProject } from '@/lib/projectMutations/storeActions'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'
import { defineProjectCommand } from '../types'
import { collectTopologyRefs, diffTopologyRefs } from '../topologyRefs'

export const panelEnsureEarthingStemInputSchema = z.strictObject({
  panelId: z.string().min(1),
})

export const panelEnsureEarthingStem = defineProjectCommand({
  id: 'panel.ensureEarthingStem',
  version: 1,
  input: panelEnsureEarthingStemInputSchema,
  check(project, input) {
    const panel = findPanelById(getProjectElectricalPanels(project), input.panelId)
    return panel?.isMain === false
      ? { ok: true }
      : { ok: false, code: 'not_secondary_panel', message: 'Earthing stem requires a secondary panel.' }
  },
  apply(draft, input, env) {
    const before = collectTopologyRefs(draft)
    const result = ensureSecondaryPanelEarthingStemInProject(
      draft,
      input.panelId,
      env.language,
      env.newId
    )
    if (!result.changed)
      return { created: [], changed: [], removed: [], related: [], select: [] }
    return {
      ...diffTopologyRefs(before, collectTopologyRefs(draft)),
      related: [],
      select: [{ kind: 'panel' as const, id: input.panelId }],
    }
  },
})
