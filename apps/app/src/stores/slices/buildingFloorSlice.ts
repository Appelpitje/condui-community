import { updateBuildingPropertiesInProject } from '@/lib/properties/generalPropertyMutations'
import { deleteBuildingEntitiesInProject } from '@/lib/plan/buildingDeletion'
import { pickDefaultPlanReferenceOverlayFloor } from './projectStoreHistory'
import type { ProjectSliceCreator } from './projectStoreTypes'
import { getAllEndpoints } from '@/lib/eendraad/projectElectricalDomain'
import { clamp } from '@/lib/geometry'
import {
  cumulativeLengths,
  getWallTotalLengthFromPoints,
  recomputeOpeningLocalFromNormalized,
  sanitizeWallOpeningPositions,
} from '@/lib/plan/constraints'
import { ensureElectricalLayerOnFloor } from '@/lib/plan/floorLayers'
import { resolvePlanPxPerMeter } from '@/lib/plan/planScale'
import { resolvePlanWiringVisibility } from '@/lib/plan/planWiring'
import {
  editPlanPlacements,
  invalidatePlanLengthEstimates,
  preserveOtherFloorsOnScaleChange,
  rescalePlanFloorExtras,
} from '@/lib/plan/rescalePlan'
import { isCurvedWall } from '@/lib/plan/wallCurve'
import { updateFloorInProject } from '@/lib/projectMutations/storeActions'
import {
  addBuildingFloorView,
  commitBuildingFloorView,
  mutateBuildingFloorViews,
  readLegacyCompatibilityFloors,
  removeBuildingFloor,
  selectProjectPlanScale,
  setPlanScaleForProject,
} from '@/lib/projectV2/buildingFloors'
import {
  editProjectElectricalPanels,
  selectProjectElectricalInstallation,
} from '@/lib/projectV2/electrical'
import { getUnusedFloorPlanAssetIds } from '@/lib/projectV2/floorPlanAssets'
import {
  replacePlanWiringVisibilityForProject,
  selectProjectPlanWiringVisibility,
} from '@/lib/projectV2/planWiring'
import { useUIStore } from '@/stores/uiStore'
import type { PlanGraphicElement, Point2, Wall } from '@/types/schema'
import { generateId } from '@/utils/project'

