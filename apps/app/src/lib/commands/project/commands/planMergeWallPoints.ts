import { z } from 'zod'
import { mergeWallPointsInFloorPlan } from '@/lib/plan/wallMerge'
import { mutateBuildingFloorView, selectProjectFloorPlan } from '@/lib/projectV2/buildingFloors'
import { CommandError, defineProjectCommand, type EntityRef } from '../types'

const inputSchema = z
  .object({
    floorId: z.string().min(1),
    wallId1: z.string().min(1),
    pointIndex1: z.number().int().nonnegative(),
    wallId2: z.string().min(1),
    pointIndex2: z.number().int().nonnegative(),
  })
  .strict()

export const planMergeWallPointsInputSchema = inputSchema

function copyFloorPlan(plan: NonNullable<ReturnType<typeof selectProjectFloorPlan>>) {
  return {
    ...plan,
    walls: plan.walls.map((wall) => ({
      ...wall,
      points: wall.points.map((point) => ({ ...point })),
    })),
    doors: plan.doors.map((door) => ({ ...door })),
    windows: plan.windows.map((window) => ({ ...window })),
    stairs: (plan.stairs ?? []).map((stair) => ({
      ...stair,
      points: stair.points.map((point) => ({ ...point })),
    })),
    graphicElements: (plan.graphicElements ?? []).map((graphic) => ({
      ...graphic,
      pos: { ...graphic.pos },
    })),
  }
}

function canMerge(
  project: Parameters<typeof selectProjectFloorPlan>[0],
  input: z.infer<typeof inputSchema>
): boolean {
  const plan = selectProjectFloorPlan(project, input.floorId)
  return (
    !!plan &&
    mergeWallPointsInFloorPlan(
      copyFloorPlan(plan),
      input.wallId1,
      input.pointIndex1,
      input.wallId2,
      input.pointIndex2
    )
  )
}

export const planMergeWallPoints = defineProjectCommand({
  id: 'plan.mergeWallPoints',
  version: 1,
  input: inputSchema,
  check(project, input) {
    if (!project.building.floors.some((floor) => floor.id === input.floorId))
      return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    if (!canMerge(project, input))
      return { ok: false, code: 'invalid_wall_join', message: 'These wall points cannot be joined' }
    return { ok: true }
  },
  apply(draft, input) {
    const changed: EntityRef[] = []
    const removed: EntityRef[] = []
    const floor = mutateBuildingFloorView(draft, input.floorId, (floorView) => {
      const plan = floorView.floorPlan
      if (!plan) return
      const before = copyFloorPlan(plan)
      if (
        !mergeWallPointsInFloorPlan(
          plan,
          input.wallId1,
          input.pointIndex1,
          input.wallId2,
          input.pointIndex2
        )
      )
        return
      const collections = [
        ['wall', before.walls, plan.walls],
        ['door', before.doors, plan.doors],
        ['window', before.windows, plan.windows],
      ] as const
      for (const [kind, oldItems, newItems] of collections) {
        const newById = new Map(newItems.map((item) => [item.id, item]))
        for (const item of oldItems) {
          const next = newById.get(item.id)
          if (!next) removed.push({ kind, id: item.id })
          else if (JSON.stringify(item) !== JSON.stringify(next))
            changed.push({ kind, id: item.id })
        }
      }
    })
    if (!floor || (changed.length === 0 && removed.length === 0))
      throw new CommandError('check_failed', 'These wall points cannot be joined', {
        reason: 'invalid_wall_join',
      })
    return { created: [], changed, removed, related: [{ kind: 'floor', id: input.floorId }] }
  },
})
