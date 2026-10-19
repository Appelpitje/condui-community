import { z } from 'zod'
import type { ProjectV2 } from '@/types/projectV2'
import { deriveAutoPlanWireRoutes, mergePlanWireRoutes } from '@/lib/plan/planWiring'
import { selectProjectPlanWireRoutes } from '@/lib/projectV2/planWiring'

export const planWireRouteQuerySchema = z.strictObject({
  floorId: z.string().min(1).max(200),
  routing: z.enum(['cable', 'legacy']).default('cable'),
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(100).default(20),
})

/** Explicit projection keeps generated route IDs usable in browser and plain Node commands. */
export function inspectPlanWireRoutes(
  project: ProjectV2,
  input: z.input<typeof planWireRouteQuerySchema>
) {
  const query = planWireRouteQuerySchema.parse(input)
  if (!project.building.floors.some((floor) => floor.id === query.floorId))
    throw new Error('Floor not found')
  const routes = mergePlanWireRoutes(
    deriveAutoPlanWireRoutes(project, query.floorId, ['lighting-control', 'sockets', 'other'], {
      routing: query.routing,
    }),
    selectProjectPlanWireRoutes(project).filter((route) => route.floorId === query.floorId)
  )
  const result = {
    total: routes.length,
    nextOffset: query.offset + query.limit < routes.length ? query.offset + query.limit : null,
    routes: routes.slice(query.offset, query.offset + query.limit).map((route) => ({
      id: route.id,
      kind: route.kind,
      source: route.source,
      floorId: route.floorId,
      circuitId: route.circuitId,
      from: route.from,
      to: route.to,
      wireAnchor: route.wireAnchor,
      waypoints: route.waypoints?.slice(0, 200),
      waypointsTruncated: (route.waypoints?.length ?? 0) > 200,
      riser: route.riser,
      riserExit: route.riserExit,
    })),
  }
  return JSON.parse(JSON.stringify(result)) as typeof result
}
