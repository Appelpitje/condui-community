import { z } from 'zod'
import { isRoomScanWallFixture, roomScanModelSchema, roomScanObservationSchema, type RoomScanObservation } from './roomScanCapture'
import type { Door, FloorPlan, Point2, Wall, Window } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import {
  getBuildingFloorById,
  getPlanImportAssetForBuildingFloor,
  selectProjectFloorPlan,
  selectProjectPlanScale,
} from '@/lib/projectV2/buildingFloors'
import { DEFAULT_PLAN_PX_PER_METER, resolvePlanPxPerMeter } from './planScale'
import { estimateRoomPlanThickness, mergeRoomPlanWallRuns } from './roomPlanWallCleanup'
import { detectScanRooms, scanRoomContains, type ScanRoom } from './roomScanRooms'
import { resolveSitplanSymbolSizeCm } from './sitplanSymbolMetrics'
import { PANEL_SYMBOL_HEIGHT, SYMBOL_SIZE, PLAN_PANEL_VISUAL_SCALE } from '@/lib/canvas/symbolGeometry'
import { centerRoomPlanWalls } from './roomPlanWallCenterlines'

const coordinate = z.number().finite().min(-10_000).max(10_000)
const scanPoint = z.object({ x: coordinate, z: coordinate }).strict()
const surfaceSchema = z.object({
  id: z.string().min(1),
  parentWallId: z.string().min(1).optional(),
  center: scanPoint,
  start: scanPoint,
  end: scanPoint,
  width: z.number().finite().positive().max(1_000),
  height: z.number().finite().nonnegative().max(1_000),
  elevation: coordinate,
}).strict()

