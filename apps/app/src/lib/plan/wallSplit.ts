import type { FloorPlan, Point2, Wall } from '@/types/schema'
import { recomputeOpeningLocalFromNormalized } from '@/lib/plan/constraints'
import { clamp } from '@/lib/geometry'

const SPLIT_EPSILON = 1e-7

export type WallSplit = {
  wallIndex: number
  wall: Wall
  firstPoints: Point2[]
  secondPoints: Point2[]
  splitDistance: number
  totalLength: number
  splitPosition: number
}

export function wallSplitCrossesOpening(
  floorPlan: FloorPlan,
  wallId: string,
  segmentIndex: number,
  t: number
): boolean {
  const wall = floorPlan.walls.find((candidate) => candidate.id === wallId)
  if (
    !wall ||
    wall.curve ||
    !Number.isInteger(segmentIndex) ||
    segmentIndex < 0 ||
    segmentIndex >= wall.points.length - 1 ||
    !Number.isFinite(t) ||
    t <= 0 ||
    t >= 1
  )
    return false
  const lengths = wall.points.slice(0, -1).map((point, index) => {
    const next = wall.points[index + 1]!
    return Math.hypot(next.x - point.x, next.y - point.y)
  })
  const totalLength = lengths.reduce((sum, length) => sum + length, 0)
  const splitDistance =
    lengths.slice(0, segmentIndex).reduce((sum, length) => sum + length, 0) +
    lengths[segmentIndex]! * t
  const crosses = (position: number, width: number) => {
    const center = clamp(position, 0, 1) * totalLength
    const halfWidth = Math.max(0, width) / 2
    return (
      center - halfWidth + SPLIT_EPSILON < splitDistance &&
      splitDistance < center + halfWidth - SPLIT_EPSILON
    )
  }
  return (
    floorPlan.doors.some((door) => door.wallId === wallId && crosses(door.position, door.width)) ||
    floorPlan.windows.some(
      (window) => window.wallId === wallId && crosses(window.position, window.width)
    )
  )
}

export function resolveWallSplit(
  floorPlan: FloorPlan,
  wallId: string,
  segmentIndex: number,
  t: number
): WallSplit | null {
  const wallIndex = floorPlan.walls.findIndex((candidate) => candidate.id === wallId)
  const wall = floorPlan.walls[wallIndex]
  if (
    !wall ||
    wall.curve ||
    !Number.isInteger(segmentIndex) ||
    segmentIndex < 0 ||
    segmentIndex >= wall.points.length - 1 ||
    !Number.isFinite(t) ||
    t <= 0 ||
    t >= 1
  )
    return null

  let totalLength = 0
  let splitDistance = 0
  const segmentLengths: number[] = []
  for (let index = 0; index < wall.points.length - 1; index++) {
    const start = wall.points[index]
    const end = wall.points[index + 1]
    if (!start || !end) return null
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    if (index === segmentIndex) splitDistance = totalLength + length * t
    segmentLengths.push(length)
    totalLength += length
  }
  if (totalLength <= SPLIT_EPSILON) return null

  const start = wall.points[segmentIndex]!
  const end = wall.points[segmentIndex + 1]!
  const splitPoint = {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  }
  const firstPoints = [...wall.points.slice(0, segmentIndex + 1), splitPoint]
  const secondPoints = [splitPoint, ...wall.points.slice(segmentIndex + 1)]
  if (firstPoints.length < 2 || secondPoints.length < 2) return null

  if (wallSplitCrossesOpening(floorPlan, wallId, segmentIndex, t)) return null

  // A split through a zero-length segment is not useful even if another segment is nonzero.
  if (segmentLengths[segmentIndex]! <= SPLIT_EPSILON) return null
  return {
    wallIndex,
    wall,
    firstPoints,
    secondPoints,
    splitDistance,
    totalLength,
    splitPosition: splitDistance / totalLength,
  }
}

export type SplitWallResult = {
  createdWall: Wall
  changedWallIds: string[]
  changedDoorIds: string[]
  changedWindowIds: string[]
}

export function splitWallInFloorPlan(
  floorPlan: FloorPlan,
  wallId: string,
  segmentIndex: number,
  t: number,
  newId: string
): SplitWallResult | null {
  const split = resolveWallSplit(floorPlan, wallId, segmentIndex, t)
  if (!split) return null
  const { wall, wallIndex, firstPoints, secondPoints, splitPosition, totalLength } = split
  const newWall: Wall = {
    ...wall,
    id: newId,
    points: secondPoints,
    ...(wall.attachedPoints ? { attachedPoints: [] } : {}),
  }

  const firstAttachments = [] as NonNullable<Wall['attachedPoints']>
  const secondAttachments = [] as NonNullable<Wall['attachedPoints']>
  for (const attachment of wall.attachedPoints ?? []) {
    if (attachment.wallId === wallId) continue
    if (attachment.pointIndex <= segmentIndex) firstAttachments.push({ ...attachment })
    else secondAttachments.push({ ...attachment, pointIndex: attachment.pointIndex - segmentIndex })
  }
  if (wall.attachedPoints) {
    wall.attachedPoints = firstAttachments
    newWall.attachedPoints = secondAttachments
  }
  wall.points = firstPoints

  const changedWallIds = new Set<string>([wallId])
  for (const dependent of floorPlan.walls) {
    if (
      dependent.id === wallId ||
      !dependent.attachedPoints?.some((attachment) => attachment.wallId === wallId)
    )
      continue
    dependent.attachedPoints = dependent.attachedPoints.map((attachment) => {
      if (attachment.wallId !== wallId) return attachment
      const position = clamp(attachment.t, 0, 1)
      if (position <= splitPosition) {
        return { ...attachment, t: position / splitPosition }
      }
      return {
        ...attachment,
        wallId: newId,
        t: (position - splitPosition) / (1 - splitPosition),
      }
    })
    changedWallIds.add(dependent.id)
  }

  const changedDoorIds: string[] = []
  const changedWindowIds: string[] = []
  for (const door of floorPlan.doors) {
    if (door.wallId !== wallId) continue
    const distance = clamp(door.position, 0, 1) * totalLength
    if (distance <= split.splitDistance) {
      door.position = clamp(distance / split.splitDistance, 0, 1)
    } else {
      door.wallId = newId
      door.position = clamp(
        (distance - split.splitDistance) / (totalLength - split.splitDistance),
        0,
        1
      )
    }
    changedDoorIds.push(door.id)
  }
  for (const window of floorPlan.windows) {
    if (window.wallId !== wallId) continue
    const distance = clamp(window.position, 0, 1) * totalLength
    if (distance <= split.splitDistance) {
      window.position = clamp(distance / split.splitDistance, 0, 1)
    } else {
      window.wallId = newId
      window.position = clamp(
        (distance - split.splitDistance) / (totalLength - split.splitDistance),
        0,
        1
      )
    }
    changedWindowIds.push(window.id)
  }

  recomputeOpeningLocalFromNormalized(
    wall.points,
    floorPlan.doors.filter((door) => door.wallId === wallId),
    floorPlan.windows.filter((window) => window.wallId === wallId)
  )
  recomputeOpeningLocalFromNormalized(
    newWall.points,
    floorPlan.doors.filter((door) => door.wallId === newId),
    floorPlan.windows.filter((window) => window.wallId === newId)
  )

  floorPlan.walls.splice(wallIndex + 1, 0, newWall)
  return {
    createdWall: newWall,
    changedWallIds: [...changedWallIds],
    changedDoorIds,
    changedWindowIds,
  }
}
