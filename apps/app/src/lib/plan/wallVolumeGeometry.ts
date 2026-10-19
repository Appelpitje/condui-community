import type { Door, Point2, Wall, Window } from '@/types/schema'
import { computeOpeningGeometry } from '@/handlers/plan/wallDrawing'
import { pointInPolygon } from '@/lib/geometry'
import {
  CURVE_WALL_VOLUME_MAX_SEGMENT_LENGTH,
  isCurvedWall,
  wallWithDerivedPath,
} from '@/lib/plan/wallCurve'
import { getOpeningRenderMetrics } from './openingPlanScale'
import {
  loadClipperModule,
  type ClipperModule,
  type ClipperPathsD,
  type ClipperVariant,
} from './clipper2Runtime'

// The vendored Clipper binding exposes integer-valued results even for its D APIs.
// Explicit fixed-point scaling preserves three decimal places deterministically.
const CLIPPER_COORDINATE_SCALE = 1000
const CLIPPER_PRECISION = 0
const WALL_CUTOUT_PAD = 1
const AREA_EPSILON = 1e-3
const JUNCTION_EPSILON = 1
const CURVE_TOPOLOGY_EPSILON = 1e-3
const JUNCTION_MITER_LIMIT = 6
const WIDTH_TAPER_LENGTH_CM = 5
const WIDTH_TAPER_MAX_ANGLE_RADIANS = (10 * Math.PI) / 180
const WALL_PATH_POINT_TOLERANCE = 0.75
const SIMPLE_WALL_COLLINEAR_EPSILON = 1e-8
const SIMPLE_WALL_ENDPOINT_EPSILON = 1e-6

export interface WallVolumeComponent {
  id: string
  wallIds: string[]
  fillPaths: Point2[][]
  /** Solid exterior contours only; cutout/hole boundaries must not receive a wall stroke. */
  outlinePaths: Point2[][]
}

/** Collapse redundant points without turning a real corner into a straight segment. */
export function mergeCollinearWallPoints(points: Point2[]): Point2[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }))

  const merged: Point2[] = []
  for (const point of points) {
    const previous = merged[merged.length - 1]
    if (
      previous &&
      Math.hypot(point.x - previous.x, point.y - previous.y) <= SIMPLE_WALL_COLLINEAR_EPSILON
    ) {
      continue
    }
    merged.push({ ...point })

    while (merged.length >= 3) {
      const a = merged[merged.length - 3]!
      const b = merged[merged.length - 2]!
      const c = merged[merged.length - 1]!
      const abx = b.x - a.x
      const aby = b.y - a.y
      const bcx = c.x - b.x
      const bcy = c.y - b.y
      const cross = abx * bcy - aby * bcx
      const dot = abx * bcx + aby * bcy
      const scale = Math.max(1, Math.hypot(abx, aby) * Math.hypot(bcx, bcy))
      if (Math.abs(cross) > SIMPLE_WALL_COLLINEAR_EPSILON * scale || dot <= 0) break
      merged.splice(merged.length - 2, 1)
    }
  }

  return merged
}

export interface SimpleWallFallbackPath {
  id: string
  wallIds: string[]
  points: Point2[]
  thickness: number
  closed: boolean
}

/** Extend only the two open ends of a fallback centerline by a small cap amount. */
export function extendSimpleWallPathEnds(points: Point2[], extension: number): Point2[] {
  if (points.length < 2 || !Number.isFinite(extension) || extension <= 0) {
    return points.map((point) => ({ ...point }))
  }

  const extended = points.map((point) => ({ ...point }))
  const first = points[0]!
  const second = points[1]!
  const last = points[points.length - 1]!
  const previous = points[points.length - 2]!
  const startLength = Math.hypot(second.x - first.x, second.y - first.y)
  const endLength = Math.hypot(last.x - previous.x, last.y - previous.y)
  if (startLength > SIMPLE_WALL_ENDPOINT_EPSILON) {
    extended[0] = {
      x: first.x - ((second.x - first.x) / startLength) * extension,
      y: first.y - ((second.y - first.y) / startLength) * extension,
    }
  }
  if (endLength > SIMPLE_WALL_ENDPOINT_EPSILON) {
    extended[extended.length - 1] = {
      x: last.x + ((last.x - previous.x) / endLength) * extension,
      y: last.y + ((last.y - previous.y) / endLength) * extension,
    }
  }
  return extended
}

type SimpleWallFallbackCandidate = {
  wallId: string
  points: Point2[]
  thickness: number
  thicknessKey: string
  startNode: string
  endNode: string
}

function simpleWallEndpointKey(point: Point2): string {
  return `${Math.round(point.x / SIMPLE_WALL_ENDPOINT_EPSILON)}:${Math.round(point.y / SIMPLE_WALL_ENDPOINT_EPSILON)}`
}

function orientSimpleWallPoints(candidate: SimpleWallFallbackCandidate, node: string): Point2[] {
  if (candidate.startNode === node) return candidate.points
  if (candidate.endNode === node) return [...candidate.points].reverse()
  return []
}

/**
 * Build simple centerline paths for the no-Clipper fallback.
 *
 * Only endpoint-connected walls with the same thickness are joined. A branch or duplicate
 * segment is deliberately left as separate input so this helper never tries to solve the
 * topology that Clipper handles in the normal path.
 */
