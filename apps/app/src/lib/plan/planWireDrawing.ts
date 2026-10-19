import type { ProjectV2 } from '@/types/projectV2'
import {
  buildManualOtherPlanWireRoute,
  buildManualPlanWireRoutesForPlacementMove,
  healPlanWiring,
  resolvePlanLightingBranchConnection,
} from './planWiring'
import { replacePlanWireSpanRoutes } from './planWiringRouteEdits'
import {
  replacePlanWireRoutesForProject,
  replacePlanWiringVisibilityForProject,
  selectProjectPlanWireRoutes,
  selectProjectPlanWiringVisibility,
} from '@/lib/projectV2/planWiring'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { syncDerivedEndpointFlags } from '@/lib/eendraad/endpointInsertAfter'

export interface DrawPlanWireInput {
  floorId: string
  sourcePlacementId: string
  targetPlacementId: string
  keepAutoSpans: boolean
}

export function planWireDrawing(project: ProjectV2, input: DrawPlanWireInput) {
  const { floorId, sourcePlacementId, targetPlacementId, keepAutoSpans } = input
  const other = buildManualOtherPlanWireRoute(project, floorId, sourcePlacementId, targetPlacementId)
  if (other) return { other, routes: null }
  const routes = buildManualPlanWireRoutesForPlacementMove(
    project, floorId, sourcePlacementId, targetPlacementId, { keepAutoSpans }
  )
  return routes?.length ? { other: null, routes } : null
}

/** Apply the inferred branch assignment and its drawn wire as one project mutation. */
export function drawPlanWireInProject(project: ProjectV2, input: DrawPlanWireInput): boolean {
  const drawing = planWireDrawing(project, input)
  if (!drawing) return false
  const connection = resolvePlanLightingBranchConnection(
    project, input.floorId, input.sourcePlacementId, input.targetPlacementId
  )
  if (connection?.mode === 'attach-light') {
    connection.sourceBranch.endpointIds.push(connection.target.endpoint.id)
    connection.circuit.branches = connection.circuit.branches!.filter(
      (branch) => branch.id !== connection.targetBranch.id
    )
    syncSequentialEndpointBranchLabelsToCircuit(connection.circuit)
    syncDerivedEndpointFlags(connection.circuit)
  }
  const stored = selectProjectPlanWireRoutes(project)
  const proposed = drawing.other
    ? [...stored.filter((route) => route.id !== drawing.other!.id), drawing.other]
    : replacePlanWireSpanRoutes(stored, drawing.routes!)
  // Group replacement should not create history merely by reordering stored traces.
  const proposedById = new Map(proposed.map((route) => [route.id, route]))
  const unchanged = proposed.length === stored.length && stored.every((route) =>
    JSON.stringify(proposedById.get(route.id)) === JSON.stringify(route))
  const routes = unchanged ? stored : proposed
  const visibility = {
    ...selectProjectPlanWiringVisibility(project),
    wiresVisible: true,
    ...(drawing.other ? { otherVisible: true }
      : drawing.routes![0]!.kind === 'lighting-control' ? { lightingVisible: true } : { socketsVisible: true }),
  }
  if (JSON.stringify(routes) !== JSON.stringify(stored)) replacePlanWireRoutesForProject(project, routes)
  if (JSON.stringify(visibility) !== JSON.stringify(selectProjectPlanWiringVisibility(project)))
    replacePlanWiringVisibilityForProject(project, visibility)
  if (connection?.mode === 'attach-light') healPlanWiring(project)
  return true
}
