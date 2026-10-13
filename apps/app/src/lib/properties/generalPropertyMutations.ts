import type { ProjectV2 } from '@/types/projectV2'
import type { Door, Window, Wall, FloorPlan } from '@/types/schema'
import {
  selectProjectBuildingFloors,
  selectProjectFloorPlan,
  mutateBuildingFloorView,
} from '@/lib/projectV2/buildingFloors'
import {
  queryOneWireNotes,
  querySitplanNotes,
  queryOneWireFrames,
  replaceOneWireNotes,
  replaceSitplanNotes,
  replaceOneWireFrames,
} from '@/lib/projectV2/annotations'
import {
  preserveOpeningPositionsAfterPointChange,
  preserveOpeningWorldPositionsAfterPointChange,
  recomputeOpeningLocalFromNormalized,
  removeDuplicateConsecutivePoints,
  resizeOpeningTowardFreeSpace,
  sanitizeWallOpeningPositions,
} from '@/lib/plan/constraints'
import { patchChanges, normalizePatch } from './propertyPatch'

type BuildingKind = 'wall' | 'door' | 'window' | 'stair' | 'graphicElement'
const collections = {
  wall: 'walls',
  door: 'doors',
  window: 'windows',
  stair: 'stairs',
  graphicElement: 'graphicElements',
} as const
type WallUpdate = Partial<Wall> & {
  doorUpdates?: Array<{ id: string; position: number }>
  windowUpdates?: Array<{ id: string; position: number }>
}