export function buildSimpleWallFallbackPaths(
  sourceWalls: Wall[],
  doors: Door[],
  windows: Window[],
  masterWallThickness: number,
  pxPerMeter: number | null | undefined
): SimpleWallFallbackPath[] {
  const wallsWithOpenings = new Set([
    ...doors.map((opening) => opening.wallId),
    ...windows.map((opening) => opening.wallId),
  ])
  const candidates: SimpleWallFallbackCandidate[] = []
  const paths: SimpleWallFallbackPath[] = []

  for (const wall of sourceWalls) {
    if (isCurvedWall(wall) || wallsWithOpenings.has(wall.id)) continue
    const points = mergeCollinearWallPoints(wall.points)
    if (points.length < 2) continue
    const start = points[0]!
    const end = points[points.length - 1]!
    const startNode = simpleWallEndpointKey(start)
    const endNode = simpleWallEndpointKey(end)
    const thickness = resolveWallThicknessPx(wall, masterWallThickness, pxPerMeter)
    if (!Number.isFinite(thickness) || thickness <= 0) continue
    if (startNode === endNode) {
      if (points.length >= 3) {
        paths.push({
          id: wall.id,
          wallIds: [wall.id],
          points: points.slice(0, -1),
          thickness,
          closed: true,
        })
      }
      continue
    }
    candidates.push({
      wallId: wall.id,
      points,
      thickness,
      thicknessKey: thickness.toFixed(6),
      startNode,
      endNode,
    })
  }

  const nodeEdges = new Map<string, string[]>()
  const candidateById = new Map(candidates.map((candidate) => [candidate.wallId, candidate]))
  const duplicateEdgeIds = new Set<string>()
  const edgeOwners = new Map<string, string>()
  for (const candidate of candidates) {
    const nodes = [candidate.startNode, candidate.endNode].sort()
    const edgeKey = `${candidate.thicknessKey}|${nodes.join('|')}`
    const existingOwner = edgeOwners.get(edgeKey)
    if (existingOwner) {
      duplicateEdgeIds.add(existingOwner)
      duplicateEdgeIds.add(candidate.wallId)
    } else {
      edgeOwners.set(edgeKey, candidate.wallId)
    }
    for (const node of [candidate.startNode, candidate.endNode]) {
      const edgeIds = nodeEdges.get(`${candidate.thicknessKey}|${node}`) ?? []
      edgeIds.push(candidate.wallId)
      nodeEdges.set(`${candidate.thicknessKey}|${node}`, edgeIds)
    }
  }

  const visited = new Set<string>()
  for (const candidate of candidates) {
    if (visited.has(candidate.wallId)) continue

    const componentIds: string[] = []
    const componentNodes = new Set<string>()
    const queue = [candidate.wallId]
    while (queue.length > 0) {
      const candidateId = queue.shift()!
      if (visited.has(candidateId)) continue
      visited.add(candidateId)
      const current = candidateById.get(candidateId)
      if (!current) continue
      componentIds.push(candidateId)
      for (const node of [current.startNode, current.endNode]) {
        const nodeKey = `${current.thicknessKey}|${node}`
        componentNodes.add(nodeKey)
        for (const connectedId of nodeEdges.get(nodeKey) ?? []) {
          if (!visited.has(connectedId)) queue.push(connectedId)
        }
      }
    }

    const hasBranch = [...componentNodes].some(
      (nodeKey) => (nodeEdges.get(nodeKey)?.length ?? 0) > 2
    )
    const hasDuplicate = componentIds.some((wallId) => duplicateEdgeIds.has(wallId))
    if (hasBranch || hasDuplicate) {
      for (const wallId of componentIds) {
        const separate = candidateById.get(wallId)!
        paths.push({
          id: separate.wallId,
          wallIds: [separate.wallId],
          points: separate.points,
          thickness: separate.thickness,
          closed: false,
        })
      }
      continue
    }

    const componentCandidates = componentIds.map((wallId) => candidateById.get(wallId)!)
    const startNode =
      [...componentNodes]
        .map((nodeKey) => nodeKey.slice(nodeKey.indexOf('|') + 1))
        .find((node) => (nodeEdges.get(`${candidate.thicknessKey}|${node}`)?.length ?? 0) === 1) ??
      componentCandidates[0]!.startNode
    const first = componentCandidates.find(
      (item) => item.startNode === startNode || item.endNode === startNode
    )!
    const orderedPoints: Point2[] = []
    const orderedWallIds: string[] = []
    let current = first
    let currentNode = startNode
    let closed = false

    while (orderedWallIds.length < componentCandidates.length) {
      const oriented = orientSimpleWallPoints(current, currentNode)
      if (oriented.length === 0) break
      orderedWallIds.push(current.wallId)
      for (const point of oriented) {
        const previous = orderedPoints[orderedPoints.length - 1]
        if (
          !previous ||
          Math.hypot(point.x - previous.x, point.y - previous.y) > SIMPLE_WALL_ENDPOINT_EPSILON
        ) {
          orderedPoints.push(point)
        }
      }

      const nextNode = current.startNode === currentNode ? current.endNode : current.startNode
      if (nextNode === startNode) {
        const firstPoint = orderedPoints[0]
        const lastPoint = orderedPoints[orderedPoints.length - 1]
        if (
          firstPoint &&
          lastPoint &&
          Math.hypot(lastPoint.x - firstPoint.x, lastPoint.y - firstPoint.y) <=
            SIMPLE_WALL_ENDPOINT_EPSILON
        ) {
          orderedPoints.pop()
        }
        closed = true
        break
      }
      const nextId = (nodeEdges.get(`${current.thicknessKey}|${nextNode}`) ?? []).find(
        (wallId) => !orderedWallIds.includes(wallId)
      )
      if (!nextId) break
      current = candidateById.get(nextId)!
      currentNode = nextNode
    }

    paths.push({
      id: orderedWallIds.join('|'),
      wallIds: orderedWallIds,
      points: orderedPoints,
      thickness: candidate.thickness,
      closed,
    })
  }

  return paths
}

export function selectWallVolumeOutlinePaths(
  paths: Array<{ points: Point2[]; area: number }>,
  openingCutouts: Point2[][] = [],
  simplifyPaths = true
): Point2[][] {
  if (paths.length === 0) return []
  const dominantPath = paths.reduce((largest, path) =>
    Math.abs(path.area) > Math.abs(largest.area) ? path : largest
  )
  const dominantSign = Math.sign(dominantPath.area)
  return paths
    .filter((path) => {
      if (Math.sign(path.area) === dominantSign) return true
      if (path.points.length === 0) return false
      const center = path.points.reduce(
        (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
        { x: 0, y: 0 }
      )
      center.x /= path.points.length
      center.y /= path.points.length
      return !openingCutouts.some((cutout) => pointInPolygon(center, cutout))
    })
    .map((path) => (simplifyPaths ? simplifyWallVolumePath(path.points) : path.points))
}

export type OpeningCornerFusionMember = {
  kind: 'door' | 'window'
  id: string
  edge: 'start' | 'end'
  wallId: string
}

export interface OpeningCornerFusion {
  id: string
  point: Point2
  renderPolygon: Point2[]
  cutoutPolygon: Point2[]
  members: OpeningCornerFusionMember[]
}

/** Match the rendered frame nearest a fused corner, independent of wall path direction. */
export function isOpeningFrameCenterFused(
  fusions: OpeningCornerFusion[],
  kind: 'door' | 'window',
  openingId: string,
  frameCenter: Point2,
  oppositeFrameCenter: Point2
): boolean {
  return fusions.some((fusion) => {
    const belongsToOpening = fusion.members.some(
      (member) => member.kind === kind && member.id === openingId
    )
    const fusionRadius = fusion.renderPolygon.reduce(
      (radius, point) =>
        Math.max(radius, Math.hypot(point.x - fusion.point.x, point.y - fusion.point.y)),
      0
    )
    const frameDistance = Math.hypot(frameCenter.x - fusion.point.x, frameCenter.y - fusion.point.y)
    const fusionCoversFrame =
      pointInPolygon(frameCenter, fusion.renderPolygon) || frameDistance <= fusionRadius + 1
    return (
      (belongsToOpening || fusionCoversFrame) &&
      frameDistance <=
        Math.hypot(oppositeFrameCenter.x - fusion.point.x, oppositeFrameCenter.y - fusion.point.y)
    )
  })
}

type WallVertexNode = {
  wallId: string
  point: Point2
  halfThickness: number
  curveEndpoint: boolean
  crossSections: Array<{ normal: Point2; direction: Point2 }>
}

function cross(point: Point2, a: Point2, b: Point2): number {
  return (a.x - point.x) * (b.y - point.y) - (a.y - point.y) * (b.x - point.x)
}

function convexHull(points: Point2[]): Point2[] {
  const unique = Array.from(
    new Map(points.map((point) => [`${point.x.toFixed(6)},${point.y.toFixed(6)}`, point])).values()
  ).sort((a, b) => a.x - b.x || a.y - b.y)
  if (unique.length <= 2) return unique

  const lower: Point2[] = []
  for (const point of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0
    ) {
      lower.pop()
    }
    lower.push(point)
  }
  const upper: Point2[] = []
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index]!
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0
    ) {
      upper.pop()
    }
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

function crossVectors(a: Point2, b: Point2): number {
  return a.x * b.y - a.y * b.x
}

function distanceToInfiniteLine(point: Point2, a: Point2, b: Point2): number {
  const line = { x: b.x - a.x, y: b.y - a.y }
  const length = Math.hypot(line.x, line.y)
  if (length <= 1e-8) return Math.hypot(point.x - a.x, point.y - a.y)
  return Math.abs(crossVectors({ x: point.x - a.x, y: point.y - a.y }, line)) / length
}

/** Remove microscopic union vertices that make a canvas miter stroke render visible teeth. */
export function simplifyWallVolumePath(points: Point2[]): Point2[] {
  let simplified = points.filter((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length]
    return (
      !previous ||
      Math.hypot(point.x - previous.x, point.y - previous.y) > WALL_PATH_POINT_TOLERANCE
    )
  })

  let changed = true
  while (changed && simplified.length > 3) {
    changed = false
    const next = simplified.filter((point, index) => {
      const previous = simplified[(index - 1 + simplified.length) % simplified.length]!
      const following = simplified[(index + 1) % simplified.length]!
      const incoming = { x: point.x - previous.x, y: point.y - previous.y }
      const outgoing = { x: following.x - point.x, y: following.y - point.y }
      const continuesForward = incoming.x * outgoing.x + incoming.y * outgoing.y >= 0
      if (
        continuesForward &&
        distanceToInfiniteLine(point, previous, following) <= WALL_PATH_POINT_TOLERANCE
      ) {
        changed = true
        return false
      }
      return true
    })
    simplified = next
  }

  return simplified
}

function wallDirectionFromVertex(vertex: Point2, neighbor: Point2) {
  const dx = neighbor.x - vertex.x
  const dy = neighbor.y - vertex.y
  const length = Math.hypot(dx, dy)
  if (length <= 1e-8) return null
  const direction = { x: dx / length, y: dy / length }
  return {
    direction,
    normal: { x: -direction.y, y: direction.x },
  }
}

