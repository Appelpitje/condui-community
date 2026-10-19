import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import {
  getChangeoverGridSourceAvailability,
  simulateChangeoverGridSourceOnProject,
} from '@/lib/supplyAssembly/changeoverGridSourceEdit'
import type { ChangeoverGridSource } from '@/lib/supplyAssembly/changeoverGridSource'
import type { ProjectV2 } from '@/types/projectV2'
import type { WireSegment } from '@/types/schema'
import type { Point } from '@/types/ui'
import {
  calculateBottomUpLayout,
  type BottomUpLayoutOptions,
  type BottomUpLayoutResult,
} from './bottomUpLayout'
import { deriveWires } from './deriveWires'
import { buildLayoutTree, type LayoutTree } from './layoutTree'

/** Uncached one-wire geometry of a project revision: layout, hit-test tree and wires. */
export interface OneWireGeometry {
  layout: BottomUpLayoutResult
  tree: LayoutTree
  wires: WireSegment[]
}

/**
 * Derive the one-wire geometry of any project revision without touching the editor caches.
 * Use it for simulated projects (hover previews): the module caches remember the latest
 * wires per project id, so feeding them a simulation would leak its ids into the canvas.
 */
export function deriveOneWireGeometry(
  project: ProjectWithOptionalV2Electrical,
  options: { overrides?: Map<string, Point>; layoutOptions?: BottomUpLayoutOptions } = {}
): OneWireGeometry {
  const layout = calculateBottomUpLayout(
    project,
    new Map(options.overrides ?? []),
    options.layoutOptions ?? {}
  )
  const tree = buildLayoutTree(layout)
  const installation = getProjectElectricalInstallation(project)
  const wires = installation
    ? deriveWires(
        tree,
        getProjectElectricalPanels(project),
        installation,
        selectProjectSupplyAssemblies(project),
        undefined,
        selectProjectWireRuns(project as ProjectV2)
      )
    : []
  return { layout, tree, wires }
}

export interface WireGeometryDiff {
  /** Segments of `next` that are not painted (fully) by `current`: draw these as the change. */
  added: WireSegment[]
  /** Segments of `current` that `next` no longer paints. */
  removed: WireSegment[]
  /** Segments of `next` already painted by `current`. */
  unchanged: WireSegment[]
}

const DIFF_TOLERANCE = 0.5

type Run = { diagram: string; axis: 'h' | 'v'; line: number; from: number; to: number }

function toRun(segment: WireSegment): Run | null {
  const diagram = segment.diagramId ?? segment.panelId ?? ''
  const { startPoint: a, endPoint: b } = segment
  if (Math.abs(a.y - b.y) <= DIFF_TOLERANCE) {
    return { diagram, axis: 'h', line: a.y, from: Math.min(a.x, b.x), to: Math.max(a.x, b.x) }
  }
  if (Math.abs(a.x - b.x) <= DIFF_TOLERANCE) {
    return { diagram, axis: 'v', line: a.x, from: Math.min(a.y, b.y), to: Math.max(a.y, b.y) }
  }
  return null
}

/** True when the union of `runs` on the same line covers `run`, allowing symbol gaps. */
function isCovered(run: Run, runs: Run[], gap: number): boolean {
  const intervals = runs
    .filter(
      (candidate) =>
        candidate.diagram === run.diagram &&
        candidate.axis === run.axis &&
        Math.abs(candidate.line - run.line) <= DIFF_TOLERANCE
    )
    .map(({ from, to }) => [from, to] as const)
    .sort((left, right) => left[0] - right[0])
  let reach = run.from
  for (const [from, to] of intervals) {
    if (from > reach + gap) break
    reach = Math.max(reach, to)
    if (reach >= run.to - DIFF_TOLERANCE) return true
  }
  return reach >= run.to - DIFF_TOLERANCE
}

/**
 * Geometric diff of two wire sets, segment by segment along shared lines. Wires are split at
 * devices, so coverage tolerates the gap a symbol leaves (`symbolGap`). Optionally limited to
 * one panel's supply wires.
 */
export function diffWireGeometry(
  current: readonly WireSegment[],
  next: readonly WireSegment[],
  options: { panelId?: string; supplyOnly?: boolean; symbolGap?: number } = {}
): WireGeometryDiff {
  const keep = (segment: WireSegment) =>
    (!options.panelId || segment.panelId === options.panelId) &&
    (!options.supplyOnly || segment.isSupplyTrunk === true)
  const gap = options.symbolGap ?? 24
  const currentSegments = current.filter(keep)
  const nextSegments = next.filter(keep)
  const currentRuns = currentSegments.flatMap((segment) => toRun(segment) ?? [])
  const nextRuns = nextSegments.flatMap((segment) => toRun(segment) ?? [])
  // Diagonal segments only match an identical segment.
  const pointsKey = (segment: WireSegment) =>
    JSON.stringify([
      segment.diagramId ?? segment.panelId,
      segment.startPoint.x,
      segment.startPoint.y,
      segment.endPoint.x,
      segment.endPoint.y,
    ])
  const currentKeys = new Set(currentSegments.map(pointsKey))
  const nextKeys = new Set(nextSegments.map(pointsKey))
  const diff: WireGeometryDiff = { added: [], removed: [], unchanged: [] }
  for (const segment of nextSegments) {
    const run = toRun(segment)
    const painted = run ? isCovered(run, currentRuns, gap) : currentKeys.has(pointsKey(segment))
    if (painted) diff.unchanged.push(segment)
    else diff.added.push(segment)
  }
  for (const segment of currentSegments) {
    const run = toRun(segment)
    const painted = run ? isCovered(run, nextRuns, gap) : nextKeys.has(pointsKey(segment))
    if (!painted) diff.removed.push(segment)
  }
  return diff
}

export interface ChangeoverGridSourcePreview {
  source: ChangeoverGridSource
  /** The simulated project; never stored. */
  project: ProjectWithOptionalV2Electrical
  /** One-wire geometry of the simulated project. */
  geometry: OneWireGeometry
  /** Supply-wire diff of the panel against `current` (when given). */
  diff?: WireGeometryDiff
}

/**
 * Hover preview of switching where a panel's changeover port 1 is fed: the simulated project
 * with its full one-wire geometry, plus the supply-wire diff against the current wires when
 * they are passed in. Returns null when the switch is unavailable or changes nothing.
 */
export function computeChangeoverGridSourcePreview<T extends ProjectWithOptionalV2Electrical>(
  project: T,
  panelId: string,
  source: ChangeoverGridSource,
  options: {
    currentWires?: readonly WireSegment[]
    overrides?: Map<string, Point>
    layoutOptions?: BottomUpLayoutOptions
  } = {}
): ChangeoverGridSourcePreview | null {
  const availability = getChangeoverGridSourceAvailability(project, panelId)
  if (source === 'converter-input' && !availability.available) return null
  const simulated = simulateChangeoverGridSourceOnProject(project, panelId, source)
  if (!simulated) return null
  const geometry = deriveOneWireGeometry(simulated, options)
  return {
    source,
    project: simulated,
    geometry,
    ...(options.currentWires
      ? {
          diff: diffWireGeometry(options.currentWires, geometry.wires, {
            panelId,
            supplyOnly: true,
          }),
        }
      : {}),
  }
}
