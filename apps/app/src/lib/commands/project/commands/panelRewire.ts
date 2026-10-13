import { z } from 'zod'
import type { ProjectV2 } from '@/types/projectV2'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'
import { getPanelRewireOperation } from '@/lib/panel/panelRewire'
import { isModuleRefValid } from '@/lib/eendraad/projectElectricalDomain'
import { rewirePanelModuleInProject } from '@/lib/panel/panelRewireMutations'
import { persistAutomaticPanelSlotsInProject } from '@/lib/panel/panelAutomaticSlots'
import { defineProjectCommand, type EntityRef } from '../types'
import { panelModuleRefSchema } from './panelEditLayout'

export const panelRewireInputSchema = z.strictObject({
  panelId: z.string().min(1),
  origin: panelModuleRefSchema,
  target: panelModuleRefSchema.nullable(),
})
export type PanelRewireInput = z.input<typeof panelRewireInputSchema>

/** Resolves canvas connections through the same supply, panel-input and cycle rules as previews. */
export const panelRewire = defineProjectCommand({
  id: 'panel.rewire',
  version: 1,
  input: panelRewireInputSchema,
  check(project, input) {
    if (!findPanelById(getProjectElectricalPanels(project), input.panelId))
      return { ok: false, code: 'panel_not_found', message: 'Panel not found' }
    if (
      !isModuleRefValid(input.origin, project) ||
      (input.target && !isModuleRefValid(input.target, project))
    )
      return { ok: false, code: 'module_not_found', message: 'Panel module no longer exists' }
    // Existing preview rules lazily normalize feed topology. Give them an isolated
    // electrical graph so validation cannot mutate a frozen project or draft.
    const query = {
      ...project,
      disciplines: {
        ...project.disciplines,
        electrical: JSON.parse(JSON.stringify(project.disciplines.electrical)),
      },
    } as ProjectV2
    const panel = findPanelById(getProjectElectricalPanels(query), input.panelId)
    return getPanelRewireOperation(panel ?? null, query, input.origin, input.target)
      ? { ok: true }
      : { ok: false, code: 'invalid_connection', message: 'Panel connection is not valid' }
  },
  apply(draft, input, env) {
    const project = draft as ProjectV2
    const result = rewirePanelModuleInProject(
      project,
      input.panelId,
      input.origin,
      input.target,
      env.newId
    )
    if (!result.changed) return { created: [], changed: [], removed: [] }
    const persist = (panels: ReturnType<typeof getProjectElectricalPanels>) => {
      for (const panel of panels) {
        persistAutomaticPanelSlotsInProject(project, panel.id)
        persist(panel.subPanels)
      }
    }
    persist(getProjectElectricalPanels(project))
    const ref = (value: typeof input.origin): EntityRef =>
      value.kind === 'domotica'
        ? { kind: 'endpoint', id: value.endpointId }
        : { kind: value.kind, id: value.id }
    const removed: EntityRef[] = result.removedProtectionId
      ? [{ kind: 'protection', id: result.removedProtectionId }]
      : []
    const changed = [
      ref(input.origin),
      ...(input.target ? [ref(input.target)] : []),
      { kind: 'panel' as const, id: input.panelId },
    ].filter(
      (entry) => !removed.some((value) => entry.kind === value.kind && entry.id === value.id)
    )
    const created: EntityRef[] = result.createdDeviceId
      ? [{ kind: 'trunkDevice', id: result.createdDeviceId }]
      : []
    return { created, changed, removed }
  },
})