function intersectInfiniteLines(
  pointA: Point2,
  directionA: Point2,
  pointB: Point2,
  directionB: Point2
): Point2 | null {
  const denominator = crossVectors(directionA, directionB)
  if (Math.abs(denominator) <= 1e-8) return null
  const between = { x: pointB.x - pointA.x, y: pointB.y - pointA.y }
  const t = crossVectors(between, directionB) / denominator
  return {
    x: pointA.x + directionA.x * t,
    y: pointA.y + directionA.y * t,
  }
}

function intersectInfiniteLinesWithParameters(
  pointA: Point2,
  directionA: Point2,
  pointB: Point2,
  directionB: Point2
): { point: Point2; tA: number; tB: number } | null {
  const denominator = crossVectors(directionA, directionB)
  if (Math.abs(denominator) <= 1e-8) return null
  const between = { x: pointB.x - pointA.x, y: pointB.y - pointA.y }
  const tA = crossVectors(between, directionB) / denominator
  const tB = crossVectors(between, directionA) / denominator
  return {
    point: {
      x: pointA.x + directionA.x * tA,
      y: pointA.y + directionA.y * tA,
    },
    tA,
    tB,
  }
}

function collectWallVertexNodes(
  walls: Wall[],
  masterWallThickness: number,
  pxPerMeter: number | null | undefined
): WallVertexNode[] {
  const nodes: WallVertexNode[] = []
  for (const wall of walls) {
    const halfThickness = resolveWallThicknessPx(wall, masterWallThickness, pxPerMeter) / 2
    const lastIndex = wall.points.length - 1
    const curveEndpoint = wall.curve?.kind === 'rationalQuadratic'
    for (let index = 0; index < wall.points.length; index += 1) {
      // Flattened curve samples describe shape, not editable/topological wall vertices.
      // Only the two curve ends may participate in wall junctions.
      if (wall.curve?.kind === 'rationalQuadratic' && index !== 0 && index !== lastIndex) continue
      const point = wall.points[index]
      if (!point) continue
      if (
        index === lastIndex &&
        index > 0 &&
        makeVertexKey(point) === makeVertexKey(wall.points[0]!)
      ) {
        continue
      }
      const crossSections: Array<{ normal: Point2; direction: Point2 }> = []
      const previous = wall.points[index - 1]
      const next = wall.points[index + 1]
      const previousSection = previous ? wallDirectionFromVertex(point, previous) : null
      const nextSection = next ? wallDirectionFromVertex(point, next) : null
      if (previousSection) crossSections.push(previousSection)
      if (nextSection) crossSections.push(nextSection)
      if (crossSections.length > 0) {
        nodes.push({ wallId: wall.id, point, halfThickness, curveEndpoint, crossSections })
      }
    }
  }
  return nodes
}

function clusterNearbyNodes<T extends { wallId: string; point: Point2; halfThickness: number }>(
  nodes: T[],
  canJoin: (a: T, b: T) => boolean = (a, b) => a.wallId !== b.wallId,
  isValidCluster: (cluster: T[]) => boolean = (cluster) =>
    new Set(cluster.map((node) => node.wallId)).size >= 2
): T[][] {
  const parents = nodes.map((_, index) => index)
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]!]!
      index = parents[index]!
    }
    return index
  }
  const union = (a: number, b: number) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parents[rootB] = rootA
  }

  for (let a = 0; a < nodes.length; a += 1) {
    for (let b = a + 1; b < nodes.length; b += 1) {
      const nodeA = nodes[a]!
      const nodeB = nodes[b]!
      if (!canJoin(nodeA, nodeB)) continue
      const threshold =
        ('curveEndpoint' in nodeA && nodeA.curveEndpoint) ||
        ('curveEndpoint' in nodeB && nodeB.curveEndpoint)
          ? CURVE_TOPOLOGY_EPSILON
          : nodeA.halfThickness + nodeB.halfThickness + JUNCTION_EPSILON
      if (Math.hypot(nodeA.point.x - nodeB.point.x, nodeA.point.y - nodeB.point.y) <= threshold) {
        union(a, b)
      }
    }
  }

  const clusters = new Map<number, T[]>()
  nodes.forEach((node, index) => {
    const root = find(index)
    clusters.set(root, [...(clusters.get(root) ?? []), node])
  })
  return Array.from(clusters.values()).filter(isValidCluster)
}

/**
 * Prefer authored connectivity over a loose endpoint that merely overlaps the same area.
 * The wall bodies will still union, but the loose endpoint must not turn a real corner/chain
 * into an artificial three-way projected junction.
 */
function findExactConnectedJunctionNodes(cluster: WallVertexNode[]): WallVertexNode[] | null {
  if (cluster.length < 2) return null

  const continuousNodes = cluster.filter((node) => node.crossSections.length >= 2)
  if (continuousNodes.length > 0 && continuousNodes.length < cluster.length) {
    return continuousNodes
  }

  const exactGroups: WallVertexNode[][] = []
  for (const node of cluster) {
    const group = exactGroups.find((candidate) =>
      candidate.some((member) => {
        return (
          Math.hypot(member.point.x - node.point.x, member.point.y - node.point.y) <=
          CURVE_TOPOLOGY_EPSILON
        )
      })
    )
    if (group) group.push(node)
    else exactGroups.push([node])
  }

  const preferred = exactGroups.reduce((best, candidate) => {
    const incidentCount = candidate.reduce((sum, node) => sum + node.crossSections.length, 0)
    const bestIncidentCount = best.reduce((sum, node) => sum + node.crossSections.length, 0)
    return incidentCount > bestIncidentCount ? candidate : best
  })
  const preferredIncidentCount = preferred.reduce((sum, node) => sum + node.crossSections.length, 0)

  return preferredIncidentCount >= 2 && preferred.length < cluster.length ? preferred : null
}

function preferExactConnectedJunctionNodes(cluster: WallVertexNode[]): WallVertexNode[] {
  return findExactConnectedJunctionNodes(cluster) ?? cluster
}

/**
 * Render a loose straight endpoint from the exact connected node it overlaps. This leaves the
 * authored wall untouched while preventing its butt cap from poking through the authoritative
 * corner as a triangular tooth.
 */
export function snapLooseWallEndpointsToConnectedJunctions(
  walls: Wall[],
  masterWallThickness: number,
  pxPerMeter: number | null | undefined
): Wall[] {
  const replacements = new Map<string, Map<number, Point2>>()
  const clusters = clusterNearbyNodes(
    collectWallVertexNodes(walls, masterWallThickness, pxPerMeter)
  )

  for (const cluster of clusters) {
    const authoritative = findExactConnectedJunctionNodes(cluster)
    if (!authoritative) continue
    const anchor = authoritative[0]!.point

    for (const node of cluster) {
      if (
        authoritative.includes(node) ||
        node.curveEndpoint ||
        node.crossSections.length !== 1 ||
        authoritative.some((member) => member.wallId === node.wallId)
      ) {
        continue
      }
      const wall = walls.find((candidate) => candidate.id === node.wallId)
      if (!wall) continue
      const endpointIndex =
        wall.points[0] === node.point
          ? 0
          : wall.points[wall.points.length - 1] === node.point
            ? wall.points.length - 1
            : -1
      if (endpointIndex < 0) continue
      const byIndex = replacements.get(wall.id) ?? new Map<number, Point2>()
      byIndex.set(endpointIndex, anchor)
      replacements.set(wall.id, byIndex)
    }
  }

  if (replacements.size === 0) return walls
  return walls.map((wall) => {
    const byIndex = replacements.get(wall.id)
    if (!byIndex) return wall
    return {
      ...wall,
      points: wall.points.map((point, index) => byIndex.get(index) ?? point),
    }
  })
}

