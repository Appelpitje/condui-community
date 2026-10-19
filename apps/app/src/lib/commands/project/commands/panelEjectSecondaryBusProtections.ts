import { z } from 'zod'
import { ejectSecondaryBusProtectionsToNewPanelInProject } from '@/lib/eendraad/secondaryBusEjectMutation'
import { resolveSecondaryBusEjectSelection } from '@/lib/eendraad/secondaryBusEjectEligibility'
import { collectTopologyRefs, diffTopologyRefs } from '../topologyRefs'
import { CommandError, defineProjectCommand } from '../types'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'

export const panelEjectSecondaryBusProtectionsInputSchema = z
  .strictObject({
    protectionIds: z.array(z.string().min(1)).min(1),
    newPanelName: z.string().trim().min(1).max(120).optional(),
    planPlacement: z.strictObject({
      floorId: z.string().min(1),
      layer: z.string().min(1),
      pos: z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
    }).optional(),
  })
  .superRefine((input, context) => {
    if (new Set(input.protectionIds).size !== input.protectionIds.length)
      context.addIssue({ code: 'custom', message: 'Protection ids must be unique.' })
  })

export const panelEjectSecondaryBusProtections = defineProjectCommand({
  id: 'panel.ejectSecondaryBusProtections',
  version: 1,
  input: panelEjectSecondaryBusProtectionsInputSchema,
  check(project, input) {
    if (input.planPlacement) {
      const floor = selectProjectBuildingFloors(project).find(
        (candidate) => candidate.id === input.planPlacement?.floorId
      )
      if (!floor)
        return { ok: false, code: 'floor_not_found', message: 'Plan placement floor no longer exists.' }
      if ('layers' in floor && floor.layers?.length && !floor.layers.includes(input.planPlacement.layer))
        return { ok: false, code: 'layer_not_found', message: 'Plan placement layer no longer exists.' }
    }
    return resolveSecondaryBusEjectSelection(project, input.protectionIds)
      ? { ok: true }
      : {
          ok: false,
          code: 'invalid_eject_selection',
          message: 'Select all direct protections on one secondary bus.',
        }
  },
  apply(draft, input, env) {
    const before = collectTopologyRefs(draft)
    const result = ejectSecondaryBusProtectionsToNewPanelInProject(draft, input.protectionIds, {
      ...(input.newPanelName ? { newPanelName: input.newPanelName } : {}),
      newId: env.newId,
      language: env.language,
      ...(input.planPlacement ? { planPlacement: input.planPlacement } : {}),
    })
    if (!result) throw new CommandError('check_failed', 'Secondary bus selection is no longer valid.')
    const diff = diffTopologyRefs(before, collectTopologyRefs(draft))
    return {
      ...diff,
      related: [],
      select: [
        { kind: 'panel' as const, id: result.panelId },
        ...(result.placementId ? [{ kind: 'placement' as const, id: result.placementId }] : []),
      ],
    }
  },
})
