import { applyWireInset } from '@/lib/layout/wireInsets'
import { PLAN_WIRE_HIT_STROKE_WIDTH } from '@/lib/plan/planWiring'
import { planWireSpanSetKey } from '@/lib/plan/planWiring'
import { resolveOrthogonalPolylines, type RoutePointContext } from '@/lib/plan/planWireOrthogonal'
import type { WallObstacleRect } from '@/lib/plan/labelWallCollision'
import {
  planWireMaxSplineHandle,
  sampleSpline,
  scaledVector,
  unitVector,
  vectorLength,
} from '@/lib/plan/planWireGeometry'
import type { Endpoint, PlanWireRoute, PlanWireRouteStyle, Point2 } from '@/types/schema'

/** Plan-space axis-aligned bounds for a wire segment (canvas units). */
export type WireObstacleRect = WallObstacleRect
export type WireObstacleBounds = { left: number; right: number; top: number; bottom: number }
export type WireObstacleIndex = {
  rects: WireObstacleRect[]
  query: (bounds: WireObstacleBounds) => WireObstacleRect[]
}

type RouteDraft = {
  route: PlanWireRoute
  basePoints: Point2[]
  style: PlanWireRouteStyle
}

function resolveEndpointAnchor(
  routeEnd: PlanWireRoute['from'],
  floorId: string,
  getEndpointById: (id: string) => Endpoint | undefined,
  placementPositionOverrides?: Map<string, Point2>
): { point: Point2; nodeType: string; symbolId: string | undefined } | null {
  const endpoint = getEndpointById(routeEnd.endpointId)
  const placement =
    endpoint?.placements.find((candidate) => candidate.id === routeEnd.placementId) ??
    endpoint?.placements.find((candidate) => candidate.floorId === floorId)
  if (!placement) return null
  const override = placementPositionOverrides?.get(placement.id)
  return {
    point: override ?? placement.pos,
    nodeType: endpoint?.type ?? 'endpoint',
    symbolId: endpoint?.symbol,
  }
}

function applyEndpointInsets(
  start: { point: Point2; nodeType: string; symbolId: string | undefined },
  waypoints: Point2[],
  end: { point: Point2; nodeType: string; symbolId: string | undefined }
): { start: Point2; end: Point2 } {
  const startOther = waypoints[0] ?? end.point
  const endOther = waypoints[waypoints.length - 1] ?? start.point
  return {
    start: applyWireInset(start.point, startOther, start.nodeType, start.symbolId),
    end: applyWireInset(end.point, endOther, end.nodeType, end.symbolId),
  }
}

function averageContinuation(origin: Point2, continuations: Point2[]): Point2 | undefined {
  if (continuations.length === 0) return undefined
  let x = 0
  let y = 0
  let count = 0
  for (const point of continuations) {
    const unit = unitVector({ x: point.x - origin.x, y: point.y - origin.y })
    if (vectorLength(unit) <= 1e-6) continue
    x += unit.x
    y += unit.y
    count += 1
  }
  if (count === 0) return undefined
  const length = Math.max(
    48,
    Math.min(
      160,
      continuations.reduce(
        (sum, point) => sum + Math.hypot(point.x - origin.x, point.y - origin.y),
        0
      ) /
        count /
        2
    )
  )
  const direction = scaledVector({ x, y }, length)
  return { x: origin.x + direction.x, y: origin.y + direction.y }
}

function routeBeforePoint(route: { basePoints: Point2[] }): Point2 | undefined {
  return route.basePoints[route.basePoints.length - 2] ?? route.basePoints[0]
}

function routeAfterPoint(route: { basePoints: Point2[] }): Point2 | undefined {
  return route.basePoints[1] ?? route.basePoints[0]
}

function routePoints(start: Point2, waypoints: Point2[] | undefined, end: Point2): Point2[] {
  return [start, ...(waypoints ?? []), end]
}

