import { z } from 'zod'
import {
  splitWallInFloorPlan,
  resolveWallSplit,
  wallSplitCrossesOpening,
} from '@/lib/plan/wallSplit'
import { mutateBuildingFloorView, selectProjectFloorPlan } from '@/lib/projectV2/buildingFloors'
import { CommandError, defineProjectCommand, type EntityRef } from '../types'

const inputSchema = z
  .object({
    floorId: z.string().min(1),
    wallId: z.string().min(1),
    segmentIndex: z.number().int().nonnegative(),
    t: z.number().finite().gt(0).lt(1),
  })
  .strict()

export const planSplitWallInputSchema = inputSchema

export const planSplitWall = defineProjectCommand({
  id: 'plan.splitWall',
  version: 1,
  input: inputSchema,
  check(project, input) {
    if (!project.building.floors.some((floor) => floor.id === input.floorId))
      return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    const plan = selectProjectFloorPlan(project, input.floorId)
    const wall = plan?.walls.find((candidate) => candidate.id === input.wallId)
    if (!wall) return { ok: false, code: 'wall_not_found', message: 'Wall not found' }
    if (wall.curve)
      return {
        ok: false,
        code: 'curved_wall_split_unsupported',
        message: 'Curved walls cannot be split',
      }
    if (!plan) return { ok: false, code: 'floor_plan_missing', message: 'Floor plan not found' }
    if (wallSplitCrossesOpening(plan, input.wallId, input.segmentIndex, input.t))
      return {
        ok: false,
        code: 'split_crosses_opening',
        message: 'A wall cannot be split through an opening',
      }
    if (!resolveWallSplit(plan, input.wallId, input.segmentIndex, input.t))
      return {
        ok: false,
        code: 'invalid_wall_split',
        message: 'The split is invalid or crosses an opening',
      }
    return { ok: true }
  },
  apply(draft, input, env) {
    const createdId = env.newId()
    const outcome: { result: ReturnType<typeof splitWallInFloorPlan> } = { result: null }
    const floor = mutateBuildingFloorView(draft, input.floorId, (view) => {
      if (!view.floorPlan) return
      outcome.result = splitWallInFloorPlan(
        view.floorPlan,
        input.wallId,
        input.segmentIndex,
        input.t,
        createdId
      )
    })
    const result = outcome.result
    if (!floor || !result)
      throw new CommandError('check_failed', 'Wall cannot be split', {
        reason: 'invalid_wall_split',
      })

    const changed: EntityRef[] = [
      ...result.changedWallIds.map((id) => ({ kind: 'wall' as const, id })),
      ...result.changedDoorIds.map((id) => ({ kind: 'door' as const, id })),
      ...result.changedWindowIds.map((id) => ({ kind: 'window' as const, id })),
    ]
    const created = { kind: 'wall' as const, id: result.createdWall.id }
    return {
      created: [created],
      changed,
      removed: [],
      related: [{ kind: 'floor' as const, id: input.floorId }],
      select: [created],
    }
  },
})
