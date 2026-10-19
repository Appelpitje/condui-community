import { z } from 'zod'
import { resolvePlanLightingBranchConnection } from '@/lib/plan/planWiring'
import { defineProjectCommand } from '../types'
import { drawPlanWireInProject, planWireDrawing } from '@/lib/plan/planWireDrawing'

export const planDrawWire = defineProjectCommand({
  id: 'plan.drawWire',
  version: 1,
  input: z.object({
    floorId: z.string().min(1),
    sourcePlacementId: z.string().min(1),
    targetPlacementId: z.string().min(1),
    keepAutoSpans: z.boolean().default(true),
  }).strict(),
  check(project, input) {
    return planWireDrawing(project, input)
      ? { ok: true }
      : { ok: false, code: 'invalid_connection', message: 'These placements cannot be connected' }
  },
  apply(draft, input) {
    const connection = resolvePlanLightingBranchConnection(
      draft, input.floorId, input.sourcePlacementId, input.targetPlacementId
    )
    drawPlanWireInProject(draft, input)
    return {
      created: [], removed: [],
      changed: [
        { kind: 'floor' as const, id: input.floorId },
        ...(connection?.mode === 'attach-light' ? [
          { kind: 'circuit' as const, id: connection.circuit.id },
          { kind: 'endpoint' as const, id: connection.target.endpoint.id },
        ] : []),
      ],
      related: [input.sourcePlacementId, input.targetPlacementId].map((id) => ({ kind: 'placement' as const, id })),
    }
  },
})