function buildRouteDrafts(
  routes: PlanWireRoute[],
  routeStyle: PlanWireRouteStyle,
  getEndpointById: (id: string) => Endpoint | undefined,
  placementPositionOverrides?: Map<string, Point2>
): Array<{ draft: RouteDraft; context: RoutePointContext }> {
  const drafts = routes
    .map((route) => {
      const startAnchor = resolveEndpointAnchor(
        route.from,
        route.floorId,
        getEndpointById,
        placementPositionOverrides
      )
      const endAnchor = resolveEndpointAnchor(
        route.to,
        route.floorId,
        getEndpointById,
        placementPositionOverrides
      )
      if (!startAnchor || !endAnchor) return null
      const waypoints = [...(route.waypoints ?? [])]
      const { start, end } = applyEndpointInsets(startAnchor, waypoints, endAnchor)
      return { route, basePoints: routePoints(start, waypoints, end), style: routeStyle }
    })
    .filter((entry): entry is RouteDraft => Boolean(entry))

  const incomingByPlacement = new Map<string, RouteDraft[]>()
  const outgoingByPlacement = new Map<string, RouteDraft[]>()
  for (const draft of drafts) {
    const toPlacementId = draft.route.to.placementId
    const fromPlacementId = draft.route.from.placementId
    if (toPlacementId) {
      incomingByPlacement.set(toPlacementId, [
        ...(incomingByPlacement.get(toPlacementId) ?? []),
        draft,
      ])
    }
    if (fromPlacementId) {
      outgoingByPlacement.set(fromPlacementId, [
        ...(outgoingByPlacement.get(fromPlacementId) ?? []),
        draft,
      ])
    }
  }

  return drafts.map((draft) => {
    const incoming = draft.route.from.placementId
      ? (incomingByPlacement.get(draft.route.from.placementId) ?? [])
      : []
    const outgoing = draft.route.to.placementId
      ? (outgoingByPlacement.get(draft.route.to.placementId) ?? [])
      : []
    const incomingRoute = incoming.find((route) => route.route.id !== draft.route.id)
    const outgoingRoute =
      outgoing.length === 1
        ? outgoing.find((route) => route.route.id !== draft.route.id)
        : undefined
    const context: RoutePointContext = {}
    if (incomingRoute) context.startPrevious = routeBeforePoint(incomingRoute)
    if (outgoingRoute) {
      context.endNext = routeAfterPoint(outgoingRoute)
    } else if (outgoing.length > 1) {
      const forkPoint = draft.basePoints[draft.basePoints.length - 1]
      if (forkPoint) {
        context.endNext = averageContinuation(
          forkPoint,
          outgoing
            .filter((route) => route.route.id !== draft.route.id)
            .map(routeAfterPoint)
            .filter((point): point is Point2 => Boolean(point))
        )
      }
    }
    return { draft, context }
  })
}

function segmentToObstacleRect(a: Point2, b: Point2, halfThickness: number): WireObstacleRect {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) {
    return {
      left: a.x - halfThickness,
      right: a.x + halfThickness,
      top: a.y - halfThickness,
      bottom: a.y + halfThickness,
    }
  }
  const nx = (-dy / len) * halfThickness
  const ny = (dx / len) * halfThickness
  const xs = [a.x + nx, a.x - nx, b.x + nx, b.x - nx]
  const ys = [a.y + ny, a.y - ny, b.y + ny, b.y - ny]
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  }
}

/**
 * Build AABBs along plan wire centerlines for label overlap tests.
 * Uses straight segments between route points (good enough for orthogonal routes;
 * slightly conservative for splines).
 */
