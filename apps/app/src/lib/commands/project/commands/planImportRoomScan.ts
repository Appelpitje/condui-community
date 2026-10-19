import { z } from 'zod'
import { importRoomScanPlacements } from '@/lib/plan/roomScanPlacementImport'
import { findPanelById } from '@/lib/panel/panelTree'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { convertRoomPlanScan, roomPlanImportScale, roomPlanScanSchema } from '@/lib/plan/roomPlanImport'
import {
  appendFloorPlanElementsForProject,
  selectProjectFloorPlan,
  selectProjectPlanScale,
  setPlanScaleForProject,
} from '@/lib/projectV2/buildingFloors'
import { resolvePlanPxPerMeter } from '@/lib/plan/planScale'
import { CommandError, defineProjectCommand, type EntityRef } from '../types'

export const planImportRoomScan = defineProjectCommand({
  id: 'plan.importRoomScan',
  version: 1,
  input: z.object({
    floorId: z.string().min(1),
    roomName: z.string().trim().min(1).max(80).optional(),
    roomNames: z.record(z.string().min(1).max(100), z.string().trim().min(1).max(80)).optional(),
    panelId: z.string().min(1).optional(),
    origin: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
    scan: roomPlanScanSchema,
    quarterTurns: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(0),
  }).strict(),
  check(project, input) {
    if (!project.building.floors.some((floor) => floor.id === input.floorId))
      return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    if (!input.scan.walls.some((wall) => Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z) >= 0.02))
      return { ok: false, code: 'no_walls', message: 'No usable walls in scan' }
    if (roomPlanImportScale(project) > 1_000_000)
      return { ok: false, code: 'invalid_scale', message: 'Invalid plan scale' }
    if (input.panelId && !findPanelById(getProjectElectricalPanels(project), input.panelId))
      return { ok: false, code: 'panel_not_found', message: 'Panel not found' }
    return { ok: true }
  },
  apply(draft, input, env) {
    const converted = convertRoomPlanScan(input.scan, {
      floorId: input.floorId,
      origin: input.origin,
      quarterTurns: input.quarterTurns,
      pxPerMeter: roomPlanImportScale(draft),
      symbolSizeCm: draft.building.floors.find((floor) => floor.id === input.floorId)?.sitplanSymbolSizeCm,
      masterWallThickness: selectProjectFloorPlan(draft, input.floorId)?.masterWallThickness,
      newId: env.newId,
    })
    const { floorPlan } = converted
    if (floorPlan.walls.length === 0)
      throw new CommandError('check_failed', 'No usable walls in scan', { reason: 'no_walls' })
    const changed: EntityRef[] = []
    if (resolvePlanPxPerMeter(draft.building.planScale) === null) {
      setPlanScaleForProject(draft, selectProjectPlanScale(draft) ?? { pxPerMeter: roomPlanImportScale(draft) })
      changed.push(...draft.building.floors.map((floor) => ({ kind: 'floor' as const, id: floor.id })))
    }
    appendFloorPlanElementsForProject(draft, input.floorId, floorPlan)
    const captured = importRoomScanPlacements(draft, {
      scan: input.scan, geometry: converted, floorId: input.floorId, panelId: input.panelId,
      roomNames: input.roomNames,
      roomName: input.roomName ?? draft.building.floors.find((floor) => floor.id === input.floorId)!.name,
    }, env)
    changed.push(...captured.changed)
    return {
      created: [
        ...captured.created,
        ...floorPlan.walls.map((wall) => ({ kind: 'wall' as const, id: wall.id })),
        ...floorPlan.doors.map((door) => ({ kind: 'door' as const, id: door.id })),
        ...floorPlan.windows.map((window) => ({ kind: 'window' as const, id: window.id })),
      ],
      changed,
      removed: [],
      related: [{ kind: 'floor' as const, id: input.floorId }],
      select: floorPlan.walls.map((wall) => ({ kind: 'wall' as const, id: wall.id })),
    }
  },
})