/** Polygons that bridge visually adjoining wall vertices, including unequal wall widths. */
export function buildWallJunctionPolygons(
  walls: Wall[],
  masterWallThickness: number,
  pxPerMeter: number | null | undefined
): Point2[][] {
  return clusterNearbyNodes(collectWallVertexNodes(walls, masterWallThickness, pxPerMeter)).flatMap(
    (nearbyCluster) => {
      const cluster = preferExactConnectedJunctionNodes(nearbyCluster)
      if (new Set(cluster.map((node) => node.wallId)).size < 2) return []
      if (
        cluster.length === 2 &&
        cluster.every((node) => node.crossSections.length === 1) &&
        Math.abs(cluster[0]!.halfThickness - cluster[1]!.halfThickness) <= 1e-6 &&
        Math.hypot(
          cluster[0]!.point.x - cluster[1]!.point.x,
          cluster[0]!.point.y - cluster[1]!.point.y
        ) <= 1e-6
      ) {
        // The expansion source tracer already joins an exact, equal-width two-wall chain.
        // Adding a second projected junction polygon can create a tiny detached sliver when
        // one side is a tessellated curve whose final chord only approximates its tangent.
        return []
      }
      const polygons: Point2[][] = []
      const incidentDirections = new Set(
        cluster.flatMap((node) =>
          node.crossSections.map(
            (section) =>
              `${Math.round(section.direction.x * 1_000_000)},${Math.round(section.direction.y * 1_000_000)}`
          )
        )
      )

      // Pairwise miters define the outside faces, but three-or-more-way junctions
      // can still leave a triangular hole between the incident wall bodies. Fill
      // only the immediate cap area; the bounded convex hull cannot create the
      // long spikes that a multi-way projected miter would.
      if (incidentDirections.size >= 3) {
        const hub = convexHull(
          cluster.flatMap((node) =>
            node.crossSections.flatMap((section) => [
              {
                x: node.point.x + section.normal.x * node.halfThickness,
                y: node.point.y + section.normal.y * node.halfThickness,
              },
              {
                x: node.point.x - section.normal.x * node.halfThickness,
                y: node.point.y - section.normal.y * node.halfThickness,
              },
            ])
          )
        )
        if (hub.length >= 3) polygons.push(hub)
      }

      for (let aIndex = 0; aIndex < cluster.length; aIndex += 1) {
        for (let bIndex = aIndex + 1; bIndex < cluster.length; bIndex += 1) {
          const nodeA = cluster[aIndex]!
          const nodeB = cluster[bIndex]!
          if (nodeA.wallId === nodeB.wallId) continue
          for (const sectionA of nodeA.crossSections) {
            for (const sectionB of nodeB.crossSections) {
              const turn = crossVectors(sectionA.direction, sectionB.direction)
              if (Math.abs(turn) <= 1e-6) continue
              const signA = turn < 0 ? 1 : -1
              const signB = -signA
              const sideA = {
                x: nodeA.point.x + sectionA.normal.x * nodeA.halfThickness * signA,
                y: nodeA.point.y + sectionA.normal.y * nodeA.halfThickness * signA,
              }
              const sideB = {
                x: nodeB.point.x + sectionB.normal.x * nodeB.halfThickness * signB,
                y: nodeB.point.y + sectionB.normal.y * nodeB.halfThickness * signB,
              }
              const intersection = intersectInfiniteLines(
                sideA,
                sectionA.direction,
                sideB,
                sectionB.direction
              )
              if (!intersection) continue

              const center = {
                x: (nodeA.point.x + nodeB.point.x) / 2,
                y: (nodeA.point.y + nodeB.point.y) / 2,
              }
              const maxHalfThickness = Math.max(nodeA.halfThickness, nodeB.halfThickness)
              const miterIsReasonable =
                Math.hypot(intersection.x - center.x, intersection.y - center.y) <=
                maxHalfThickness * JUNCTION_MITER_LIMIT
              const overlapA = {
                x: nodeA.point.x + sectionA.direction.x * JUNCTION_EPSILON,
                y: nodeA.point.y + sectionA.direction.y * JUNCTION_EPSILON,
              }
              const overlapB = {
                x: nodeB.point.x + sectionB.direction.x * JUNCTION_EPSILON,
                y: nodeB.point.y + sectionB.direction.y * JUNCTION_EPSILON,
              }
              const sideOverlapA = {
                x: sideA.x + sectionA.direction.x * JUNCTION_EPSILON,
                y: sideA.y + sectionA.direction.y * JUNCTION_EPSILON,
              }
              const sideOverlapB = {
                x: sideB.x + sectionB.direction.x * JUNCTION_EPSILON,
                y: sideB.y + sectionB.direction.y * JUNCTION_EPSILON,
              }
              polygons.push(
                miterIsReasonable
                  ? [overlapA, sideOverlapA, intersection, sideOverlapB, overlapB]
                  : [overlapA, sideOverlapA, sideOverlapB, overlapB]
              )
            }
          }
        }
      }
      return polygons
    }
  )
}

/** Cap slivers to subtract when a wider wall crosses an adjoining wall's projected face. */
export function buildWallJunctionTrimPolygons(
  walls: Wall[],
  masterWallThickness: number,
  pxPerMeter: number | null | undefined
): Point2[][] {
  return clusterNearbyNodes(collectWallVertexNodes(walls, masterWallThickness, pxPerMeter)).flatMap(
    (nearbyCluster) => {
      const cluster = preferExactConnectedJunctionNodes(nearbyCluster)
      if (new Set(cluster.map((node) => node.wallId)).size < 2) return []
      const polygons: Point2[][] = []
      for (let aIndex = 0; aIndex < cluster.length; aIndex += 1) {
        for (let bIndex = aIndex + 1; bIndex < cluster.length; bIndex += 1) {
          const nodeA = cluster[aIndex]!
          const nodeB = cluster[bIndex]!
          if (
            nodeA.wallId === nodeB.wallId ||
            Math.hypot(nodeA.point.x - nodeB.point.x, nodeA.point.y - nodeB.point.y) >
              JUNCTION_EPSILON
          ) {
            continue
          }
          for (const sectionA of nodeA.crossSections) {
            for (const sectionB of nodeB.crossSections) {
              const turn = crossVectors(sectionA.direction, sectionB.direction)
              if (Math.abs(turn) <= 1e-6) continue
              const signA = turn < 0 ? 1 : -1
              const signB = -signA

              const trimCapAgainstOuterFace = (
                faceNode: WallVertexNode,
                faceSection: { normal: Point2; direction: Point2 },
                faceSign: number,
                capNode: WallVertexNode,
                capSection: { normal: Point2; direction: Point2 },
                capSign: number
              ) => {
                const outerFace = {
                  x: faceNode.point.x + faceSection.normal.x * faceNode.halfThickness * faceSign,
                  y: faceNode.point.y + faceSection.normal.y * faceNode.halfThickness * faceSign,
                }
                const capOuter = {
                  x: capNode.point.x + capSection.normal.x * capNode.halfThickness * capSign,
                  y: capNode.point.y + capSection.normal.y * capNode.halfThickness * capSign,
                }
                const capInner = {
                  x: capNode.point.x - capSection.normal.x * capNode.halfThickness * capSign,
                  y: capNode.point.y - capSection.normal.y * capNode.halfThickness * capSign,
                }
                const capVector = {
                  x: capInner.x - capOuter.x,
                  y: capInner.y - capOuter.y,
                }
                const capIntersection = intersectInfiniteLinesWithParameters(
                  outerFace,
                  faceSection.direction,
                  capOuter,
                  capVector
                )
                const innerFaceIntersection = intersectInfiniteLinesWithParameters(
                  outerFace,
                  faceSection.direction,
                  capInner,
                  capSection.direction
                )
                if (
                  !capIntersection ||
                  !innerFaceIntersection ||
                  capIntersection.tB <= 1e-6 ||
                  capIntersection.tB >= 1 - 1e-6 ||
                  innerFaceIntersection.tB <= 1e-6
                ) {
                  return
                }
                const maxDistance =
                  Math.max(faceNode.halfThickness, capNode.halfThickness) * JUNCTION_MITER_LIMIT
                if (
                  Math.hypot(
                    innerFaceIntersection.point.x - capNode.point.x,
                    innerFaceIntersection.point.y - capNode.point.y
                  ) > maxDistance
                ) {
                  return
                }
                const faceOrder = Math.sign(innerFaceIntersection.tA - capIntersection.tA) || 1
                const faceStart = {
                  x:
                    capIntersection.point.x -
                    faceSection.direction.x * JUNCTION_EPSILON * faceOrder,
                  y:
                    capIntersection.point.y -
                    faceSection.direction.y * JUNCTION_EPSILON * faceOrder,
                }
                const faceEnd = {
                  x:
                    innerFaceIntersection.point.x +
                    faceSection.direction.x * JUNCTION_EPSILON * faceOrder,
                  y:
                    innerFaceIntersection.point.y +
                    faceSection.direction.y * JUNCTION_EPSILON * faceOrder,
                }
                const faceMidpoint = {
                  x: (capIntersection.point.x + innerFaceIntersection.point.x) / 2,
                  y: (capIntersection.point.y + innerFaceIntersection.point.y) / 2,
                }
                const outward = wallDirectionFromVertex(faceMidpoint, capInner)?.direction
                const capTip = outward
                  ? {
                      x: capInner.x + outward.x * JUNCTION_EPSILON,
                      y: capInner.y + outward.y * JUNCTION_EPSILON,
                    }
                  : capInner
                polygons.push([capTip, faceStart, faceEnd])
              }

              trimCapAgainstOuterFace(nodeA, sectionA, signA, nodeB, sectionB, signB)
              trimCapAgainstOuterFace(nodeB, sectionB, signB, nodeA, sectionA, signA)
              trimCapAgainstOuterFace(nodeA, sectionA, -signA, nodeB, sectionB, -signB)
              trimCapAgainstOuterFace(nodeB, sectionB, -signB, nodeA, sectionA, -signA)
            }
          }
        }
      }
      return polygons
    }
  )
}

