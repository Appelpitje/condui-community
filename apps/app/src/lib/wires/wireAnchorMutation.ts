import type { ProjectV2, WireRun } from '@/types/projectV2'
import {
  selectProjectPlanWireRoutes,
  updatePlanWireRoutesForProject,
} from '@/lib/projectV2/planWiring'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { walkPanels, collectCircuits } from '@/lib/panel/panelTree'

function renameKey<T>(record: Record<string, T> | undefined, from: string, to: string): void {
  if (!record || !(from in record)) return
  record[to] ??= record[from]!
  delete record[from]
}

/** The same physical connection keeps its per-member records and core identities. */
export function rekeyWireRunMember(run: WireRun, from: string, to: string): void {
  run.members = [...new Set(run.members.map((member) => (member === from ? to : member)))]
  renameKey(run.segmentLengths, from, to)
  renameKey(run.segmentLengthSources, from, to)
  renameKey(run.coreAliases, from, to)
}

export function followProjectWireAnchorReferences(
  project: ProjectV2,
  replacements: ReadonlyMap<string, string>,
  before?: ProjectV2
): void {
  if (!replacements.size) return
  const follow = (anchor: string) => replacements.get(anchor) ?? anchor
  const panelsByCircuit = new Map(
    [...walkPanels(getProjectElectricalPanels(project))].flatMap((panel) =>
      collectCircuits(panel).map((circuit) => [circuit.id, panel.id] as const)
    )
  )
  const currentRoutes = selectProjectPlanWireRoutes(project)
  const currentIds = new Set(currentRoutes.map((route) => route.id))
  const placementsByEndpoint = new Map(
    [...walkPanels(getProjectElectricalPanels(project))].flatMap((panel) =>
      collectCircuits(panel).flatMap((circuit) =>
        circuit.endpoints.map(
          (endpoint) =>
            [endpoint.id, new Set(endpoint.placements.map((placement) => placement.id))] as const
        )
      )
    )
  )
  // A topology mutator may have healed away a trace while its circuit owner was changing.
  // Restore it only for the same relocated wire and two still-existing plan endpoints.
  const restored = before
    ? selectProjectPlanWireRoutes(before).filter(
        (route) =>
          !currentIds.has(route.id) &&
          route.wireAnchor &&
          replacements.has(route.wireAnchor) &&
          [route.from, route.to].every(
            (end) =>
              end.endpointId &&
              placementsByEndpoint.has(end.endpointId) &&
              (!end.placementId || placementsByEndpoint.get(end.endpointId)!.has(end.placementId))
          )
      )
    : []
  if (
    restored.length ||
    selectProjectPlanWireRoutes(project).some(
      (route) => route.wireAnchor && replacements.has(route.wireAnchor)
    )
  )
    updatePlanWireRoutesForProject(project, (routes) =>
      [...routes, ...restored].map((route) => {
        if (!route.wireAnchor || !replacements.has(route.wireAnchor)) return route
        const wireAnchor = follow(route.wireAnchor)
        const circuitId = /^circuit:([^:]+):/.exec(wireAnchor)?.[1]
        return {
          ...route,
          wireAnchor,
          ...(circuitId
            ? { circuitId, panelId: panelsByCircuit.get(circuitId) ?? route.panelId }
            : {}),
        }
      })
    )
  for (const asset of project.disciplines.electrical?.junctionAssets ?? []) {
    for (const termination of asset.terminations) {
      if (replacements.has(termination.core.wireAnchor))
        termination.core = { ...termination.core, wireAnchor: follow(termination.core.wireAnchor) }
    }
    for (const entry of asset.box?.entryAssignments ?? [])
      if (replacements.has(entry.wireAnchor)) entry.wireAnchor = follow(entry.wireAnchor)
  }
}