/** Shared with legacy store setters: opening resize fits existing free space and updates segment coordinates. */
export function updateBuildingPropertiesInProject(
  project: ProjectV2,
  kind: BuildingKind,
  id: string,
  updates: Record<string, unknown>
): boolean {
  for (const floor of selectProjectBuildingFloors(project)) {
    const current = selectProjectFloorPlan(project, floor.id)?.[collections[kind]]?.find(
      (item) => item.id === id
    )
    if (!current) continue
    if (!patchChanges(current as unknown as Record<string, unknown>, updates)) return false
    const before = JSON.stringify(selectProjectFloorPlan(project, floor.id))
    const plan = JSON.parse(before) as FloorPlan
    {
      const entity = plan[collections[kind]]!.find((item) => item.id === id)!
      if (kind === 'wall') {
        const wall = entity as Wall
        const { doorUpdates, windowUpdates, ...patch } = updates as WallUpdate
        if (patch.points && !patch.curve && !wall.curve)
          patch.points = removeDuplicateConsecutivePoints(patch.points)
        const oldPoints =
          patch.points && patch.points.length >= 2
            ? wall.curve
              ? wall.points
              : removeDuplicateConsecutivePoints(wall.points)
            : undefined
        Object.assign(wall, patch)
        if (oldPoints && wall.points.length >= 2) {
          const doors = plan.doors.filter((item) => item.wallId === id)
          const windows = plan.windows.filter((item) => item.wallId === id)
          for (const update of doorUpdates ?? []) {
            const item = doors.find((item) => item.id === update.id)
            if (item) item.position = update.position
          }
          for (const update of windowUpdates ?? []) {
            const item = windows.find((item) => item.id === update.id)
            if (item) item.position = update.position
          }
          const passedPositions = !!((doorUpdates?.length ?? 0) + (windowUpdates?.length ?? 0))
          const preserved = (
            passedPositions
              ? preserveOpeningPositionsAfterPointChange
              : preserveOpeningWorldPositionsAfterPointChange
          )(
            oldPoints,
            wall.points,
            doors,
            windows,
            new Set([...(doorUpdates ?? []), ...(windowUpdates ?? [])].map((item) => item.id))
          )
          for (const update of preserved.doorUpdates) {
            const item = doors.find((item) => item.id === update.id)
            if (item) item.position = update.position
          }
          for (const update of preserved.windowUpdates) {
            const item = windows.find((item) => item.id === update.id)
            if (item) item.position = update.position
          }
          if (!passedPositions) fitOpenings(wall, doors, windows)
          recomputeOpeningLocalFromNormalized(wall.points, doors, windows)
        }
      } else {
        Object.assign(entity, updates)
        if (kind === 'door' || kind === 'window') {
          const opening = entity as Door | Window
          const wall = plan.walls.find((item) => item.id === opening.wallId)
          if (
            wall &&
            wall.points.length >= 2 &&
            (updates.position !== undefined || updates.width !== undefined)
          ) {
            const doors = plan.doors.filter((item) => item.wallId === opening.wallId)
            const windows = plan.windows.filter((item) => item.wallId === opening.wallId)
            if (updates.width !== undefined && updates.position === undefined) {
              const adjusted = resizeOpeningTowardFreeSpace(
                wall.points,
                doors,
                windows,
                id,
                kind,
                updates.width as number
              )
              if (adjusted) {
                opening.width = adjusted.width
                opening.position = adjusted.position
              }
            }
            fitOpenings(wall, doors, windows)
            recomputeOpeningLocalFromNormalized(wall.points, doors, windows)
          }
        }
      }
    }
    if (before === JSON.stringify(plan)) return false
    mutateBuildingFloorView(project, floor.id, (view) => {
      view.floorPlan = plan
    })
    return true
  }
  return false
}
function fitOpenings(wall: Wall, doors: Door[], windows: Window[]) {
  const fitted = sanitizeWallOpeningPositions(wall.points, doors, windows)
  for (const update of fitted.doorUpdates) {
    const item = doors.find((item) => item.id === update.id)
    if (item) item.position = update.position
  }
  for (const update of fitted.windowUpdates) {
    const item = windows.find((item) => item.id === update.id)
    if (item) item.position = update.position
  }
}
export function updateAnnotationPropertiesInProject(
  project: ProjectV2,
  kind: 'note' | 'frame',
  id: string,
  updates: Record<string, unknown>,
  scope?: 'oneWire' | 'sitplan'
): boolean {
  const items =
    kind === 'frame'
      ? queryOneWireFrames(project)
      : scope === 'oneWire'
        ? queryOneWireNotes(project)
        : querySitplanNotes(project)
  const index = items.findIndex((item) => item.id === id)
  if (index < 0 || !patchChanges(items[index] as unknown as Record<string, unknown>, updates))
    return false
  const next = items.map((item, i) => (i === index ? { ...item, ...updates } : item))
  if (kind === 'frame') replaceOneWireFrames(project, next as ReturnType<typeof queryOneWireFrames>)
  else if (scope === 'oneWire')
    replaceOneWireNotes(project, next as ReturnType<typeof queryOneWireNotes>)
  else replaceSitplanNotes(project, next as ReturnType<typeof querySitplanNotes>)
  return true
}
export function updateProjectMetadataInProject(
  project: ProjectV2,
  updates: Partial<ProjectV2['project']>
): boolean {
  const patch = normalizePatch(
    project.project as unknown as Record<string, unknown>,
    updates as Record<string, unknown>
  )
  for (const key of ['customer', 'inspectionAgency', 'installerOverride'] as const) {
    if (!updates[key] || !patch[key] || typeof patch[key] !== 'object') continue
    const contact = patch[key] as Record<string, unknown>
    if (contact.name === undefined) contact.name = key === 'customer' ? project.project.name : ''
    for (const addressKey of ['address', 'siteAddress']) {
      const address = contact[addressKey]
      if (address && typeof address === 'object')
        contact[addressKey] = { street: '', postalCode: '', city: '', country: '', ...address }
    }
    if (key === 'installerOverride') {
      contact.address ??= { street: '', postalCode: '', city: '', country: '' }
      contact.signatureDataUrl ??= null
      contact.logoDataUrl ??= null
    }
  }
  if (
    updates.installerOverride &&
    patch.installerOverride &&
    typeof patch.installerOverride === 'object'
  ) {
    const installer = patch.installerOverride as Record<string, unknown>
    for (const key of ['signatureDataUrl', 'logoDataUrl'] as const)
      if (key in updates.installerOverride && updates.installerOverride[key] == null)
        installer[key] = null
  }
  if (!patchChanges(project.project as unknown as Record<string, unknown>, patch)) return false
  Object.assign(project.project, patch)
  return true
}
