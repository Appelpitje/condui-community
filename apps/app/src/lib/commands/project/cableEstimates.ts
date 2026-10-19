import { z } from 'zod'
import type { ProjectV2 } from '@/types/projectV2'
import { estimateCableRoutes } from '@/lib/cableRouting/estimateCableRoutes'

export const cableEstimateQuerySchema = z.strictObject({
  circuitId: z.string().min(1).max(200).optional(),
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(100).default(20),
})

/** Read-only, bounded projection of the same estimates accepted by the editor. */
export function inspectCableEstimates(
  project: ProjectV2,
  input: z.input<typeof cableEstimateQuerySchema> = {}
) {
  const query = cableEstimateQuerySchema.parse(input)
  const estimation = estimateCableRoutes(project)
  const routes = estimation.routes.filter(
    (route) => !query.circuitId || route.circuitId === query.circuitId
  )
  const result = {
    assumptions: estimation.assumptions,
    total: routes.length,
    nextOffset: query.offset + query.limit < routes.length ? query.offset + query.limit : null,
    estimates: routes.slice(query.offset, query.offset + query.limit).map((route) => ({
      anchor: route.anchor,
      circuitId: route.circuitId,
      circuitCode: route.circuitCode,
      fromNodeId: route.fromNodeId,
      toNodeId: route.toNodeId,
      fromLabel: route.fromLabel,
      toLabel: route.toLabel,
      cable: route.cable,
      basis: route.basis,
      lowM: route.lowM,
      highM: route.highM,
      scaleCalibrated: route.scaleCalibrated !== false,
      enteredLengthM: route.enteredLengthM,
      enteredLengthEstimated: route.enteredLengthEstimated,
      gaps: route.gaps,
      acceptable:
        !!route.cable &&
        route.highM > 0 &&
        route.scaleCalibrated !== false &&
        route.enteredLengthM == null,
    })),
  }
  return JSON.parse(JSON.stringify(result)) as typeof result
}
