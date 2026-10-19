import type { Door, FloorPlan, PlanGraphicElement, Stair, Wall, Window } from '@/types/schema'
import {
  recomputeOpeningLocalFromNormalized,
  sanitizeWallOpeningPositions,
} from '@/lib/plan/constraints'
import { isCurvedWall } from '@/lib/plan/wallCurve'

export type BuildingGeometryDraft =
  | { kind: 'wall'; value: Omit<Wall, 'id'> }
  | { kind: 'door'; value: Omit<Door, 'id'> }
  | { kind: 'window'; value: Omit<Window, 'id'> }
  | { kind: 'stair'; value: Omit<Stair, 'id'> }
  | { kind: 'graphicElement'; value: Omit<PlanGraphicElement, 'id'> }

export type CreatedBuildingGeometry = Wall | Door | Window | Stair | PlanGraphicElement

export function createEmptyFloorPlan(): FloorPlan {
  return {
    walls: [],
    doors: [],
    windows: [],
    stairs: [],
    graphicElements: [],
    masterWallThickness: 20,
  }
}

export function isDuplicateStraightWall(
  floorPlan: FloorPlan,
  candidate: Omit<Wall, 'id'>
): boolean {
  if (candidate.curve) return false
  return floorPlan.walls.some((existing) => {
    if (isCurvedWall(existing) || existing.points.length !== candidate.points.length) return false
    const n = candidate.points.length
    const allMatch = (forward: boolean) =>
      candidate.points.every((point, index) => {
        const other = existing.points[forward ? index : n - 1 - index]!
        return Math.abs(point.x - other.x) <= 1 && Math.abs(point.y - other.y) <= 1
      })
    return allMatch(true) || allMatch(false)
  })
}

/** Apply the established drawing-time building rules to an editable floor-plan projection. */
export function addBuildingGeometryToFloorPlan(
  floorPlan: FloorPlan,
  draft: BuildingGeometryDraft,
  newId: () => string
): CreatedBuildingGeometry | null {
  if (draft.kind === 'wall') {
    const wall: Wall = { ...draft.value, id: newId() }
    if (isDuplicateStraightWall(floorPlan, draft.value)) return null
    floorPlan.walls.push(wall)
    return wall
  }

  if (draft.kind === 'door' || draft.kind === 'window') {
    const wall = floorPlan.walls.find((item) => item.id === draft.value.wallId)
    if (!wall || isCurvedWall(wall)) return null
    const opening = { ...draft.value, id: newId() } as Door | Window
    const doors = [...floorPlan.doors]
    const windows = [...floorPlan.windows]
    if (draft.kind === 'door') doors.push(opening as Door)
    else windows.push(opening as Window)

    const wallDoors = doors.filter((item) => item.wallId === wall.id)
    const wallWindows = windows.filter((item) => item.wallId === wall.id)
    const fitted = sanitizeWallOpeningPositions(wall.points, wallDoors, wallWindows)
    for (const update of fitted.doorUpdates) {
      const item = wallDoors.find((candidate) => candidate.id === update.id)
      if (item) item.position = update.position
    }
    for (const update of fitted.windowUpdates) {
      const item = wallWindows.find((candidate) => candidate.id === update.id)
      if (item) item.position = update.position
    }
    recomputeOpeningLocalFromNormalized(wall.points, wallDoors, wallWindows)
    floorPlan.doors = doors
    floorPlan.windows = windows
    return opening
  }

  if (draft.kind === 'stair') {
    const stair: Stair = { ...draft.value, id: newId() }
    ;(floorPlan.stairs ??= []).push(stair)
    return stair
  }

  const graphic: PlanGraphicElement = { ...draft.value, id: newId() }
  ;(floorPlan.graphicElements ??= []).push(graphic)
  return graphic
}