export function buildPlanWireObstacleRects(
  routes: PlanWireRoute[],
  getEndpointById: (id: string) => Endpoint | undefined,
  placementPositionOverrides?: Map<string, Point2>,
  extraPadPx = 2,
  routeStyle: PlanWireRouteStyle = 'orthogonal',
  pxPerMeter?: number | null
): WireObstacleRect[] {
  const maxSplineHandle = planWireMaxSplineHandle(pxPerMeter)
  const halfThickness = PLAN_WIRE_HIT_STROKE_WIDTH / 2 + extraPadPx
  const rects: WireObstacleRect[] = []
  const drafts = buildRouteDrafts(routes, routeStyle, getEndpointById, placementPositionOverrides)

  const incomingRouteIdByRouteId = new Map<string, string>()
  const outgoingRouteIdByRouteId = new Map<string, string>()
  const incomingByEnd = new Map<string, RouteDraft[]>()
  const outgoingByStart = new Map<string, RouteDraft[]>()
  for (const { draft } of drafts) {
    if (draft.route.to.placementId) {
      incomingByEnd.set(draft.route.to.placementId, [
        ...(incomingByEnd.get(draft.route.to.placementId) ?? []),
        draft,
      ])
    }
    if (draft.route.from.placementId) {
      outgoingByStart.set(draft.route.from.placementId, [
        ...(outgoingByStart.get(draft.route.from.placementId) ?? []),
        draft,
      ])
    }
  }
  for (const { draft } of drafts) {
    const incoming = draft.route.from.placementId
      ? (incomingByEnd.get(draft.route.from.placementId) ?? [])
      : []
    const outgoing = draft.route.to.placementId
      ? (outgoingByStart.get(draft.route.to.placementId) ?? [])
      : []
    const incomingRoute = incoming.find((route) => route.route.id !== draft.route.id)
    const outgoingRoute =
      outgoing.length === 1
        ? outgoing.find((route) => route.route.id !== draft.route.id)
        : undefined
    if (incomingRoute) incomingRouteIdByRouteId.set(draft.route.id, incomingRoute.route.id)
    if (outgoingRoute) outgoingRouteIdByRouteId.set(draft.route.id, outgoingRoute.route.id)
  }

  const orthogonalInputs = drafts
    .filter(({ draft }) => draft.style === 'orthogonal')
    .map(({ draft, context }) => ({
      id: draft.route.id,
      spanSetKey: planWireSpanSetKey(draft.route),
      basePoints: draft.basePoints,
      context: context.startPrevious || context.endNext ? context : undefined,
    }))
  const orthogonalPolylines = resolveOrthogonalPolylines(orthogonalInputs, {
    getIncomingRouteId: (routeId) => incomingRouteIdByRouteId.get(routeId),
    getOutgoingRouteId: (routeId) => outgoingRouteIdByRouteId.get(routeId),
  })

  for (const { draft, context } of drafts) {
    const hasContext = Boolean(context.startPrevious || context.endNext)
    const points =
      draft.style === 'spline'
        ? sampleSpline(draft.basePoints, hasContext ? context : undefined, maxSplineHandle)
        : draft.style === 'straight'
          ? draft.basePoints
          : (orthogonalPolylines.get(draft.route.id) ?? draft.basePoints)
    for (let i = 0; i < points.length - 1; i++) {
      rects.push(segmentToObstacleRect(points[i]!, points[i + 1]!, halfThickness))
    }
  }

  return rects
}

export function buildWireObstacleIndex(
  rects: WireObstacleRect[],
  cellSize = 160
): WireObstacleIndex {
  const buckets = new Map<string, WireObstacleRect[]>()
  const key = (x: number, y: number) => `${x},${y}`

  for (const rect of rects) {
    const minCellX = Math.floor(rect.left / cellSize)
    const maxCellX = Math.floor(rect.right / cellSize)
    const minCellY = Math.floor(rect.top / cellSize)
    const maxCellY = Math.floor(rect.bottom / cellSize)
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const bucketKey = key(cellX, cellY)
        const bucket = buckets.get(bucketKey)
        if (bucket) bucket.push(rect)
        else buckets.set(bucketKey, [rect])
      }
    }
  }

  return {
    rects,
    query: (bounds) => {
      const minCellX = Math.floor(bounds.left / cellSize)
      const maxCellX = Math.floor(bounds.right / cellSize)
      const minCellY = Math.floor(bounds.top / cellSize)
      const maxCellY = Math.floor(bounds.bottom / cellSize)
      const result: WireObstacleRect[] = []
      const seen = new Set<WireObstacleRect>()
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
          for (const rect of buckets.get(key(cellX, cellY)) ?? []) {
            if (seen.has(rect)) continue
            seen.add(rect)
            result.push(rect)
          }
        }
      }
      return result
    },
  }
}
