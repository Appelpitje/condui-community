import { z } from 'zod'
import {
  pasteFloorPlanClipboardPayload,
  type FloorPlanClipboardPayload,
  type FloorPlanPasteResult,
} from '@/lib/plan/floorPlanClipboard'
import { ensureElectricalLayerOnFloor } from '@/lib/plan/floorLayers'
import { addPlacementToProject } from '@/lib/plan/placementMutations'
import { resolvePlanPxPerMeter } from '@/lib/plan/planScale'
import {
  mutateBuildingFloorView,
  readLegacyCompatibilityFloors,
} from '@/lib/projectV2/buildingFloors'
import type { ProjectV2 } from '@/types/projectV2'
import { generateId } from '@/utils/id'
import { defineProjectCommand, type EntityRef } from '../types'

const point = z.object({ x: z.number().finite(), y: z.number().finite() })

/** The copied floor-plan selection, as `createFloorPlanClipboardPayload` builds it. */
const payloadSchema = z.custom<FloorPlanClipboardPayload>(
  (value) =>
    z
      .object({
        sourceFloorId: z.string(),
        sourcePxPerMeter: z.number(),
        sourceMasterWallThickness: z.number(),
        walls: z.array(z.unknown()),
        doors: z.array(z.unknown()),
        windows: z.array(z.unknown()),
        stairs: z.array(z.unknown()),
        graphicElements: z.array(z.unknown()),
        placements: z.array(z.unknown()),
      })
      .safeParse(value).success,
  { message: 'Expected a floor-plan clipboard payload' }
)

function selectionOf(result: FloorPlanPasteResult): EntityRef[] {
  if (result.wallIds.length > 0) return result.wallIds.map((id) => ({ kind: 'wall', id }))
  if (result.stairIds.length > 0) return result.stairIds.map((id) => ({ kind: 'stair', id }))
  if (result.graphicElementIds.length > 0) {
    return result.graphicElementIds.map((id) => ({ kind: 'element', id }))
  }
  return result.placementIds.map((id) => ({ kind: 'placement', id }))
}

/**
 * Copies a floor-plan selection (walls, openings, stairs, plan graphics and symbols) to one or
 * more floors, scaled to each floor's plan scale. With `targetCenter` the copy is centred
 * there (paste on the same floor). Selects the copies on the last floor.
 */
export const planCopyToFloor = defineProjectCommand({
  id: 'plan.copyToFloor',
  version: 1,
  input: z.object({
    payload: payloadSchema,
    targetFloorIds: z.array(z.string().min(1)).min(1),
    copyOpenings: z.boolean().default(true),
    targetCenter: point.optional(),
  }),
  check(project, input) {
    const floorIds = new Set(readLegacyCompatibilityFloors(project).map((floor) => floor.id))
    const missing = input.targetFloorIds.filter((id) => !floorIds.has(id))
    return missing.length > 0
      ? { ok: false, code: 'floor_not_found', message: 'Floor not found', details: { missing } }
      : { ok: true }
  },
  apply(draft, input) {
    const project = draft as ProjectV2
    const created: EntityRef[] = []
    let select: EntityRef[] = []
    for (const targetFloorId of input.targetFloorIds) {
      const floor = readLegacyCompatibilityFloors(project).find((f) => f.id === targetFloorId)!
      const result = pasteFloorPlanClipboardPayload({
        payload: input.payload,
        targetFloorId,
        targetPxPerMeter: resolvePlanPxPerMeter(floor.scale) ?? 100,
        targetFloorPlan: floor.floorPlan,
        generateId,
        copyOpenings: input.copyOpenings,
        targetCenter: input.targetCenter,
      })
      mutateBuildingFloorView(project, targetFloorId, (view) => {
        view.floorPlan = result.floorPlan
        ensureElectricalLayerOnFloor(view)
      })
      result.placements.forEach(({ endpointId, placement }) =>
        addPlacementToProject(project, endpointId, placement)
      )
      created.push(...selectionOf(result))
      select = selectionOf(result)
    }
    return {
      created,
      changed: input.targetFloorIds.map((id) => ({ kind: 'floor' as const, id })),
      removed: [],
      select,
    }
  },
})
