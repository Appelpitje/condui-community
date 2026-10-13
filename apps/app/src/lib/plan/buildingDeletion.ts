import type { ProjectV2 } from '@/types/projectV2'
import {
  mutateBuildingFloorView,
  selectProjectBuildingFloors,
  selectProjectFloorPlan,
} from '@/lib/projectV2/buildingFloors'

export type BuildingDeleteKind = 'wall' | 'door' | 'window' | 'stair' | 'graphicElement'
const collections = {
  wall: 'walls',
  door: 'doors',
  window: 'windows',
  stair: 'stairs',
  graphicElement: 'graphicElements',
} as const

/** Removes building entities and openings/attachments owned by deleted walls. */
export function deleteBuildingEntitiesInProject(
  project: ProjectV2,
  kind: BuildingDeleteKind,
  ids: readonly string[]
): boolean {
  const selected = new Set(ids)
  let changed = false
  for (const floor of selectProjectBuildingFloors(project)) {
    const plan = selectProjectFloorPlan(project, floor.id)
    const key = collections[kind]
    if (!plan?.[key]?.some((entity) => selected.has(entity.id))) continue
    mutateBuildingFloorView(project, floor.id, (view) => {
      const floorPlan = view.floorPlan!
      if (kind === 'wall') {
        floorPlan.doors = floorPlan.doors.filter((opening) => !selected.has(opening.wallId))
        floorPlan.windows = floorPlan.windows.filter((opening) => !selected.has(opening.wallId))
        floorPlan.walls = floorPlan.walls.filter((wall) => !selected.has(wall.id))
        for (const wall of floorPlan.walls) {
          if (wall.attachedPoints?.some((point) => selected.has(point.wallId))) {
            wall.attachedPoints = wall.attachedPoints.filter((point) => !selected.has(point.wallId))
          }
        }
      } else if (kind === 'door')
        floorPlan.doors = floorPlan.doors.filter((entity) => !selected.has(entity.id))
      else if (kind === 'window')
        floorPlan.windows = floorPlan.windows.filter((entity) => !selected.has(entity.id))
      else if (kind === 'stair')
        floorPlan.stairs = (floorPlan.stairs ?? []).filter((entity) => !selected.has(entity.id))
      else
        floorPlan.graphicElements = (floorPlan.graphicElements ?? []).filter(
          (entity) => !selected.has(entity.id)
        )
    })
    changed = true
  }
  return changed
}