export const createBuildingFloorSlice: ProjectSliceCreator = (set, get) => ({
  // Floor actions
  addFloor: (floor) =>
    set((state) => {
      if (state.currentProject) {
        const sharedScale = selectProjectPlanScale(state.currentProject)
        if (floor.scale && resolvePlanPxPerMeter(floor.scale) == null) return
        if (floor.scale) {
          preserveOtherFloorsOnScaleChange(state.currentProject, floor.id, floor.scale)
          if (floor.scale.reference)
            floor.scale = {
              ...floor.scale,
              reference: { ...floor.scale.reference, floorId: floor.id },
            }
          setPlanScaleForProject(state.currentProject, floor.scale)
          floor.scale = selectProjectPlanScale(state.currentProject)
        } else if (sharedScale) {
          floor.scale = sharedScale
        }
        ensureElectricalLayerOnFloor(floor)
        addBuildingFloorView(state.currentProject, floor)
        state.isDirty = true
      }
    }),

  removeFloorPlan: ({ planAssetId, floorIds }) => {
    get().withSingleUndoEntry(() => {
      for (const floorId of floorIds) {
        get().updateFloor(floorId, {
          planAsset: undefined,
          planAssetProcessed: undefined,
          planAssetHasWhiteBackground: undefined,
          planImportAsset: undefined,
        })
      }
      const project = get().currentProject
      if (project && planAssetId) {
        const unused = getUnusedFloorPlanAssetIds(
          project.assets,
          project.building.floors,
          planAssetId
        )
        if (unused.length > 0) get().removeProjectAssets(unused)
      }
      return true
    })
  },

  updateFloor: (id, updates) =>
    set((state) => {
      if (!state.currentProject) return
      const result = updateFloorInProject(
        state.currentProject,
        id,
        updates,
        useUIStore.getState().activePanelId
      )
      if (result.changed) state.isDirty = true
    }),

  updatePlanWiringVisibility: (updates) =>
    set((state) => {
      if (!state.currentProject) return
      const currentVisibility = selectProjectPlanWiringVisibility(state.currentProject)
      replacePlanWiringVisibilityForProject(state.currentProject, {
        ...resolvePlanWiringVisibility({ version: 1, routes: [], visibility: currentVisibility }),
        ...updates,
      })
      state.currentProject.project.updatedAt = new Date().toISOString()
      state.isDirty = true
    }),

  applyPlanRescale: (floorId, floorUpdates, placementUpdates, options) =>
    set((state) => {
      if (!state.currentProject) return
      const floor = readLegacyCompatibilityFloors(state.currentProject).find(
        (f) => f.id === floorId
      )
      if (floor) {
        if (floorUpdates.scale && resolvePlanPxPerMeter(floorUpdates.scale) == null) return
        if (options?.scaleScope === 'building' && floorUpdates.scale) {
          const before = resolvePlanPxPerMeter(selectProjectPlanScale(state.currentProject)) ?? 100
          const after = resolvePlanPxPerMeter(floorUpdates.scale)
          if (after == null) return

          setPlanScaleForProject(state.currentProject, floorUpdates.scale)
          Object.assign(floor, {
            scale: selectProjectPlanScale(state.currentProject),
            planScaleNeedsCalibration: false,
          })
          if (Math.abs(after / before - 1) > 1e-9) {
            invalidatePlanLengthEstimates(state.currentProject)
          }
          commitBuildingFloorView(state.currentProject, floorId, floor)
          state.isDirty = true
          // Building-wide calibration changes the shared units only. It deliberately
          // leaves every floor's geometry, image assets, and placement coordinates intact.
          return
        }
        const before = resolvePlanPxPerMeter(floor.scale) ?? 100
        const after = resolvePlanPxPerMeter(floorUpdates.scale)
        if (floorUpdates.scale) {
          preserveOtherFloorsOnScaleChange(state.currentProject, floorId, floorUpdates.scale)
          if (floorUpdates.scale.reference)
            floorUpdates = { ...floorUpdates, planScaleNeedsCalibration: false }
        }
        if (floorUpdates.floorPlan && after && Math.abs(after / before - 1) > 1e-9) {
          const points = floor.floorPlan?.walls.flatMap((wall) => wall.points) ?? []
          const center = points.length
            ? {
                x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
                y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
              }
            : { x: 0, y: 0 }
          editPlanPlacements(state.currentProject, (placement) => {
            if (placement.floorId === floorId)
              placement.pos = {
                x: center.x + (placement.pos.x - center.x) * (after / before),
                y: center.y + (placement.pos.y - center.y) * (after / before),
              }
          })
          rescalePlanFloorExtras(state.currentProject, floorId, after / before, center)
          invalidatePlanLengthEstimates(state.currentProject)
        }
        Object.assign(floor, floorUpdates)
        if (floorUpdates.scale) {
          setPlanScaleForProject(state.currentProject, floorUpdates.scale)
          floor.scale = selectProjectPlanScale(state.currentProject)
        }
        commitBuildingFloorView(state.currentProject, floorId, floor)
        state.isDirty = true
      }
      if (placementUpdates.length === 0) return
      const idToPos = new Map<string, Point2>(placementUpdates.map((u) => [u.id, u.pos]))
      editPlanPlacements(state.currentProject, (placement) => {
        const pos = idToPos.get(placement.id)
        if (pos) placement.pos = pos
      })
    }),

  deleteFloor: (id) =>
    set((state) => {
      if (state.currentProject) {
        const floors = readLegacyCompatibilityFloors(state.currentProject)
        if (floors.length <= 1) return
        const floorIndex = floors.findIndex((f) => f.id === id)
        if (floorIndex < 0) return
        const reassignedFloorId =
          (floorIndex > 0 ? floors[floorIndex - 1]?.id : undefined) ??
          floors[floorIndex + 1]?.id ??
          floors.find((f) => f.id !== id)?.id

        removeBuildingFloor(state.currentProject, id)
        // Preserve placements by moving them to the nearest remaining floor.
        for (const panel of editProjectElectricalPanels(state.currentProject)) {
          const endpoints = getAllEndpoints(panel)
          for (const endpoint of endpoints) {
            if (!reassignedFloorId) continue
            endpoint.placements = endpoint.placements.map((p) =>
              p.floorId === id ? { ...p, floorId: reassignedFloorId } : p
            )
          }
        }
        if (reassignedFloorId) {
          const installation = selectProjectElectricalInstallation(state.currentProject)
          for (const placement of installation?.earthingPlacements ?? []) {
            if (placement.floorId === id) placement.floorId = reassignedFloorId
          }
          for (const placement of installation?.junctionPanelPlacements ?? []) {
            if (placement.floorId === id) placement.floorId = reassignedFloorId
          }
        }
        state.isDirty = true
      }
      delete state.planFloorOverlayVisibleByBaseFloorId[id]
      for (const baseId of Object.keys(state.planFloorOverlayVisibleByBaseFloorId)) {
        const list = state.planFloorOverlayVisibleByBaseFloorId[baseId]
        if (!list?.length) continue
        const next = list.filter((fid) => fid !== id)
        if (next.length === 0) delete state.planFloorOverlayVisibleByBaseFloorId[baseId]
        else state.planFloorOverlayVisibleByBaseFloorId[baseId] = next
      }
      delete state.planCanvasPlanImageOffsetByFloorId[id]
    }),

  togglePlanFloorOverlayFloor: (baseFloorId, overlayFloorId) =>
    set((state) => {
      if (baseFloorId === overlayFloorId) return
      const cur = state.planFloorOverlayVisibleByBaseFloorId[baseFloorId] ?? []
      const setIds = new Set(cur)
      if (setIds.has(overlayFloorId)) setIds.delete(overlayFloorId)
      else setIds.add(overlayFloorId)
      const next = [...setIds]
      if (next.length === 0) delete state.planFloorOverlayVisibleByBaseFloorId[baseFloorId]
      else state.planFloorOverlayVisibleByBaseFloorId[baseFloorId] = next
    }),

  ensurePlanReferenceOverlayAboveInList: (baseFloorId) =>
    set((state) => {
      if (!state.currentProject) return
      const floors = readLegacyCompatibilityFloors(state.currentProject)
      const cur = state.planFloorOverlayVisibleByBaseFloorId[baseFloorId] ?? []
      if (cur.length > 0) return
      const defaultOverlayFloorId = pickDefaultPlanReferenceOverlayFloor(floors, baseFloorId)
      if (!defaultOverlayFloorId) return
      state.planFloorOverlayVisibleByBaseFloorId[baseFloorId] = [defaultOverlayFloorId]
    }),

  setPlanCanvasPlanImageOffset: (floorId, pos) =>
    set((state) => {
      state.planCanvasPlanImageOffsetByFloorId[floorId] = { x: pos.x, y: pos.y }
    }),

  reorderFloors: (fromIndex, toIndex) =>
    set((state) => {
      if (!state.currentProject || fromIndex === toIndex) return
      const reordered = mutateBuildingFloorViews(state.currentProject, (floors) => {
        if (fromIndex < 0 || fromIndex >= floors.length || toIndex < 0 || toIndex >= floors.length)
          return
        const [removed] = floors.splice(fromIndex, 1)
        floors.splice(toIndex, 0, removed!)
      })
      if (
        fromIndex < 0 ||
        fromIndex >= reordered.length ||
        toIndex < 0 ||
        toIndex >= reordered.length
      )
        return
      state.isDirty = true
    }),

  // Floor plan actions
  addWall: (floorId, wall) =>
    set((state) => {
      if (state.currentProject) {
        const floor = readLegacyCompatibilityFloors(state.currentProject).find(
          (f) => f.id === floorId
        )
        if (floor) {
          if (!floor.floorPlan) {
            floor.floorPlan = {
              walls: [],
              doors: [],
              windows: [],
              stairs: [],
              graphicElements: [],
              masterWallThickness: 20,
            }
          }
          const DEDUP_THRESHOLD = 1.0
          const isDuplicate =
            !wall.curve &&
            floor.floorPlan.walls.some((existing) => {
              if (isCurvedWall(existing) || existing.points.length !== wall.points.length)
                return false
              const n = wall.points.length
              const allMatch = (forward: boolean) =>
                wall.points.every((p, i) => {
                  const q = existing.points[forward ? i : n - 1 - i]!
                  return (
                    Math.abs(p.x - q.x) <= DEDUP_THRESHOLD && Math.abs(p.y - q.y) <= DEDUP_THRESHOLD
                  )
                })
              return allMatch(true) || allMatch(false)
            })
          if (isDuplicate) return
          floor.floorPlan.walls.push({
            ...wall,
            id: generateId(),
          })
          commitBuildingFloorView(state.currentProject, floor.id, floor)
          state.isDirty = true
        }
      }
    }),

  updateWall: (wallId, updates) =>
    set((state) => {
      if (
        state.currentProject &&
        updateBuildingPropertiesInProject(
          state.currentProject,
          'wall',
          wallId,
          updates as Record<string, unknown>
        )
      )
        state.isDirty = true
    }),

  deleteWall: (wallId) =>
    set((state) => {
      if (
        state.currentProject &&
        deleteBuildingEntitiesInProject(state.currentProject, 'wall', [wallId])
      )
        state.isDirty = true
    }),

  deleteWalls: (wallIds) =>
    set((state) => {
      if (
        state.currentProject &&
        deleteBuildingEntitiesInProject(state.currentProject, 'wall', wallIds)
      )
        state.isDirty = true
    }),

  mergeWallPoints: (floorId, wallId1, pointIndex1, wallId2, pointIndex2) => {
    const state = get()
    const floor = state.currentProject
      ? readLegacyCompatibilityFloors(state.currentProject).find((f) => f.id === floorId)
      : undefined
    if (!floor?.floorPlan) return false
    const walls = floor.floorPlan.walls
    const wall1 = walls.find((w) => w.id === wallId1)
    const wall2 = walls.find((w) => w.id === wallId2)
    if (!wall1 || !wall2 || wall1.points.length < 2 || wall2.points.length < 2) return false
    // Curves remain standalone entities; their middle point is a geometric control, not a join vertex.
    if (isCurvedWall(wall1) || isCurvedWall(wall2)) return false

    const p1 = wall1.points[pointIndex1]
    const p2 = wall2.points[pointIndex2]
    if (!p1 || !p2) return false

    const MERGE_THRESHOLD = 1.0
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    if (Math.sqrt(dx * dx + dy * dy) > MERGE_THRESHOLD) return false

    const mergedPoint: Point2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }

    if (wallId1 === wallId2) {
      const i = Math.min(pointIndex1, pointIndex2)
      const j = Math.max(pointIndex1, pointIndex2)
      if (i === j) return false
      const newPoints = [...wall1.points.slice(0, i), mergedPoint, ...wall1.points.slice(j + 1)]
      if (newPoints.length < 2) return false
      state.updateWall(wallId1, { points: newPoints })
      return true
    }

    const n1 = wall1.points.length
    const n2 = wall2.points.length
    const is1Last = pointIndex1 === n1 - 1
    const is1First = pointIndex1 === 0
    const is2Last = pointIndex2 === n2 - 1
    const is2First = pointIndex2 === 0

    // Detect fully overlapping walls: all segments of one wall coincide with segments of the other.
    if (wallId1 !== wallId2 && n1 === n2) {
      const allMatch = (forward: boolean) =>
        wall1.points.every((p, i) => {
          const q = wall2.points[forward ? i : n2 - 1 - i]!
          return Math.abs(p.x - q.x) <= MERGE_THRESHOLD && Math.abs(p.y - q.y) <= MERGE_THRESHOLD
        })
      if (allMatch(true) || allMatch(false)) {
        // Walls are duplicates — keep the first, transfer openings, delete the second.
        for (const door of floor.floorPlan.doors) {
          if (door.wallId === wall2.id) {
            state.updateDoor(door.id, { wallId: wall1.id })
          }
        }
        for (const window of floor.floorPlan.windows) {
          if (window.wallId === wall2.id) {
            state.updateWindow(window.id, { wallId: wall1.id })
          }
        }
        state.deleteWall(wall2.id)
        return true
      }
    }

    const endpointMerge = (is1Last && is2First) || (is1First && is2Last)
    if (!endpointMerge) return false

    let keeperWall: Wall
    let otherWall: Wall
    let mergedPoints: Point2[]

    if (is1Last && is2First) {
      keeperWall = wall1
      otherWall = wall2
      mergedPoints = [...wall1.points.slice(0, -1), mergedPoint, ...wall2.points.slice(1)]
    } else {
      keeperWall = wall2
      otherWall = wall1
      mergedPoints = [...wall2.points.slice(0, -1), mergedPoint, ...wall1.points.slice(1)]
    }
    if (mergedPoints.length < 2) return false

    const totalMerged = getWallTotalLengthFromPoints(mergedPoints)
    if (totalMerged < 1e-10) return false

    const keeperPoints = keeperWall.points
    const otherPoints = otherWall.points
    const cumKeeper = cumulativeLengths(keeperPoints)
    const cumOther = cumulativeLengths(otherPoints)
    const totalOther = cumOther[cumOther.length - 1] ?? 0
    const distToM = cumKeeper[cumKeeper.length - 2] ?? 0
    const firstSegLenOther = totalOther > 0 ? (cumOther[1] ?? 0) - (cumOther[0] ?? 0) : 0
    const distMToOther1 = Math.sqrt(
      (otherPoints[1]!.x - mergedPoint.x) ** 2 + (otherPoints[1]!.y - mergedPoint.y) ** 2
    )
    const startOfOtherPart = distToM + distMToOther1

    const mapPosition = (positionOnOther: number): number => {
      const distOnOther = positionOnOther * totalOther
      const newDist =
        distOnOther <= firstSegLenOther
          ? startOfOtherPart
          : startOfOtherPart + (distOnOther - firstSegLenOther)
      return clamp(newDist / totalMerged, 0, 1)
    }

    state.updateWall(keeperWall.id, { points: mergedPoints })

    for (const door of floor.floorPlan.doors) {
      if (door.wallId === otherWall.id) {
        state.updateDoor(door.id, { wallId: keeperWall.id, position: mapPosition(door.position) })
      }
    }
    for (const window of floor.floorPlan.windows) {
      if (window.wallId === otherWall.id) {
        state.updateWindow(window.id, {
          wallId: keeperWall.id,
          position: mapPosition(window.position),
        })
      }
    }

    state.deleteWall(otherWall.id)
    return true
  },

  getWallsByFloor: (floorId) => {
    const { currentProject } = get()
    if (!currentProject) return []
    const floor = readLegacyCompatibilityFloors(currentProject).find((f) => f.id === floorId)
    return floor?.floorPlan?.walls ?? []
  },

  addDoor: (floorId, door) =>
    set((state) => {
      if (state.currentProject) {
        const floor = readLegacyCompatibilityFloors(state.currentProject).find(
          (f) => f.id === floorId
        )
        if (floor) {
          if (!floor.floorPlan) {
            floor.floorPlan = {
              walls: [],
              doors: [],
              windows: [],
              stairs: [],
              graphicElements: [],
              masterWallThickness: 20,
            }
          }
          const wall = floor.floorPlan.walls.find((w) => w.id === door.wallId)
          if (!wall || isCurvedWall(wall)) return
          const newDoor = { ...door, id: generateId() }
          floor.floorPlan.doors.push(newDoor)
          if (wall && wall.points.length >= 2) {
            const wallDoors = floor.floorPlan.doors.filter((d) => d.wallId === door.wallId)
            const wallWindows = floor.floorPlan.windows.filter((w) => w.wallId === door.wallId)
            const { doorUpdates, windowUpdates } = sanitizeWallOpeningPositions(
              wall.points,
              wallDoors,
              wallWindows
            )
            for (const u of doorUpdates) {
              const d = floor.floorPlan!.doors.find((x) => x.id === u.id)
              if (d) d.position = u.position
            }
            for (const u of windowUpdates) {
              const w = floor.floorPlan!.windows.find((x) => x.id === u.id)
              if (w) w.position = u.position
            }
            const finalWallDoors = floor.floorPlan.doors.filter((d) => d.wallId === door.wallId)
            const finalWallWindows = floor.floorPlan.windows.filter((w) => w.wallId === door.wallId)
            recomputeOpeningLocalFromNormalized(wall.points, finalWallDoors, finalWallWindows)
          }
          commitBuildingFloorView(state.currentProject, floor.id, floor)
          state.isDirty = true
        }
      }
    }),

  updateDoor: (doorId, updates) =>
    set((state) => {
      if (
        state.currentProject &&
        updateBuildingPropertiesInProject(
          state.currentProject,
          'door',
          doorId,
          updates as Record<string, unknown>
        )
      )
        state.isDirty = true
    }),

  deleteDoor: (doorId) =>
    set((state) => {
      if (
        state.currentProject &&
        deleteBuildingEntitiesInProject(state.currentProject, 'door', [doorId])
      )
        state.isDirty = true
    }),

  addWindow: (floorId, window) =>
    set((state) => {
      if (state.currentProject) {
        const floor = readLegacyCompatibilityFloors(state.currentProject).find(
          (f) => f.id === floorId
        )
        if (floor) {
          if (!floor.floorPlan) {
            floor.floorPlan = {
              walls: [],
              doors: [],
              windows: [],
              stairs: [],
              graphicElements: [],
              masterWallThickness: 20,
            }
          }
          const wall = floor.floorPlan.walls.find((w) => w.id === window.wallId)
          if (!wall || isCurvedWall(wall)) return
          const newWindow = { ...window, id: generateId() }
          floor.floorPlan.windows.push(newWindow)
          if (wall && wall.points.length >= 2) {
            const wallDoors = floor.floorPlan.doors.filter((d) => d.wallId === window.wallId)
            const wallWindows = floor.floorPlan.windows.filter((w) => w.wallId === window.wallId)
            const { doorUpdates, windowUpdates } = sanitizeWallOpeningPositions(
              wall.points,
              wallDoors,
              wallWindows
            )
            for (const u of doorUpdates) {
              const d = floor.floorPlan!.doors.find((x) => x.id === u.id)
              if (d) d.position = u.position
            }
            for (const u of windowUpdates) {
              const w = floor.floorPlan!.windows.find((x) => x.id === u.id)
              if (w) w.position = u.position
            }
            const finalWallDoors = floor.floorPlan.doors.filter((d) => d.wallId === window.wallId)
            const finalWallWindows = floor.floorPlan.windows.filter(
              (w) => w.wallId === window.wallId
            )
            recomputeOpeningLocalFromNormalized(wall.points, finalWallDoors, finalWallWindows)
          }
          commitBuildingFloorView(state.currentProject, floor.id, floor)
          state.isDirty = true
        }
      }
    }),

  updateWindow: (windowId, updates) =>
    set((state) => {
      if (
        state.currentProject &&
        updateBuildingPropertiesInProject(
          state.currentProject,
          'window',
          windowId,
          updates as Record<string, unknown>
        )
      )
        state.isDirty = true
    }),

  deleteWindow: (windowId) =>
    set((state) => {
      if (
        state.currentProject &&
        deleteBuildingEntitiesInProject(state.currentProject, 'window', [windowId])
      )
        state.isDirty = true
    }),

  addStair: (floorId, stair) =>
    set((state) => {
      if (!state.currentProject) return
      const floor = readLegacyCompatibilityFloors(state.currentProject).find(
        (f) => f.id === floorId
      )
      if (!floor) return
      if (!floor.floorPlan) {
        floor.floorPlan = {
          walls: [],
          doors: [],
          windows: [],
          stairs: [],
          graphicElements: [],
          masterWallThickness: 20,
        }
      }
      if (!Array.isArray(floor.floorPlan.stairs)) {
        floor.floorPlan.stairs = []
      }
      floor.floorPlan.stairs.push({ ...stair, id: generateId() })
      commitBuildingFloorView(state.currentProject, floor.id, floor)
      state.isDirty = true
    }),

  updateStair: (stairId, updates) =>
    set((state) => {
      if (
        state.currentProject &&
        updateBuildingPropertiesInProject(
          state.currentProject,
          'stair',
          stairId,
          updates as Record<string, unknown>
        )
      )
        state.isDirty = true
    }),

  deleteStair: (stairId) =>
    set((state) => {
      if (
        state.currentProject &&
        deleteBuildingEntitiesInProject(state.currentProject, 'stair', [stairId])
      )
        state.isDirty = true
    }),

  addPlanGraphicElement: (floorId: string, element: Omit<PlanGraphicElement, 'id'>) =>
    set((state) => {
      if (!state.currentProject) return
      const floor = readLegacyCompatibilityFloors(state.currentProject).find(
        (f) => f.id === floorId
      )
      if (!floor) return
      if (!floor.floorPlan) {
        floor.floorPlan = {
          walls: [],
          doors: [],
          windows: [],
          stairs: [],
          graphicElements: [],
          masterWallThickness: 20,
        }
      }
      if (!Array.isArray(floor.floorPlan.graphicElements)) {
        floor.floorPlan.graphicElements = []
      }
      floor.floorPlan.graphicElements.push({ ...element, id: generateId() })
      commitBuildingFloorView(state.currentProject, floor.id, floor)
      state.isDirty = true
    }),

  updatePlanGraphicElement: (elementId: string, updates: Partial<PlanGraphicElement>) =>
    set((state) => {
      if (
        state.currentProject &&
        updateBuildingPropertiesInProject(
          state.currentProject,
          'graphicElement',
          elementId,
          updates as Record<string, unknown>
        )
      )
        state.isDirty = true
    }),

  deletePlanGraphicElement: (elementId) =>
    set((state) => {
      if (
        state.currentProject &&
        deleteBuildingEntitiesInProject(state.currentProject, 'graphicElement', [elementId])
      )
        state.isDirty = true
    }),

  updateFloorPlanSettings: (floorId, settings) =>
    set((state) => {
      if (state.currentProject) {
        const floor = readLegacyCompatibilityFloors(state.currentProject).find(
          (f) => f.id === floorId
        )
        if (floor) {
          if (!floor.floorPlan) {
            floor.floorPlan = {
              walls: [],
              doors: [],
              windows: [],
              stairs: [],
              graphicElements: [],
              masterWallThickness: 20,
            }
          }
          if (settings.masterWallThickness !== undefined) {
            floor.floorPlan.masterWallThickness = settings.masterWallThickness
          }
          commitBuildingFloorView(state.currentProject, floor.id, floor)
          state.isDirty = true
        }
      }
    }),
})