/** Local RoomPlan bridge contract. No native runtime enters the command graph. */
export const roomPlanScanSchema = z.object({
  schemaVersion: z.literal(1),
  units: z.literal('meters'),
  walls: z.array(surfaceSchema).max(1_000),
  doors: z.array(surfaceSchema).max(1_000),
  windows: z.array(surfaceSchema).max(1_000),
  openings: z.array(surfaceSchema).max(1_000),
  cameraPositions: z.array(scanPoint).max(1_000).optional(),
  floorElevation: coordinate.optional(),
  sections: z.array(z.object({ label: z.string().max(80), center: scanPoint }).strict()).max(100).optional(),
  placements: z.array(roomScanObservationSchema).max(80).optional(),
  model: roomScanModelSchema.optional(),
}).strict().superRefine((scan, ctx) => {
  const ids = new Set<string>()
  for (const surface of [...scan.walls, ...scan.doors, ...scan.windows, ...scan.openings]) {
    if (ids.has(surface.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate scan surface id' })
    ids.add(surface.id)
  }
  const observationIds = new Set<string>()
  for (const observation of scan.placements ?? []) {
    if (observationIds.has(observation.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate scan observation id' })
    observationIds.add(observation.id)
  }
})

export type RoomPlanScanResult = z.infer<typeof roomPlanScanSchema>
export type RoomPlanSurface = z.infer<typeof surfaceSchema>
export type RoomPlanQuarterTurns = 0 | 1 | 2 | 3

export function roomPlanImportScale(project: ProjectV2): number {
  return resolvePlanPxPerMeter(selectProjectPlanScale(project)) ?? DEFAULT_PLAN_PX_PER_METER
}

/** Put an additional room beside existing building geometry and the plan background. */
export function suggestRoomPlanImportOrigin(project: ProjectV2, floorId: string): Point2 {
  const plan = selectProjectFloorPlan(project, floorId)
  const points: Point2[] = [
    ...(plan?.walls.flatMap((wall) => wall.points) ?? []),
    ...(plan?.stairs?.flatMap((stair) => stair.points) ?? []),
    ...(plan?.graphicElements?.flatMap((element) => [
      { x: element.pos.x - element.width / 2, y: element.pos.y - element.height / 2 },
      { x: element.pos.x + element.width / 2, y: element.pos.y + element.height / 2 },
    ]) ?? []),
  ]
  const asset = getPlanImportAssetForBuildingFloor(project, floorId)
  const floor = getBuildingFloorById(project, floorId)
  if (asset?.width && asset.height) {
    const offset = floor?.planImageOffset ?? { x: 0, y: 0 }
    const angle = ((floor?.planImageRotationDeg ?? 0) * Math.PI) / 180
    for (const [x, y] of [[0, 0], [asset.width, 0], [0, asset.height], [asset.width, asset.height]]) {
      points.push({
        x: offset.x + x! * Math.cos(angle) - y! * Math.sin(angle),
        y: offset.y + x! * Math.sin(angle) + y! * Math.cos(angle),
      })
    }
  }
  if (points.length === 0) return { x: 0, y: 0 }
  return {
    x: Math.max(...points.map((point) => point.x)) + roomPlanImportScale(project),
    y: Math.min(...points.map((point) => point.y)),
  }
}

type MeterWall = { sourceId: string; points: [Point2, Point2] }

/** Parallel and perpendicular walls vote for the same axes, regardless of endpoint order. */
function dominantScanAngle(walls: MeterWall[]): number {
  const quarterTurn = Math.PI / 2
  const fold = (angle: number) => angle - Math.round(angle / quarterTurn) * quarterTurn
  const tolerance = Math.PI / 18 // A 10° consensus excludes separate diagonal wall families.
  const votes = walls.map(({ points: [a, b] }) => ({
    angle: fold(Math.atan2(b.y - a.y, b.x - a.x)),
    weight: Math.hypot(b.x - a.x, b.y - a.y),
  })).sort((a, b) => a.angle - b.angle)
  let best: { angle: number; weight: number; error: number } | undefined
  for (const seed of votes) {
    let weight = 0, error = 0
    for (const vote of votes) {
      const difference = fold(vote.angle - seed.angle)
      if (Math.abs(difference) > tolerance) continue
      weight += vote.weight
      error += vote.weight * difference * difference
    }
    if (!best || weight > best.weight + 1e-9 || (
      Math.abs(weight - best.weight) <= 1e-9 && (error < best.error - 1e-9 || (
        Math.abs(error - best.error) <= 1e-9 && Math.abs(seed.angle) < Math.abs(best.angle)
      ))
    )) best = { angle: seed.angle, weight, error }
  }
  if (!best) return 0
  let x = 0, y = 0
  for (const vote of votes) {
    if (Math.abs(fold(vote.angle - best.angle)) > tolerance) continue
    // Four-angle circular mean joins the two sides of the ±45° wrap boundary.
    x += vote.weight * Math.cos(4 * vote.angle)
    y += vote.weight * Math.sin(4 * vote.angle)
  }
  const angle = Math.atan2(y, x) / 4
  return Math.abs(angle) < 1e-12 ? 0 : angle
}

/** Join only endpoints within 5 cm; never join both ends of one wall. */
function joinScanCorners(walls: MeterWall[]): void {
  const clusters: Array<Array<{ wall: MeterWall; point: Point2 }>> = []
  for (const wall of walls) {
    for (const point of wall.points) {
      const cluster = clusters.find((members) => members.every((member) =>
        member.wall !== wall && Math.hypot(member.point.x - point.x, member.point.y - point.y) <= 0.05
      ))
      if (cluster) cluster.push({ wall, point })
      else clusters.push([{ wall, point }])
    }
  }
  for (const cluster of clusters) {
    const x = cluster.reduce((sum, member) => sum + member.point.x, 0) / cluster.length
    const y = cluster.reduce((sum, member) => sum + member.point.y, 0) / cluster.length
    for (const { point } of cluster) Object.assign(point, { x, y })
  }
}

/** Solve axis constraints together so snapping a wall never pulls a shared corner apart. */
function straightenScanWalls(walls: MeterWall[]): void {
  const vertices: Array<{ x: number; y: number; weight: number; points: Point2[] }> = []
  const byCoordinate = new Map<string, number>()
  const edges = walls.map(({ points: [a, b] }) => {
    const weight = Math.max(0.02, Math.hypot(b.x - a.x, b.y - a.y))
    return [a, b].map((point) => {
      const key = `${point.x},${point.y}`
      let index = byCoordinate.get(key)
      if (index === undefined) {
        index = vertices.length
        byCoordinate.set(key, index)
        vertices.push({ ...point, weight: 0, points: [] })
      }
      vertices[index]!.weight += weight
      vertices[index]!.points.push(point)
      return index
    })
  })
  const xParents = vertices.map((_, index) => index)
  const yParents = [...xParents]
  function root(parents: number[], index: number): number {
    let current = index
    while (parents[current] !== current) current = parents[current]!
    while (parents[index] !== index) {
      const next = parents[index]!
      parents[index] = current
      index = next
    }
    return current
  }
  const threshold = Math.sin(5 * Math.PI / 180)
  for (const [a, b] of edges) {
    const start = vertices[a!]!, end = vertices[b!]!
    const dx = end.x - start.x, dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    if (length < 0.02 || Math.min(Math.abs(dx), Math.abs(dy)) / length >= threshold) continue
    const parents = Math.abs(dx) < Math.abs(dy) ? xParents : yParents
    parents[root(parents, b!)] = root(parents, a!)
  }
  for (const [axis, parents] of [['x', xParents], ['y', yParents]] as const) {
    const groups = new Map<number, { sum: number; weight: number }>()
    vertices.forEach((vertex, index) => {
      const key = root(parents, index)
      const group = groups.get(key) ?? { sum: 0, weight: 0 }
      group.sum += vertex[axis] * vertex.weight
      group.weight += vertex.weight
      groups.set(key, group)
    })
    vertices.forEach((vertex, index) => {
      const group = groups.get(root(parents, index))!
      // Keep unconstrained coordinates exact instead of introducing roundoff.
      const value = parents[index] === index && group.weight === vertex.weight
        ? vertex[axis] : group.sum / group.weight
      for (const point of vertex.points) point[axis] = value
    })
  }
}

export type RoomPlanGeometryPreview = {
  floorPlan: FloorPlan
  pxPerMeter: number
  unmatchedOpenings: number
  skippedWalls: number
  widthMeters: number
  depthMeters: number
  estimatedThicknessWalls: number
  uncenteredWalls: number
  rooms: ScanRoom[]
  symbolSizePx: number
  placements: Array<RoomScanObservation & { pos: Point2; heightCm: number; rotationDeg: number; roomId?: string }>
}

/** Flatten X/Z and align the dominant wall axes, preserving scale and wall ownership. */
export function convertRoomPlanScan(scan: RoomPlanScanResult, options: {
  floorId: string
  pxPerMeter: number
  origin: Point2
  masterWallThickness?: number
  symbolSizeCm?: number
  quarterTurns?: RoomPlanQuarterTurns
  newId: () => string
}): RoomPlanGeometryPreview {
  const meterWalls: MeterWall[] = scan.walls
    .filter((wall) => Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z) >= 0.02)
    .map((wall) => ({
      sourceId: wall.id,
      points: [{ x: wall.start.x, y: wall.start.z }, { x: wall.end.x, y: wall.end.z }],
    }))
  const angle = dominantScanAngle(meterWalls)
  joinScanCorners(meterWalls)
  // Choose opening ownership in the source scan, then project onto corrected geometry.
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const align = (point: Point2): Point2 => ({
    x: point.x * cos + point.y * sin,
    y: -point.x * sin + point.y * cos,
  })
  const alignedWalls: MeterWall[] = meterWalls.map((wall) => ({
    sourceId: wall.sourceId, points: [align(wall.points[0]), align(wall.points[1])],
  }))
  straightenScanWalls(alignedWalls)
  const rotate = (point: Point2): Point2 => {
    switch (options.quarterTurns ?? 0) {
      case 1: return { x: -point.y, y: point.x }
      case 2: return { x: -point.x, y: -point.y }
      case 3: return { x: point.y, y: -point.x }
      default: return point
    }
  }
  const wallPairs = alignedWalls.map((wall, index) => ({
    source: meterWalls[index]!, points: [rotate(wall.points[0]), rotate(wall.points[1])] as [Point2, Point2],
  })).filter(({ points: [a, b] }) => Math.hypot(b.x - a.x, b.y - a.y) >= 0.02)
  const surfaceRuns = mergeRoomPlanWallRuns(wallPairs.map((wall) => wall.points))
  const cameraPositions = (scan.cameraPositions ?? []).map(({ x, z }) => rotate(align({ x, y: z })))
  const thicknessPairs = estimateRoomPlanThickness(surfaceRuns, cameraPositions)
  const runs = centerRoomPlanWalls(surfaceRuns, thicknessPairs, cameraPositions)
  const targetBySource = new Map<number, number>()
  runs.forEach((run, index) => run.sourceIndices.forEach((source) => targetBySource.set(source, index)))
  const points = runs.flatMap((wall) => wall.points)
  const minX = points.length ? Math.min(...points.map((point) => point.x)) : 0
  const minY = points.length ? Math.min(...points.map((point) => point.y)) : 0
  const maxX = points.length ? Math.max(...points.map((point) => point.x)) : 0
  const maxY = points.length ? Math.max(...points.map((point) => point.y)) : 0
  const scale = options.pxPerMeter
  const transform = (point: Point2): Point2 => {
    return {
      x: options.origin.x + (point.x - minX) * scale,
      y: options.origin.y + (point.y - minY) * scale,
    }
  }
  const walls: Wall[] = runs.map((wall) => ({
    id: options.newId(),
    floorId: options.floorId,
    points: wall.points.map(transform),
    thickness: wall.thicknessCm ?? 20,
  }))
  const doors: Door[] = []
  const windows: Window[] = []
  const occupied = new Map<number, Array<[number, number]>>()
  let unmatchedOpenings = 0

  function attach(surface: RoomPlanSurface): { wallIndex: number; along: number; width: number; length: number } | null {
    const sx = surface.end.x - surface.start.x
    const sy = surface.end.z - surface.start.z
    const surfaceLength = Math.hypot(sx, sy)
    if (surfaceLength < 0.01) return null
    const alignedStart = rotate(align({ x: surface.start.x, y: surface.start.z }))
    const alignedEnd = rotate(align({ x: surface.end.x, y: surface.end.z }))
    const alignedSx = alignedEnd.x - alignedStart.x, alignedSy = alignedEnd.y - alignedStart.y
    const candidates = wallPairs.flatMap(({ source: wall }, sourceIndex) => {
      const wallIndex = targetBySource.get(sourceIndex)!
      const [correctedA, correctedB] = runs[wallIndex]!.points
      const [a, b] = wall.points
      const dx = b.x - a.x, dy = b.y - a.y
      const length = Math.hypot(dx, dy)
      if (length < 0.02) return []
      const alignment = Math.abs((dx * sx + dy * sy) / (length * surfaceLength))
      if (alignment < Math.cos(Math.PI / 12)) return []
      const along = ((surface.center.x - a.x) * dx + (surface.center.z - a.y) * dy) / length
      const perpendicular = Math.abs((surface.center.x - a.x) * dy - (surface.center.z - a.y) * dx) / length
      if (perpendicular > 0.2 || along + surface.width / 2 < -0.1 || along - surface.width / 2 > length + 0.1) return []
      const targetDx = correctedB!.x - correctedA!.x, targetDy = correctedB!.y - correctedA!.y
      const targetLength = Math.hypot(targetDx, targetDy)
      if (Math.abs((targetDx * alignedSx + targetDy * alignedSy) / (targetLength * surfaceLength)) < Math.cos(Math.PI / 12)) return []
      if (surface.width > targetLength + 0.05) return []
      const center = rotate(align({ x: surface.center.x, y: surface.center.z }))
      const targetAlong = ((center.x - correctedA!.x) * targetDx + (center.y - correctedA!.y) * targetDy) / targetLength
      if (targetAlong - surface.width / 2 < -0.1 || targetAlong + surface.width / 2 > targetLength + 0.1) return []
      const width = Math.min(surface.width, targetLength)
      return [{ wallIndex, length: targetLength, width, along: Math.max(width / 2, Math.min(targetLength - width / 2, targetAlong)),
        distance: perpendicular, parent: wall.sourceId === surface.parentWallId }]
    }).sort((a, b) => Number(b.parent) - Number(a.parent) || a.distance - b.distance)
    const match = candidates[0]
    if (!match) return null
    const interval: [number, number] = [match.along - match.width / 2, match.along + match.width / 2]
    const intervals = occupied.get(match.wallIndex) ?? []
    if (intervals.some(([start, end]) => Math.min(end, interval[1]) - Math.max(start, interval[0]) > 0.01)) return null
    intervals.push(interval)
    occupied.set(match.wallIndex, intervals)
    return match
  }

  for (const [kind, surfaces] of [
    ['door', scan.doors], ['window', scan.windows], ['opening', scan.openings],
  ] as const) {
    for (const surface of surfaces) {
      const match = attach(surface)
      if (!match) { unmatchedOpenings++; continue }
      const opening = {
        id: options.newId(), floorId: options.floorId,
        wallId: walls[match.wallIndex]!.id,
        position: match.along / match.length, segmentIndex: 0,
        centerAlongSegment: match.along * scale, width: match.width * scale,
      }
      if (kind === 'window') windows.push(opening)
      else doors.push({ ...opening, swing: 'none', ...(kind === 'opening' ? { isOpening: true } : {}) })
    }
  }
  const rooms = detectScanRooms(walls, scale,
    (scan.model?.parts ?? []).filter((part) => part.kind === 'object' && part.category).map((part) => ({
      center: transform(rotate(align({ x: part.transform[12]!, y: part.transform[14]! }))), kind: part.category!, confidence: part.confidence,
    })),
    (scan.sections ?? []).map((section) => ({ center: transform(rotate(align({ x: section.center.x, y: section.center.z }))), kind: section.label })))
  const symbolSizePx = resolveSitplanSymbolSizeCm({ sitplanSymbolSizeCm: options.symbolSizeCm }) * scale / 100
  return {
    rooms, symbolSizePx,
    placements: (scan.placements ?? []).map((observation) => {
      let point = rotate(align({ x: observation.position.x, y: observation.position.z }))
      let rotationDeg = 0
      // Wall fixtures follow the same corrected wall runs as openings. Ceiling marks keep
      // their measured X/Z; no nearest-light or electrical-control relationship is inferred.
      if (isRoomScanWallFixture(observation.symbolId)) {
        let nearest: { distance: number; point: Point2; rotationDeg: number } | undefined
        wallPairs.forEach(({ source, points: [a, b] }, sourceIndex) => {
          const start = source.points[0], end = source.points[1]
          const dx = end.x - start.x, dy = end.y - start.y
          const length2 = dx * dx + dy * dy
          if (!length2) return
          const along = Math.max(0, Math.min(1, ((observation.position.x - start.x) * dx + (observation.position.z - start.y) * dy) / length2))
          const distance = Math.hypot(observation.position.x - start.x - along * dx, observation.position.z - start.y - along * dy)
          const targetIndex = targetBySource.get(sourceIndex)
          if (distance > 0.35 || targetIndex === undefined || (nearest && nearest.distance <= distance)) return
          const run = runs[targetIndex]!
          const measured = { x: a.x + along * (b.x - a.x), y: a.y + along * (b.y - a.y) }
          const [ra, rb] = run.points
          const tx = rb.x - ra.x, ty = rb.y - ra.y
          const t = Math.max(0, Math.min(1, ((measured.x - ra.x) * tx + (measured.y - ra.y) * ty) / (tx * tx + ty * ty)))
          const length = Math.hypot(tx, ty)
          let nx = -ty / length, ny = tx / length
          const normal = rotate(align({ x: observation.normal.x, y: observation.normal.z }))
          // Captured surface normals point toward the camera / occupied room. At paired
          // faces the measured point itself identifies which side of the centerline it is.
          const side = (measured.x - ra.x) * nx + (measured.y - ra.y) * ny
          if ((Math.abs(side) > 0.02 ? side : normal.x * nx + normal.y * ny) < 0) { nx = -nx; ny = -ny }
          const halfSymbol = observation.symbolId === 'panel_distribution'
            ? symbolSizePx / scale * (PANEL_SYMBOL_HEIGHT / SYMBOL_SIZE) * PLAN_PANEL_VISUAL_SCALE / 2
            : symbolSizePx / scale / 2
          const offset = (run.thicknessCm ?? 20) / 200 + halfSymbol + 0.005
          const baseStemAngle = observation.symbolId.startsWith('switch') ? Math.atan2(-22.9, 9.3) * 180 / Math.PI
            : observation.symbolId === 'socket_gnd_child' ? 180 : 90
          const rotation = ((Math.atan2(-ny, -nx) * 180 / Math.PI - baseStemAngle) % 360 + 360) % 360
          nearest = { distance, point: { x: ra.x + t * tx + nx * offset, y: ra.y + t * ty + ny * offset }, rotationDeg: rotation }
        })
        if (nearest) { point = nearest.point; rotationDeg = nearest.rotationDeg }
      }
      const pos = transform(point)
      const roomId = rooms.find((room) => scanRoomContains(room.polygon, pos))?.id
      return { ...observation, pos, rotationDeg, roomId, heightCm: Math.round((observation.position.y - (scan.floorElevation ?? 0)) * 100) }
    }),
    floorPlan: { walls, doors, windows, masterWallThickness: options.masterWallThickness ?? 20 },
    pxPerMeter: scale,
    unmatchedOpenings,
    skippedWalls: scan.walls.length - wallPairs.length,
    widthMeters: maxX - minX,
    depthMeters: maxY - minY,
    estimatedThicknessWalls: runs.filter((wall) => wall.thicknessEstimated).length,
    uncenteredWalls: runs.filter((wall) => wall.centered === false).length,
  }
}