/** Stroke one non-branching wall chain by intersecting both parallel faces at every joint. */
export function buildVariableWidthWallChainPath(
  walls: Wall[],
  masterWallThickness: number,
  pxPerMeter: number | null | undefined
): Point2[] | null {
  type ChainEdge = {
    a: Point2
    b: Point2
    aKey: string
    bKey: string
    halfThickness: number
  }
  const edges: ChainEdge[] = []
  for (const wall of walls) {
    if (isClosedWall(wall.points)) return null
    const halfThickness = resolveWallThicknessPx(wall, masterWallThickness, pxPerMeter) / 2
    for (let index = 0; index < wall.points.length - 1; index += 1) {
      const a = wall.points[index]
      const b = wall.points[index + 1]
      if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) <= 1e-8) continue
      edges.push({ a, b, aKey: makeVertexKey(a), bKey: makeVertexKey(b), halfThickness })
    }
  }
  if (edges.length < 2 || new Set(edges.map((edge) => edge.halfThickness)).size < 2) return null

  const edgeIndexesByVertex = new Map<string, number[]>()
  edges.forEach((edge, index) => {
    edgeIndexesByVertex.set(edge.aKey, [...(edgeIndexesByVertex.get(edge.aKey) ?? []), index])
    edgeIndexesByVertex.set(edge.bKey, [...(edgeIndexesByVertex.get(edge.bKey) ?? []), index])
  })
  if (Array.from(edgeIndexesByVertex.values()).some((indexes) => indexes.length > 2)) return null
  const endpoints = Array.from(edgeIndexesByVertex.entries()).filter(
    ([, indexes]) => indexes.length === 1
  )
  if (endpoints.length !== 2) return null

  const oriented: Array<{
    start: Point2
    end: Point2
    direction: Point2
    normal: Point2
    halfThickness: number
  }> = []
  const visited = new Set<number>()
  let currentKey = endpoints[0]![0]
  while (visited.size < edges.length) {
    const edgeIndex = (edgeIndexesByVertex.get(currentKey) ?? []).find(
      (index) => !visited.has(index)
    )
    if (edgeIndex == null) return null
    visited.add(edgeIndex)
    const edge = edges[edgeIndex]!
    const forward = edge.aKey === currentKey
    const start = forward ? edge.a : edge.b
    const end = forward ? edge.b : edge.a
    const section = wallDirectionFromVertex(start, end)
    if (!section) return null
    oriented.push({ start, end, ...section, halfThickness: edge.halfThickness })
    currentKey = forward ? edge.bKey : edge.aKey
  }

  const offset = (point: Point2, segment: (typeof oriented)[number], sign: 1 | -1): Point2 => ({
    x: point.x + segment.normal.x * segment.halfThickness * sign,
    y: point.y + segment.normal.y * segment.halfThickness * sign,
  })
  const shift = (point: Point2, direction: Point2, distance: number): Point2 => ({
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
  })
  const left: Point2[] = [offset(oriented[0]!.start, oriented[0]!, 1)]
  const right: Point2[] = [offset(oriented[0]!.start, oriented[0]!, -1)]
  for (let index = 0; index < oriented.length - 1; index += 1) {
    const current = oriented[index]!
    const next = oriented[index + 1]!
    const joint = {
      x: (current.end.x + next.start.x) / 2,
      y: (current.end.y + next.start.y) / 2,
    }
    const turn = crossVectors(current.direction, next.direction)
    const directionDot =
      current.direction.x * next.direction.x + current.direction.y * next.direction.y
    const turnAngle = Math.atan2(Math.abs(turn), directionDot)
    const thicknessChanges = Math.abs(current.halfThickness - next.halfThickness) > 1e-6

    if (thicknessChanges && turnAngle <= WIDTH_TAPER_MAX_ANGLE_RADIANS) {
      const taperLength = pxPerMeter != null ? (WIDTH_TAPER_LENGTH_CM / 100) * pxPerMeter : 5
      const currentLength = Math.hypot(
        current.end.x - current.start.x,
        current.end.y - current.start.y
      )
      const nextLength = Math.hypot(next.end.x - next.start.x, next.end.y - next.start.y)
      const currentTaper = Math.min(taperLength / 2, currentLength / 4)
      const nextTaper = Math.min(taperLength / 2, nextLength / 4)
      const taperStart = shift(joint, current.direction, -currentTaper)
      const taperEnd = shift(joint, next.direction, nextTaper)
      left.push(offset(taperStart, current, 1), offset(taperEnd, next, 1))
      right.push(offset(taperStart, current, -1), offset(taperEnd, next, -1))
      continue
    }

    const leftIntersection = intersectInfiniteLines(
      offset(joint, current, 1),
      current.direction,
      offset(joint, next, 1),
      next.direction
    )
    const rightIntersection = intersectInfiniteLines(
      offset(joint, current, -1),
      current.direction,
      offset(joint, next, -1),
      next.direction
    )
    if (!leftIntersection || !rightIntersection) return null

    const maxHalfThickness = Math.max(current.halfThickness, next.halfThickness)
    const miterLimit = maxHalfThickness * JUNCTION_MITER_LIMIT
    const outerSign: 1 | -1 = turn > 0 ? -1 : 1
    const outerIntersection = outerSign === 1 ? leftIntersection : rightIntersection
    const outerMiterIsBounded =
      Math.hypot(outerIntersection.x - joint.x, outerIntersection.y - joint.y) <= miterLimit

    if (outerSign === 1 && !outerMiterIsBounded) {
      left.push(offset(joint, current, 1), offset(joint, next, 1))
    } else {
      left.push(leftIntersection)
    }
    if (outerSign === -1 && !outerMiterIsBounded) {
      right.push(offset(joint, current, -1), offset(joint, next, -1))
    } else {
      right.push(rightIntersection)
    }
  }
  const last = oriented[oriented.length - 1]!
  left.push(offset(last.end, last, 1))
  right.push(offset(last.end, last, -1))
  const path = [...left, ...right.reverse()]

  const area = Math.abs(
    path.reduce((sum, point, index) => {
      const next = path[(index + 1) % path.length]!
      return sum + point.x * next.y - point.y * next.x
    }, 0) / 2
  )
  const expectedBodyArea = oriented.reduce(
    (sum, segment) =>
      sum +
      Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y) *
        segment.halfThickness *
        2,
    0
  )
  const maxHalf = Math.max(...oriented.map((segment) => segment.halfThickness))
  const joinAllowance = maxHalf * maxHalf * Math.max(1, oriented.length - 1) * 8
  if (area < expectedBodyArea * 0.5 || area > expectedBodyArea + joinAllowance) return null
  return path
}

