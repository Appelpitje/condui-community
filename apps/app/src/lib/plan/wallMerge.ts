import type { Door, FloorPlan, Point2, Wall, Window } from '@/types/schema'
import { clamp } from '@/lib/geometry'
import {
  getWallTotalLengthFromPoints,
  preserveOpeningWorldPositionsAfterPointChange,
  recomputeOpeningLocalFromNormalized,
  sanitizeWallOpeningPositions,
} from '@/lib/plan/constraints'
import { isCurvedWall } from '@/lib/plan/wallCurve'

const MERGE_THRESHOLD = 1

function repairOpeningsAfterWallChange(
  points: Point2[],
  doors: Door[],
  windows: Window[],
  oldPoints?: Point2[],
  preserveIds?: Set<string>
): void {
  if (oldPoints) {
    const preserved = preserveOpeningWorldPositionsAfterPointChange(
      oldPoints,
      points,
      doors,
      windows,
      preserveIds
        ? new Set(
            [...doors, ...windows].map((item) => item.id).filter((id) => !preserveIds.has(id))
          )
        : new Set()
    )
    for (const update of preserved.doorUpdates) {
      const door = doors.find((item) => item.id === update.id)
      if (door) door.position = update.position
    }
    for (const update of preserved.windowUpdates) {
      const window = windows.find((item) => item.id === update.id)
      if (window) window.position = update.position
    }
  }
  const fitted = sanitizeWallOpeningPositions(points, doors, windows)
  for (const update of fitted.doorUpdates) {
    const door = doors.find((item) => item.id === update.id)
    if (door) door.position = update.position
  }
  for (const update of fitted.windowUpdates) {
    const window = windows.find((item) => item.id === update.id)
    if (window) window.position = update.position
  }
  recomputeOpeningLocalFromNormalized(points, doors, windows)
}

function coincidentWalls(wall1: Wall, wall2: Wall): boolean {
  if (wall1.points.length !== wall2.points.length) return false
  const count = wall1.points.length
  const allMatch = (forward: boolean) =>
    wall1.points.every((point, index) => {
      const other = wall2.points[forward ? index : count - 1 - index]!
      return (
        Math.abs(point.x - other.x) <= MERGE_THRESHOLD &&
        Math.abs(point.y - other.y) <= MERGE_THRESHOLD
      )
    })
  return allMatch(true) || allMatch(false)
}

function mergeWallAttachments(
  floorPlan: FloorPlan,
  keeperWall: Wall,
  otherWall: Wall,
  mapOtherPosition: (position: number) => number,
  mapKeeperPosition: (position: number) => number,
  mapOtherPointIndex: (pointIndex: number) => number
): void {
  for (const wall of floorPlan.walls) {
    if (wall.id === otherWall.id || !wall.attachedPoints) continue
    wall.attachedPoints = wall.attachedPoints.flatMap((attachment) => {
      if (attachment.wallId === otherWall.id) {
        if (wall.id === keeperWall.id) return []
        return [{ ...attachment, wallId: keeperWall.id, t: mapOtherPosition(attachment.t) }]
      }
      if (attachment.wallId === keeperWall.id) {
        return [{ ...attachment, t: mapKeeperPosition(attachment.t) }]
      }
      return [attachment]
    })
  }

  const transferred = (otherWall.attachedPoints ?? []).flatMap((attachment) => {
    const wallId = attachment.wallId === otherWall.id ? keeperWall.id : attachment.wallId
    if (wallId === keeperWall.id) return []
    return [
      {
        ...attachment,
        wallId,
        pointIndex: mapOtherPointIndex(attachment.pointIndex),
      },
    ]
  })
  keeperWall.attachedPoints = [
    ...(keeperWall.attachedPoints ?? []).filter(
      (attachment) => attachment.wallId !== keeperWall.id && attachment.wallId !== otherWall.id
    ),
    ...transferred,
  ]
}

