import type { WireSegment } from '@/types/schema'
import type { InstallationQueryAPI } from './core/query-api'
import type { ValidationProject } from './core/types'
import { calculateBottomUpLayout } from '@/lib/layout/bottomUpLayout'
import { buildLayoutTree } from '@/lib/layout/layoutTree'
import { deriveWires } from '@/lib/layout/deriveWires'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'

interface ValidationWireSnapshot {
  segments: WireSegment[]
  byPanel: Map<string, WireSegment[]>
  byCircuit: Map<string, WireSegment[]>
}

// A query belongs to one validation run. Keying by the project alone would keep
// stale results when a caller validates the same mutable document again.
const snapshots = new WeakMap<
  InstallationQueryAPI,
  {
    project: ValidationProject | undefined
    snapshot: ValidationWireSnapshot | undefined
  }
>()

/**
 * Canonical validation geometry: default layout, no preview/selection overrides,
 * and the snapshot's persisted wire runs. This deliberately is not a general
 * deriveWires cache: callers with different rendering options must not share it.
 * An unavailable/failed derivation is cached too; each rule keeps its own fallback.
 */
export function getDerivedWiresForValidation(
  query: InstallationQueryAPI,
  project = (query as InstallationQueryAPI & { project?: ValidationProject }).project
): ValidationWireSnapshot | undefined {
  const cached = snapshots.get(query)
  if (cached && cached.project === project) return cached.snapshot

  let snapshot: ValidationWireSnapshot | undefined
  try {
    const installation = project && getProjectElectricalInstallation(project)
    if (project && installation) {
      const layout = calculateBottomUpLayout(project, new Map())
      const tree = buildLayoutTree(layout)
      const segments = deriveWires(
        tree,
        getProjectElectricalPanels(project),
        installation,
        [],
        undefined,
        selectProjectWireRuns(project)
      )
      const byPanel = new Map<string, WireSegment[]>()
      const byCircuit = new Map<string, WireSegment[]>()
      for (const segment of segments) {
        const panelSegments = byPanel.get(segment.panelId)
        if (panelSegments) panelSegments.push(segment)
        else byPanel.set(segment.panelId, [segment])
        if (segment.circuitId == null) continue
        const circuitSegments = byCircuit.get(segment.circuitId)
        if (circuitSegments) circuitSegments.push(segment)
        else byCircuit.set(segment.circuitId, [segment])
      }
      snapshot = { segments, byPanel, byCircuit }
    }
  } catch {
    // Rules that can use stored segments still do so; others skip geometry checks.
  }
  snapshots.set(query, { project, snapshot })
  return snapshot
}