type OpeningEdgeNode = WallVertexNode & OpeningCornerFusionMember & { segmentIndex: number }

function openingFrameBlockCorners(
  node: OpeningEdgeNode,
  halfHeight: number,
  frameLength: number
): Point2[] {
  const section = node.crossSections[0]
  if (!section) return []
  const far = {
    x: node.point.x + section.direction.x * frameLength,
    y: node.point.y + section.direction.y * frameLength,
  }
  return [
    {
      x: node.point.x + section.normal.x * halfHeight,
      y: node.point.y + section.normal.y * halfHeight,
    },
    {
      x: far.x + section.normal.x * halfHeight,
      y: far.y + section.normal.y * halfHeight,
    },
    {
      x: far.x - section.normal.x * halfHeight,
      y: far.y - section.normal.y * halfHeight,
    },
    {
      x: node.point.x - section.normal.x * halfHeight,
      y: node.point.y - section.normal.y * halfHeight,
    },
  ]
}

/** Join the complete end blocks, extending both faces through the corner as a miter. */
function buildOpeningFramePolygon(
  cluster: OpeningEdgeNode[],
  halfHeightForNode: (node: OpeningEdgeNode) => number,
  frameLength: number
): Point2[] {
  if (cluster.length === 2) {
    const [nodeA, nodeB] = cluster as [OpeningEdgeNode, OpeningEdgeNode]
    const sectionA = nodeA.crossSections[0]
    const sectionB = nodeB.crossSections[0]
    if (sectionA && sectionB) {
      const turn = crossVectors(sectionA.direction, sectionB.direction)
      if (Math.abs(turn) > 1e-6) {
        const halfA = halfHeightForNode(nodeA)
        const halfB = halfHeightForNode(nodeB)
        const signA = turn < 0 ? 1 : -1
        const signB = -signA
        const side = (point: Point2, normal: Point2, halfHeight: number, sign: number): Point2 => ({
          x: point.x + normal.x * halfHeight * sign,
          y: point.y + normal.y * halfHeight * sign,
        })
        const outerMiter = intersectInfiniteLines(
          side(nodeA.point, sectionA.normal, halfA, signA),
          sectionA.direction,
          side(nodeB.point, sectionB.normal, halfB, signB),
          sectionB.direction
        )
        const innerMiter = intersectInfiniteLines(
          side(nodeA.point, sectionA.normal, halfA, -signA),
          sectionA.direction,
          side(nodeB.point, sectionB.normal, halfB, -signB),
          sectionB.direction
        )
        const center = {
          x: (nodeA.point.x + nodeB.point.x) / 2,
          y: (nodeA.point.y + nodeB.point.y) / 2,
        }
        const maxHalfHeight = Math.max(halfA, halfB)
        const miterIsBounded =
          outerMiter != null &&
          innerMiter != null &&
          Math.max(
            Math.hypot(outerMiter.x - center.x, outerMiter.y - center.y),
            Math.hypot(innerMiter.x - center.x, innerMiter.y - center.y)
          ) <=
            maxHalfHeight * JUNCTION_MITER_LIMIT

        if (outerMiter && innerMiter && miterIsBounded) {
          const farA = {
            x: nodeA.point.x + sectionA.direction.x * frameLength,
            y: nodeA.point.y + sectionA.direction.y * frameLength,
          }
          const farB = {
            x: nodeB.point.x + sectionB.direction.x * frameLength,
            y: nodeB.point.y + sectionB.direction.y * frameLength,
          }
          return [
            side(farA, sectionA.normal, halfA, signA),
            outerMiter,
            side(farB, sectionB.normal, halfB, signB),
            side(farB, sectionB.normal, halfB, -signB),
            innerMiter,
            side(farA, sectionA.normal, halfA, -signA),
          ]
        }
      }
    }
  }

  return convexHull(
    cluster.flatMap((node) => openingFrameBlockCorners(node, halfHeightForNode(node), frameLength))
  )
}

/** Describe adjacent opening ends that should render as one polygonal corner frame. */
export function buildOpeningCornerFusions(
  walls: Wall[],
  doors: Door[],
  windows: Window[],
  masterWallThickness: number,
  pxPerMeter: number | null | undefined
): OpeningCornerFusion[] {
  const wallsById = new Map(walls.map((wall) => [wall.id, wall]))
  const nodes: OpeningEdgeNode[] = []
  const appendOpening = (opening: Door | Window, kind: 'door' | 'window') => {
    const wall = wallsById.get(opening.wallId)
    if (!wall || wall.points.length < 2) return
    const geometry = computeOpeningGeometry(wall.points, opening.position)
    if (!geometry) return
    const halfThickness = resolveWallThicknessPx(wall, masterWallThickness, pxPerMeter) / 2
    const addEdge = (edge: 'start' | 'end') => {
      const segmentStart = wall.points[geometry.segmentIndex]!
      const segmentEnd = wall.points[geometry.segmentIndex + 1]!
      const point = edge === 'start' ? segmentStart : segmentEnd
      const section =
        edge === 'start'
          ? wallDirectionFromVertex(segmentStart, segmentEnd)
          : wallDirectionFromVertex(segmentEnd, segmentStart)
      if (!section) return
      nodes.push({
        wallId: wall.id,
        point,
        halfThickness,
        curveEndpoint: false,
        crossSections: [section],
        kind,
        id: opening.id,
        edge,
        segmentIndex: geometry.segmentIndex,
      })
    }
    if (geometry.centerDist - opening.width / 2 <= geometry.segmentStartDist + JUNCTION_EPSILON) {
      addEdge('start')
    }
    if (geometry.centerDist + opening.width / 2 >= geometry.segmentEndDist - JUNCTION_EPSILON) {
      addEdge('end')
    }
  }
  doors.forEach((door) => appendOpening(door, 'door'))
  windows.forEach((window) => appendOpening(window, 'window'))

  return clusterNearbyNodes(
    nodes,
    (a, b) => a.id !== b.id && (a.wallId !== b.wallId || a.segmentIndex !== b.segmentIndex),
    (cluster) => new Set(cluster.map((node) => node.id)).size >= 2
  ).flatMap((cluster, index) => {
    if (!cluster.some((node) => node.kind === 'window')) return []
    const frameLength = getOpeningRenderMetrics(pxPerMeter).frameLength
    const point = {
      x: cluster.reduce((sum, node) => sum + node.point.x, 0) / cluster.length,
      y: cluster.reduce((sum, node) => sum + node.point.y, 0) / cluster.length,
    }
    const renderPolygon = buildOpeningFramePolygon(
      cluster,
      (node) => node.halfThickness * 0.9,
      frameLength
    )
    const cutoutHalfHeight = (node: OpeningEdgeNode) => node.halfThickness + WALL_CUTOUT_PAD
    const cutoutFrameLength = frameLength + WALL_CUTOUT_PAD
    const cutoutPolygon = convexHull([
      ...cluster.flatMap((node) =>
        openingFrameBlockCorners(node, cutoutHalfHeight(node), cutoutFrameLength)
      ),
      ...buildOpeningFramePolygon(cluster, cutoutHalfHeight, cutoutFrameLength),
    ])
    if (renderPolygon.length < 3 || cutoutPolygon.length < 3) return []
    return [
      {
        id: `opening-corner-${index}-${cluster.map((node) => `${node.kind}-${node.id}-${node.edge}`).join('|')}`,
        point,
        renderPolygon,
        cutoutPolygon,
        members: cluster.map(({ kind, id, edge, wallId }) => ({ kind, id, edge, wallId })),
      },
    ]
  })
}

const isClosedWall = (points: Point2[]): boolean => {
  if (points.length < 3) return false
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return false
  const dx = first.x - last.x
  const dy = first.y - last.y
  return dx * dx + dy * dy < 1e-4
}

export function resolveWallThicknessPx(
  wall: Wall,
  masterWallThickness: number,
  pxPerMeter: number | null | undefined
): number {
  const thicknessCm = wall.thickness ?? masterWallThickness
  if (pxPerMeter != null) {
    return (thicknessCm / 100) * pxPerMeter
  }
  return thicknessCm
}

