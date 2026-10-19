import { z } from 'zod'
import {
  addBuildingGeometryToFloorPlan,
  createEmptyFloorPlan,
  isDuplicateStraightWall,
  type BuildingGeometryDraft,
  type CreatedBuildingGeometry,
} from '@/lib/plan/buildingGeometryMutations'
import { getPlanGraphicElementAsset } from '@/lib/plan/graphicElements'
import { mutateBuildingFloorView, selectProjectFloorPlan } from '@/lib/projectV2/buildingFloors'
import { CommandError, defineProjectCommand, type EntityRef } from '../types'

const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict()
const points = z.array(point).min(2).max(10_000)

const inputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('wall'),
      floorId: z.string().min(1),
      points,
      curve: z
        .object({ kind: z.literal('rationalQuadratic'), weight: z.number().finite().positive() })
        .strict()
        .optional(),
      thickness: z.number().finite().positive().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('door'),
      floorId: z.string().min(1),
      wallId: z.string().min(1),
      position: z.number().finite().min(0).max(1),
      width: z.number().finite().positive(),
      swing: z.enum(['left', 'right', 'none', 'double']).optional(),
      direction: z.enum(['in', 'out']).optional(),
      swingAngleDeg: z.number().finite().min(0).max(180).optional(),
      isOpening: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('window'),
      floorId: z.string().min(1),
      wallId: z.string().min(1),
      position: z.number().finite().min(0).max(1),
      width: z.number().finite().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('stair'),
      floorId: z.string().min(1),
      points: z.array(point).min(1).max(10_000),
      width: z.number().finite().positive(),
      stepDepth: z.number().finite().positive(),
      spiralPoleDiameter: z.number().finite().positive().optional(),
      spiralSweepDegrees: z.number().finite().min(90).max(360).optional(),
      spiralRotationDeg: z.number().finite().optional(),
      cornerStyle: z.enum(['round', 'sharp']),
      cornerMode: z.enum(['turn', 'platform']),
      cornerModeOverrides: z.record(z.string(), z.enum(['turn', 'platform'])).optional(),
      showUpArrow: z.boolean().optional(),
      invertUpArrow: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('graphicElement'),
      floorId: z.string().min(1),
      elementKind: z.enum([
        'bathtub',
        'shower',
        'washbasin',
        'toilet',
        'kitchen_cabinet',
        'car',
        'rectangle',
        'custom',
      ]),
      assetId: z.string().min(1),
      pos: point,
      width: z.number().finite().positive(),
      height: z.number().finite().positive(),
      rotationDeg: z.number().finite().optional(),
      sizeLocked: z.boolean().optional(),
      layer: z.string().min(1).optional(),
    })
    .strict(),
])

export const planCreateBuildingGeometryInputSchema = inputSchema
export type PlanCreateBuildingGeometryInput = z.infer<typeof inputSchema>

function draftFromInput(input: PlanCreateBuildingGeometryInput): BuildingGeometryDraft {
  switch (input.kind) {
    case 'wall': {
      const { floorId, kind, ...value } = input
      return { kind, value: { ...value, floorId } }
    }
    case 'door': {
      const { floorId, kind, ...value } = input
      return { kind, value: { ...value, floorId } }
    }
    case 'window': {
      const { floorId, kind, ...value } = input
      return { kind, value: { ...value, floorId } }
    }
    case 'stair': {
      const { floorId, kind, ...value } = input
      return { kind, value: { ...value, floorId } }
    }
    case 'graphicElement': {
      const { floorId, kind, elementKind, ...value } = input
      return { kind, value: { ...value, kind: elementKind, floorId } }
    }
  }
}

function entityRef(
  input: PlanCreateBuildingGeometryInput,
  entity: CreatedBuildingGeometry
): EntityRef {
  if (input.kind === 'graphicElement') return { kind: 'graphicElement', id: entity.id }
  return { kind: input.kind, id: entity.id }
}

function validGeometry(input: PlanCreateBuildingGeometryInput): boolean {
  if (input.kind === 'wall') {
    if (input.points.length < 2) return false
    if (input.curve && input.points.length !== 3) return false
    return input.points.some((point, index) => {
      const next = input.points[index + 1]
      return next != null && Math.hypot(next.x - point.x, next.y - point.y) > 1e-6
    })
  }
  if (input.kind === 'stair') return input.points.length >= 1
  return true
}

export const planCreateBuildingGeometry = defineProjectCommand({
  id: 'plan.createBuildingGeometry',
  version: 1,
  input: inputSchema,
  check(project, input) {
    if (!project.building.floors.some((floor) => floor.id === input.floorId))
      return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    if (!validGeometry(input))
      return { ok: false, code: 'invalid_geometry', message: 'Building geometry is invalid' }
    const floorPlan = selectProjectFloorPlan(project, input.floorId)
    if (input.kind === 'wall' && floorPlan && isDuplicateStraightWall(floorPlan, input))
      return { ok: false, code: 'duplicate_wall', message: 'Wall already exists' }
    if (input.kind === 'graphicElement') {
      const asset = getPlanGraphicElementAsset(input.assetId)
      if (!asset || asset.kind !== input.elementKind)
        return {
          ok: false,
          code: 'invalid_graphic_asset',
          message: 'Plan graphic asset is invalid',
        }
    }
    if (
      (input.kind === 'door' || input.kind === 'window') &&
      (!floorPlan?.walls.some((wall) => wall.id === input.wallId) ||
        floorPlan.walls.find((wall) => wall.id === input.wallId)?.curve)
    ) {
      return {
        ok: false,
        code: 'invalid_opening_wall',
        message: 'Openings require a straight wall',
      }
    }
    return { ok: true }
  },
  apply(draft, input, env) {
    const result: { created: CreatedBuildingGeometry | null } = { created: null }
    const floor = mutateBuildingFloorView(draft, input.floorId, (floorView) => {
      const floorPlan = (floorView.floorPlan ??= createEmptyFloorPlan())
      result.created = addBuildingGeometryToFloorPlan(floorPlan, draftFromInput(input), env.newId)
    })
    if (!floor || !result.created) {
      throw new CommandError('check_failed', 'Building geometry could not be created', {
        reason: 'invalid_geometry',
      })
    }
    const ref = entityRef(input, result.created)
    return {
      created: [ref],
      changed: [],
      removed: [],
      related: [{ kind: 'floor', id: input.floorId }],
      select: [ref],
    }
  },
})
