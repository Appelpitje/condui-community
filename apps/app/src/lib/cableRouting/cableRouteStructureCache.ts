import { freeze, isDraft } from 'immer'
import { buildElectricalStructureSnapshot } from '@/lib/electricalStructure/builder'
import type { ElectricalStructureSnapshot } from '@/lib/electricalStructure'
import type { ElementModelV2, ProjectV2 } from '@/types/projectV2'

const verifiedFrozen = new WeakSet<object>()

/** Frozen JSON trees only: shallow freezing a mutable child must not enable reuse. */
export function isImmutableCableRouteInput(value: unknown, visiting = new Set<object>()): boolean {
  if (value == null || typeof value !== 'object') return true
  if (isDraft(value)) return false
  if (verifiedFrozen.has(value)) return true
  const prototype = Object.getPrototypeOf(value)
  if (
    !Object.isFrozen(value) ||
    visiting.has(value) ||
    (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
  )
    return false
  visiting.add(value)
  const valid = Object.values(value).every((child) => isImmutableCableRouteInput(child, visiting))
  visiting.delete(value)
  if (valid) verifiedFrozen.add(value)
  return valid
}

type StructureKey = {
  electrical: ProjectV2['disciplines']['electrical']
  projectId: string
  projectName: string
  quarantinedItems: NonNullable<ProjectV2['validation']>['quarantinedItems']
  elements: Array<{ index: number; element: ElementModelV2 }>
}

function structureKey(project: ProjectV2): StructureKey {
  return {
    electrical: project.disciplines.electrical,
    projectId: project.project.id,
    projectName: project.project.name,
    quarantinedItems: project.validation?.quarantinedItems,
    // Keep the source indices: the builder records elements[index] in raw nodes.
    elements: project.elements.flatMap((element, index) =>
      element.kind.startsWith('electrical.') &&
      !['electrical.panel', 'electrical.circuit', 'electrical.endpoint'].includes(element.kind)
        ? [{ index, element }]
        : []
    ),
  }
}

function sameKey(left: StructureKey, right: StructureKey): boolean {
  return (
    left.electrical === right.electrical &&
    left.projectId === right.projectId &&
    left.projectName === right.projectName &&
    left.quarantinedItems === right.quarantinedItems &&
    left.elements.length === right.elements.length &&
    left.elements.every(
      (row, index) =>
        row.index === right.elements[index]!.index && row.element === right.elements[index]!.element
    )
  )
}

/**
 * One logical electrical snapshot, independent of wall/door/floor geometry. The
 * builder's transition-wire and enclosure stamps use the electrical discipline;
 * its remaining inputs are project id/name, quarantine records and raw elements.
 * Routes still recalculate against each complete project revision.
 */
export function createCableRouteStructureReadCache(
  build?: typeof buildElectricalStructureSnapshot
) {
  let latest: { key: StructureKey; snapshot: ElectricalStructureSnapshot } | undefined
  return (project: ProjectV2): ElectricalStructureSnapshot => {
    // Resolve on use: plan wiring also participates in builder import cycles.
    const builder = build ?? buildElectricalStructureSnapshot
    if (!isImmutableCableRouteInput(project)) return builder(project)
    const key = structureKey(project)
    if (latest && sameKey(latest.key, key)) return latest.snapshot
    // Estimates expose some wire.cable references from this snapshot. Freeze it
    // so a consumer cannot poison another floor revision through those aliases.
    // Every canonical input is already deeply frozen before reaching this path.
    const snapshot = freeze(builder(project), true)
    latest = { key, snapshot }
    return snapshot
  }
}