function createPathsD(module: ClipperModule, paths: Point2[][]): ClipperPathsD {
  const clipperPaths = new module.PathsD()
  for (const path of paths) {
    if (path.length < 2) continue
    const flat: number[] = []
    for (const point of path) {
      flat.push(
        Math.round(point.x * CLIPPER_COORDINATE_SCALE),
        Math.round(point.y * CLIPPER_COORDINATE_SCALE)
      )
    }
    const clipperPath = module.MakePathD(flat)
    clipperPaths.push_back(clipperPath)
    clipperPath.delete?.()
  }
  return clipperPaths
}

function getExpansionSourcePoints(points: Point2[]): Point2[] {
  if (!isClosedWall(points)) return points
  return points.slice(0, -1)
}

function makeVertexKey(point: Point2): string {
  return `${point.x.toFixed(6)},${point.y.toFixed(6)}`
}

type VisualWallEdge = {
  wallId: string
  a: Point2
  b: Point2
  aKey: string
  bKey: string
}

function edgeKey(edge: VisualWallEdge): string {
  return edge.aKey < edge.bKey ? `${edge.aKey}|${edge.bKey}` : `${edge.bKey}|${edge.aKey}`
}

function appendEdgePoint(path: Point2[], edge: VisualWallEdge, fromKey: string): string {
  if (fromKey === edge.aKey) {
    path.push(edge.b)
    return edge.bKey
  }
  path.push(edge.a)
  return edge.aKey
}

function traceVisualWallChain(
  startEdge: VisualWallEdge,
  startKey: string,
  edgesByNode: Map<string, VisualWallEdge[]>,
  visitedEdges: Set<string>
): Point2[] {
  const path: Point2[] = [startKey === startEdge.aKey ? startEdge.a : startEdge.b]
  let currentEdge = startEdge
  let currentKey = startKey

  for (let guard = 0; guard < visitedEdges.size + edgesByNode.size + 1000; guard += 1) {
    const currentEdgeKey = edgeKey(currentEdge)
    if (visitedEdges.has(currentEdgeKey)) break
    visitedEdges.add(currentEdgeKey)
    currentKey = appendEdgePoint(path, currentEdge, currentKey)

    const nodeEdges = edgesByNode.get(currentKey) ?? []
    const candidates = nodeEdges.filter((edge) => !visitedEdges.has(edgeKey(edge)))
    const sameWallCandidates = candidates.filter((edge) => edge.wallId === currentEdge.wallId)
    const nextEdge =
      nodeEdges.length === 2 && candidates.length === 1
        ? candidates[0]
        : sameWallCandidates.length === 1
          ? sameWallCandidates[0]
          : undefined
    if (!nextEdge) break
    currentEdge = nextEdge
  }

  return path
}

export function buildVisualWallExpansionSources(walls: Wall[]): Point2[][] {
  const edgesByNode = new Map<string, VisualWallEdge[]>()
  const allEdges: VisualWallEdge[] = []

  const addEdge = (wallId: string, a: Point2, b: Point2) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (dx * dx + dy * dy < 1e-8) return
    const edge: VisualWallEdge = {
      wallId,
      a,
      b,
      aKey: makeVertexKey(a),
      bKey: makeVertexKey(b),
    }
    allEdges.push(edge)
    edgesByNode.set(edge.aKey, [...(edgesByNode.get(edge.aKey) ?? []), edge])
    edgesByNode.set(edge.bKey, [...(edgesByNode.get(edge.bKey) ?? []), edge])
  }

  for (const wall of walls) {
    const sourcePoints = getExpansionSourcePoints(wall.points)
    for (let index = 0; index < sourcePoints.length - 1; index += 1) {
      addEdge(wall.id, sourcePoints[index]!, sourcePoints[index + 1]!)
    }
    if (isClosedWall(wall.points) && sourcePoints.length >= 3) {
      addEdge(wall.id, sourcePoints[sourcePoints.length - 1]!, sourcePoints[0]!)
    }
  }

  const visitedEdges = new Set<string>()
  const paths: Point2[][] = []

  for (const edge of allEdges) {
    const key = edgeKey(edge)
    if (visitedEdges.has(key)) continue
    const aDegree = edgesByNode.get(edge.aKey)?.length ?? 0
    const bDegree = edgesByNode.get(edge.bKey)?.length ?? 0
    if (aDegree === 2 && bDegree === 2) continue
    const startKey =
      aDegree === 1 && bDegree !== 1
        ? edge.aKey
        : bDegree === 1 && aDegree !== 1
          ? edge.bKey
          : aDegree === 2 && bDegree !== 2
            ? edge.bKey
            : edge.aKey
    const path = traceVisualWallChain(edge, startKey, edgesByNode, visitedEdges)
    if (path.length >= 2) paths.push(path)
  }

  for (const edge of allEdges) {
    if (visitedEdges.has(edgeKey(edge))) continue
    const path = traceVisualWallChain(edge, edge.aKey, edgesByNode, visitedEdges)
    if (path.length >= 2) paths.push(path)
  }

  return paths
}

function readPathsD(
  module: ClipperModule,
  paths: ClipperPathsD
): Array<{ points: Point2[]; area: number }> {
  const result: Array<{ points: Point2[]; area: number }> = []
  for (let pathIndex = 0; pathIndex < paths.size(); pathIndex += 1) {
    const path = paths.get(pathIndex)
    try {
      const points: Point2[] = []
      for (let pointIndex = 0; pointIndex < path.size(); pointIndex += 1) {
        const point = path.get(pointIndex)
        try {
          points.push({
            x: point.x / CLIPPER_COORDINATE_SCALE,
            y: point.y / CLIPPER_COORDINATE_SCALE,
          })
        } finally {
          point.delete?.()
        }
      }
      if (points.length >= 3) {
        result.push({
          points,
          area: module.AreaPathD(path) / (CLIPPER_COORDINATE_SCALE * CLIPPER_COORDINATE_SCALE),
        })
      }
    } finally {
      path.delete?.()
    }
  }
  return result
}

function signedPolygonArea(points: Point2[]): number {
  let doubled = 0
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!
    const next = points[(index + 1) % points.length]!
    doubled += point.x * next.y - next.x * point.y
  }
  return doubled / 2
}

/**
 * Hand-built junction, trim and cutout polygons have whatever winding their construction
 * happened to produce. Under the NonZero rule an overlapping pair of opposite windings
 * cancels into a hole, so give them the positive orientation Clipper's inflated walls use.
 */
function withPositiveOrientation(points: Point2[]): Point2[] {
  return signedPolygonArea(points) < 0 ? [...points].reverse() : points
}

function computeWallBounds(points: Point2[], padding: number) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  }
}

function boundsOverlap(
  a: ReturnType<typeof computeWallBounds>,
  b: ReturnType<typeof computeWallBounds>
): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY)
}

function rectangleFromOpening(
  wall: Wall,
  width: number,
  position: number,
  wallThickness: number
): Point2[] | null {
  const geom = computeOpeningGeometry(wall.points, position)
  if (!geom) return null
  const halfWidth = Math.max(0.5, width / 2)
  const halfThickness = Math.max(0.5, wallThickness / 2 + WALL_CUTOUT_PAD)
  const tangent = geom.tangent
  const normal = { x: -tangent.y, y: tangent.x }
  const center = geom.center

  return [
    {
      x: center.x - tangent.x * halfWidth - normal.x * halfThickness,
      y: center.y - tangent.y * halfWidth - normal.y * halfThickness,
    },
    {
      x: center.x + tangent.x * halfWidth - normal.x * halfThickness,
      y: center.y + tangent.y * halfWidth - normal.y * halfThickness,
    },
    {
      x: center.x + tangent.x * halfWidth + normal.x * halfThickness,
      y: center.y + tangent.y * halfWidth + normal.y * halfThickness,
    },
    {
      x: center.x - tangent.x * halfWidth + normal.x * halfThickness,
      y: center.y - tangent.y * halfWidth + normal.y * halfThickness,
    },
  ]
}

