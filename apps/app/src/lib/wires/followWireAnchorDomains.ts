/**
 * A circuit cable's anchor names its current domain (`circuit:A:into:endpoint:x:DC`). Adding or
 * removing an inverter or rectifier upstream flips that suffix without touching the cable, so
 * everything stored under the old anchor (the wire spec and cores, lengths, plan traces, junction
 * connections) would silently fall back to defaults. This moves those keys to the anchor the cable
 * has now. Cheap: it reads the domain map, not the structure snapshot.
 */
import type { ProjectV2, WireRun } from '@/types/projectV2'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { selectProjectPlanWireRoutes, updatePlanWireRoutesForProject } from '@/lib/projectV2/planWiring'
import { circuitWireDomains } from './circuitWireIdentity'

const CIRCUIT_ANCHOR = /^circuit:([^:]+):into:([^:]+):(.+):(AC|DC)$/

/** The anchor this cable has now, when its domain changed; otherwise undefined. */
function createAnchorFollower(project: ProjectV2): (anchor: string) => string | undefined {
  const domains = circuitWireDomains(getProjectElectricalPanels(project))
  return (anchor) => {
    const match = CIRCUIT_ANCHOR.exec(anchor)
    if (!match) return undefined
    const [, circuitId, , entityId, domain] = match
    const current = domains.get(`${circuitId}:${entityId}`)
    return current && current !== domain ? `${anchor.slice(0, -domain!.length)}${current}` : undefined
  }
}

function renameKey<T>(record: Record<string, T> | undefined, from: string, to: string): void {
  if (!record || !(from in record)) return
  if (!(to in record)) record[to] = record[from]!
  delete record[from]
}

function followRun(run: WireRun, follow: (anchor: string) => string | undefined, owner: Map<string, WireRun>): boolean {
  let changed = false
  run.members = run.members.flatMap((member) => {
    const next = follow(member)
    // Another run already holds the new anchor (edited after the flip): that one wins.
    if (!next || (owner.get(next) && owner.get(next) !== run)) return [member]
    renameKey(run.segmentLengths, member, next)
    renameKey(run.segmentLengthSources, member, next)
    renameKey(run.coreAliases, member, next)
    owner.set(next, run)
    owner.delete(member)
    changed = true
    return run.members.includes(next) ? [] : [next]
  })
  return changed
}

/** Moves every stored anchor whose cable changed domain. Returns whether anything changed. */
export function followWireAnchorDomains(project: ProjectV2): boolean {
  const runs = selectProjectWireRuns(project)
  const electrical = project.disciplines?.electrical
  const planWires = selectProjectPlanWireRoutes(project)
  const assets = electrical?.junctionAssets ?? []
  if (runs.length === 0 && planWires.length === 0 && assets.length === 0) return false
  const follow = createAnchorFollower(project)

  const owner = new Map<string, WireRun>()
  for (const run of runs) for (const member of run.members) if (!owner.has(member)) owner.set(member, run)
  let changed = false
  for (const run of runs) changed = followRun(run, follow, owner) || changed

  // Plan traces are stored as elements; their aliases come from the live estimate and are not stored.
  if (planWires.some((route) => route.wireAnchor && follow(route.wireAnchor))) {
    updatePlanWireRoutesForProject(project, (routes) =>
      routes.map((route) => {
        const next = route.wireAnchor ? follow(route.wireAnchor) : undefined
        return next ? { ...route, wireAnchor: next } : route
      })
    )
    changed = true
  }

  for (const asset of assets) {
    for (const termination of asset.terminations) {
      const next = follow(termination.core.wireAnchor)
      if (next) {
        termination.core = { ...termination.core, wireAnchor: next }
        changed = true
      }
    }
    for (const entry of asset.box?.entryAssignments ?? []) {
      const next = follow(entry.wireAnchor)
      if (next) {
        entry.wireAnchor = next
        changed = true
      }
    }
  }
  return changed
}

/** Whether {@link followWireAnchorDomains} would change anything; never writes. */
export function wireAnchorDomainsNeedFollowing(project: ProjectV2): boolean {
  const electrical = project.disciplines?.electrical
  const anchors = [
    ...selectProjectWireRuns(project).flatMap((run) => run.members),
    ...selectProjectPlanWireRoutes(project).map((route) => route.wireAnchor ?? ''),
    ...(electrical?.junctionAssets ?? []).flatMap((asset) => [
      ...asset.terminations.map((termination) => termination.core.wireAnchor),
      ...(asset.box?.entryAssignments ?? []).map((entry) => entry.wireAnchor),
    ]),
  ].filter((anchor) => CIRCUIT_ANCHOR.test(anchor))
  if (anchors.length === 0) return false
  const follow = createAnchorFollower(project)
  return anchors.some((anchor) => follow(anchor) !== undefined)
}