/** Join two straight wall vertices while preserving the original opening ownership and positions. */
export function mergeWallPointsInFloorPlan(
  floorPlan: FloorPlan,
  wallId1: string,
  pointIndex1: number,
  wallId2: string,
  pointIndex2: number
): boolean {
  const wall1 = floorPlan.walls.find((wall) => wall.id === wallId1)
  const wall2 = floorPlan.walls.find((wall) => wall.id === wallId2)
  if (!wall1 || !wall2 || wall1.points.length < 2 || wall2.points.length < 2) return false
  if (isCurvedWall(wall1) || isCurvedWall(wall2)) return false
  const p1 = wall1.points[pointIndex1]
  const p2 = wall2.points[pointIndex2]
  if (!p1 || !p2 || Math.hypot(p2.x - p1.x, p2.y - p1.y) > MERGE_THRESHOLD) return false
  const mergedPoint: Point2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }

  if (wallId1 === wallId2) {
    const start = Math.min(pointIndex1, pointIndex2)
    const end = Math.max(pointIndex1, pointIndex2)
    if (start === end) return false
    const oldPoints = wall1.points.map((point) => ({ ...point }))
    const points = [...wall1.points.slice(0, start), mergedPoint, ...wall1.points.slice(end + 1)]
    if (points.length < 2) return false
    wall1.points = points
    const collapsedPointCount = end - start
    wall1.attachedPoints = wall1.attachedPoints?.flatMap((attachment) => {
      if (
        !Number.isInteger(attachment.pointIndex) ||
        attachment.pointIndex < 0 ||
        attachment.pointIndex >= oldPoints.length
      ) {
        return []
      }
      const pointIndex =
        attachment.pointIndex <= start
          ? attachment.pointIndex
          : attachment.pointIndex <= end
            ? start
            : attachment.pointIndex - collapsedPointCount
      return [{ ...attachment, pointIndex }]
    })
    repairOpeningsAfterWallChange(
      points,
      floorPlan.doors.filter((door) => door.wallId === wall1.id),
      floorPlan.windows.filter((window) => window.wallId === wall1.id),
      oldPoints
    )
    return true
  }

  const n1 = wall1.points.length
  const n2 = wall2.points.length
  if (n1 === n2 && coincidentWalls(wall1, wall2)) {
    const forward = wall1.points.every((point, index) => {
      const other = wall2.points[index]!
      return (
        Math.abs(point.x - other.x) <= MERGE_THRESHOLD &&
        Math.abs(point.y - other.y) <= MERGE_THRESHOLD
      )
    })
    const reversed =
      !forward &&
      wall1.points.every((point, index) => {
        const other = wall2.points[n2 - 1 - index]!
        return (
          Math.abs(point.x - other.x) <= MERGE_THRESHOLD &&
          Math.abs(point.y - other.y) <= MERGE_THRESHOLD
        )
      })
    mergeWallAttachments(
      floorPlan,
      wall1,
      wall2,
      (position) => (reversed ? 1 - position : position),
      (position) => position,
      (pointIndex) => (reversed ? n1 - 1 - pointIndex : pointIndex)
    )
    floorPlan.doors = floorPlan.doors.map((door) =>
      door.wallId === wall2.id
        ? { ...door, wallId: wall1.id, position: reversed ? 1 - door.position : door.position }
        : door
    )
    floorPlan.windows = floorPlan.windows.map((window) =>
      window.wallId === wall2.id
        ? {
            ...window,
            wallId: wall1.id,
            position: reversed ? 1 - window.position : window.position,
          }
        : window
    )
    floorPlan.walls = floorPlan.walls.filter((wall) => wall.id !== wall2.id)
    repairOpeningsAfterWallChange(
      wall1.points,
      floorPlan.doors.filter((door) => door.wallId === wall1.id),
      floorPlan.windows.filter((window) => window.wallId === wall1.id)
    )
    return true
  }

  const is1Last = pointIndex1 === n1 - 1
  const is1First = pointIndex1 === 0
  const is2Last = pointIndex2 === n2 - 1
  const is2First = pointIndex2 === 0
  if (!((is1Last && is2First) || (is1First && is2Last))) return false

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
  const totalMerged = getWallTotalLengthFromPoints(mergedPoints)
  if (mergedPoints.length < 2 || totalMerged < 1e-10) return false

  const oldKeeperPoints = keeperWall.points.map((point) => ({ ...point }))
  const keeperDoorIds = new Set(
    floorPlan.doors.filter((door) => door.wallId === keeperWall.id).map((door) => door.id)
  )
  const keeperWindowIds = new Set(
    floorPlan.windows.filter((window) => window.wallId === keeperWall.id).map((window) => window.id)
  )
  const totalOther = getWallTotalLengthFromPoints(otherWall.points)
  const distanceToJoin = getWallTotalLengthFromPoints(keeperWall.points)
  const mapPosition = (position: number) => {
    const distance = position * totalOther
    return clamp((distanceToJoin + distance) / totalMerged, 0, 1)
  }
  const mapKeeperPosition = (position: number) =>
    clamp((position * distanceToJoin) / totalMerged, 0, 1)
  const keeperPointCount = keeperWall.points.length
  const mapPointIndex = (pointIndex: number) => keeperPointCount + pointIndex - 1

  mergeWallAttachments(
    floorPlan,
    keeperWall,
    otherWall,
    mapPosition,
    mapKeeperPosition,
    mapPointIndex
  )
  keeperWall.points = mergedPoints
  floorPlan.doors = floorPlan.doors.map((door) =>
    door.wallId === otherWall.id
      ? { ...door, wallId: keeperWall.id, position: mapPosition(door.position) }
      : door
  )
  floorPlan.windows = floorPlan.windows.map((window) =>
    window.wallId === otherWall.id
      ? { ...window, wallId: keeperWall.id, position: mapPosition(window.position) }
      : window
  )
  floorPlan.walls = floorPlan.walls.filter((wall) => wall.id !== otherWall.id)
  repairOpeningsAfterWallChange(
    keeperWall.points,
    floorPlan.doors.filter((door) => door.wallId === keeperWall.id),
    floorPlan.windows.filter((window) => window.wallId === keeperWall.id),
    oldKeeperPoints,
    new Set([...keeperDoorIds, ...keeperWindowIds])
  )
  return true
}

// Preserve entity typing for callers that need to build update sets around the same geometry.
export type WallOpening = Door | Window