export async function buildWallVolumeComponents(
  walls: Wall[],
  doors: Door[],
  windows: Window[],
  masterWallThickness: number,
  pxPerMeter: number | null | undefined
): Promise<WallVolumeComponent[]> {
  return buildWallVolumeComponentsForVariant(
    undefined,
    walls,
    doors,
    windows,
    masterWallThickness,
    pxPerMeter
  )
}

export async function buildWallVolumeComponentsForVariant(
  variant: ClipperVariant | undefined,
  sourceWalls: Wall[],
  doors: Door[],
  windows: Window[],
  masterWallThickness: number,
  pxPerMeter: number | null | undefined
): Promise<WallVolumeComponent[]> {
  const curvedWallIds = new Set(
    sourceWalls.filter((wall) => isCurvedWall(wall)).map((wall) => wall.id)
  )
  const walls = sourceWalls.map((wall) =>
    wallWithDerivedPath(wall, CURVE_WALL_VOLUME_MAX_SEGMENT_LENGTH)
  )
  if (walls.length === 0) return []

  const module = await loadClipperModule(variant)
  const doorsByWall = new Map<string, Door[]>()
  const windowsByWall = new Map<string, Window[]>()

  for (const door of doors) {
    const list = doorsByWall.get(door.wallId) ?? []
    list.push(door)
    doorsByWall.set(door.wallId, list)
  }
  for (const window of windows) {
    const list = windowsByWall.get(window.wallId) ?? []
    list.push(window)
    windowsByWall.set(window.wallId, list)
  }

  const wallInfos = walls.map((wall) => {
    const thickness = resolveWallThicknessPx(wall, masterWallThickness, pxPerMeter)
    return {
      wall,
      thickness,
      bounds: computeWallBounds(wall.points, thickness / 2 + WALL_CUTOUT_PAD),
    }
  })

  const visited = new Set<number>()
  const components: WallVolumeComponent[] = []

  for (let startIndex = 0; startIndex < wallInfos.length; startIndex += 1) {
    if (visited.has(startIndex)) continue

    const queue = [startIndex]
    const componentIndexes: number[] = []
    visited.add(startIndex)

    while (queue.length > 0) {
      const index = queue.shift()!
      componentIndexes.push(index)
      const current = wallInfos[index]!
      for (let otherIndex = 0; otherIndex < wallInfos.length; otherIndex += 1) {
        if (visited.has(otherIndex)) continue
        const other = wallInfos[otherIndex]!
        if (!boundsOverlap(current.bounds, other.bounds)) continue
        visited.add(otherIndex)
        queue.push(otherIndex)
      }
    }

    const componentWalls = componentIndexes.map((index) => wallInfos[index]!)
    const renderedWalls = snapLooseWallEndpointsToConnectedJunctions(
      componentWalls.map((info) => info.wall),
      masterWallThickness,
      pxPerMeter
    )
    const renderedWallById = new Map(renderedWalls.map((wall) => [wall.id, wall]))
    const componentWallIds = new Set(componentWalls.map((info) => info.wall.id))
    const componentContainsCurve = componentWalls.some((info) => curvedWallIds.has(info.wall.id))
    const hasComponentOpenings =
      doors.some((door) => componentWallIds.has(door.wallId)) ||
      windows.some((window) => componentWallIds.has(window.wallId))
    const directVariableMiter = hasComponentOpenings
      ? null
      : buildVariableWidthWallChainPath(renderedWalls, masterWallThickness, pxPerMeter)
    if (directVariableMiter) {
      components.push({
        id: componentWalls.map((info) => info.wall.id).join('|'),
        wallIds: componentWalls.map((info) => info.wall.id),
        fillPaths: [directVariableMiter],
        outlinePaths: [directVariableMiter],
      })
      continue
    }

    const expandedWallPolygons: Point2[][] = []
    const openingCutouts: Point2[][] = []

    const wallsByThickness = new Map<number, Wall[]>()
    for (const info of componentWalls) {
      wallsByThickness.set(info.thickness, [
        ...(wallsByThickness.get(info.thickness) ?? []),
        renderedWallById.get(info.wall.id) ?? info.wall,
      ])
    }

    const expandSourcePaths = (
      sourcePaths: Point2[][],
      thickness: number,
      endType: ClipperModule['EndType']['Butt']
    ) => {
      if (sourcePaths.length === 0) return
      const wallPaths = createPathsD(module, sourcePaths)
      const expanded = module.InflatePathsD(
        wallPaths,
        (thickness / 2) * CLIPPER_COORDINATE_SCALE,
        module.JoinType.Miter,
        endType,
        2,
        0,
        CLIPPER_PRECISION
      )

      try {
        for (const path of readPathsD(module, expanded)) {
          if (Math.abs(path.area) > AREA_EPSILON) {
            expandedWallPolygons.push(path.points)
          }
        }
      } finally {
        expanded.delete?.()
        wallPaths.delete?.()
      }
    }

    for (const [thickness, sameThicknessWalls] of wallsByThickness) {
      const visualSourcePaths = buildVisualWallExpansionSources(sameThicknessWalls)
      expandSourcePaths(
        visualSourcePaths.filter((path) => !isClosedWall(path)),
        thickness,
        module.EndType.Butt
      )
      expandSourcePaths(
        visualSourcePaths.filter((path) => isClosedWall(path)),
        thickness,
        module.EndType.Joined
      )
    }

    expandedWallPolygons.push(
      ...buildWallJunctionPolygons(renderedWalls, masterWallThickness, pxPerMeter).map(
        withPositiveOrientation
      )
    )

    for (const info of componentWalls) {
      for (const door of doorsByWall.get(info.wall.id) ?? []) {
        const renderedWall = renderedWallById.get(info.wall.id) ?? info.wall
        const rect = rectangleFromOpening(renderedWall, door.width, door.position, info.thickness)
        if (rect) openingCutouts.push(rect)
      }
      for (const window of windowsByWall.get(info.wall.id) ?? []) {
        const renderedWall = renderedWallById.get(info.wall.id) ?? info.wall
        const rect = rectangleFromOpening(
          renderedWall,
          window.width,
          window.position,
          info.thickness
        )
        if (rect) openingCutouts.push(rect)
      }
    }
    openingCutouts.push(
      ...buildOpeningCornerFusions(
        renderedWalls,
        doors,
        windows,
        masterWallThickness,
        pxPerMeter
      ).map((fusion) => fusion.cutoutPolygon)
    )
    openingCutouts.push(
      ...buildWallJunctionTrimPolygons(renderedWalls, masterWallThickness, pxPerMeter)
    )
    if (expandedWallPolygons.length === 0) continue

    const subjectPaths = createPathsD(module, expandedWallPolygons)
    let mergedPaths = module.UnionSelfD(subjectPaths, module.FillRule.NonZero, CLIPPER_PRECISION)
    subjectPaths.delete?.()

    if (openingCutouts.length > 0) {
      const cutoutPaths = createPathsD(module, openingCutouts.map(withPositiveOrientation))
      const diffPaths = module.DifferenceD(
        mergedPaths,
        cutoutPaths,
        module.FillRule.NonZero,
        CLIPPER_PRECISION
      )
      mergedPaths.delete?.()
      cutoutPaths.delete?.()
      mergedPaths = diffPaths
    }

    try {
      const merged = readPathsD(module, mergedPaths).filter(
        (path) => Math.abs(path.area) > AREA_EPSILON
      )
      if (merged.length === 0) continue

      components.push({
        id: componentWalls.map((info) => info.wall.id).join('|'),
        wallIds: componentWalls.map((info) => info.wall.id),
        // A curve is already deliberately tessellated. The legacy simplifier's large
        // plan-space tolerance turns those samples into visible staircase chords and
        // repeatedly filtering them is needlessly expensive.
        fillPaths: merged.map((path) =>
          componentContainsCurve ? path.points : simplifyWallVolumePath(path.points)
        ),
        outlinePaths: hasComponentOpenings
          ? selectWallVolumeOutlinePaths(merged, openingCutouts, !componentContainsCurve)
          : merged.map((path) =>
              componentContainsCurve ? path.points : simplifyWallVolumePath(path.points)
            ),
      })
    } finally {
      mergedPaths.delete?.()
    }
  }

  return components
}
