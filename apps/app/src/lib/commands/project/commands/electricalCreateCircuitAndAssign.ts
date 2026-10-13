import { persistAutomaticPanelSlotsInProject } from '@/lib/panel/panelAutomaticSlots'
import { z } from 'zod'
import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit, ProtectionDevice } from '@/types/schema'
import { addCircuitToProject } from '@/lib/eendraad/circuitMutations'
import { assignEndpointsToCircuitInProject } from '@/lib/eendraad/endpointMutations'
import { addProtectionToProject } from '@/lib/eendraad/protectionMutations'
import { findEndpointById } from '@/lib/eendraad/projectElectricalDomain'
import { findPanelById } from '@/lib/panel/panelTree'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { isMainPanelDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import {
  createDefaultAcCircuitCable,
  DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
} from '@/lib/wires/circuitWireDefaults'
import { CommandError, defineProjectCommand } from '../types'

const protectionConfigSchema = z
  .object({
    type: z.enum(['MCB', 'RCD', 'RCBO']),
    label: z.string(),
    ratingA: z.number().finite().positive().optional(),
    curve: z.enum(['B', 'C', 'D', 'K', 'Z']).optional(),
    sensitivityMa: z.number().finite().positive().optional(),
    residualCurrentType: z.enum(['AC', 'A', 'F', 'B']).optional(),
    breakingCapacityKa: z.number().finite().positive().optional(),
    breakingCapacityOption: z.string().optional(),
    polesConfig: z.enum(['1P', '1P+N', '2P', '3P', '3P+N', '4P']).optional(),
    poles: z.number().int().positive().optional(),
  })
  .strict()

export const electricalCreateCircuitAndAssignInputSchema = z
  .object({
    panelId: z.string().min(1),
    endpointId: z.string().min(1),
    protection: protectionConfigSchema,
  })
  .strict()

export type ElectricalCreateCircuitAndAssignInput = z.input<
  typeof electricalCreateCircuitAndAssignInputSchema
>

/** Creates a protection and empty AC circuit, then assigns one endpoint as one atomic gesture. */
export const electricalCreateCircuitAndAssign = defineProjectCommand({
  id: 'electrical.createCircuitAndAssign',
  version: 1,
  input: electricalCreateCircuitAndAssignInputSchema,
  check(project, input) {
    const panels = getEditableProjectElectricalPanels(project)
    if (!findPanelById(panels, input.panelId)) {
      return { ok: false, code: 'panel_not_found', message: 'Panel not found' }
    }
    let endpoint: ReturnType<typeof findEndpointById> = undefined
    for (const panel of panels) {
      endpoint = findEndpointById(panel, input.endpointId)
      if (endpoint) break
    }
    if (!endpoint || isMainPanelDistributionEndpoint(project, endpoint.endpoint)) {
      return { ok: false, code: 'invalid_endpoint', message: 'Endpoint cannot be assigned' }
    }
    return { ok: true }
  },
  apply(draft, input, env) {
    const project = draft as ProjectV2
    const protectionId = env.newId()
    const circuitId = env.newId()
    const label = input.protection.label.trim()
    const protection: ProtectionDevice = {
      id: protectionId,
      type: input.protection.type,
      label,
      circuits: [],
      polesConfig: input.protection.polesConfig,
      poles: input.protection.poles,
      ratingA: input.protection.ratingA,
      curve: input.protection.curve,
      sensitivityMa: input.protection.sensitivityMa,
      residualCurrentType: input.protection.residualCurrentType,
      breakingCapacityKa: input.protection.breakingCapacityKa,
      breakingCapacityOption: input.protection.breakingCapacityOption,
    }
    const circuit: Circuit = {
      id: circuitId,
      code: label,
      kind: 'empty',
      cable: createDefaultAcCircuitCable(),
      endpoints: [],
      ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
    }

    if (!addProtectionToProject(project, input.panelId, protection)) {
      throw new CommandError('check_failed', 'The selected panel no longer exists', {
        reason: 'panel_not_found',
      })
    }
    if (!addCircuitToProject(project, input.panelId, circuit, protectionId)) {
      throw new CommandError('check_failed', 'The circuit could not be created', {
        reason: 'circuit_creation_rejected',
      })
    }
    const assignment = assignEndpointsToCircuitInProject(
      project,
      [input.endpointId],
      circuitId,
      env.newId
    )
    if (!assignment) {
      throw new CommandError('check_failed', 'Endpoint could not be assigned', {
        reason: 'assignment_rejected',
      })
    }

    const gridChanged = persistAutomaticPanelSlotsInProject(project, input.panelId)
    return {
      created: [
        { kind: 'protection' as const, id: protectionId },
        { kind: 'circuit' as const, id: circuitId },
      ],
      changed: gridChanged ? [{ kind: 'panel' as const, id: input.panelId }] : [],
      removed: [],
      related: assignment.movedEndpointIds.map((id) => ({ kind: 'endpoint' as const, id })),
      select: [{ kind: 'circuit' as const, id: circuitId }],
    }
  },
})
