import type { Circuit, Endpoint, Panel, ProtectionDevice } from '@/types/schema'
import { isDraft } from 'immer'

export interface CircuitContext {
  panel: Panel
  protection?: ProtectionDevice
}

export interface ParentCircuitInfo {
  parentCircuit: Circuit
  parentProtection: ProtectionDevice | null
}

export interface ElectricalLookupIndex {
  panelsById: Map<string, Panel>
  panelsByName: Map<string, Panel>
  protectionsById: Map<string, ProtectionDevice>
  protectionPanelsById: Map<string, Panel>
  circuitsById: Map<string, { circuit: Circuit; parent: Panel | ProtectionDevice }>
  endpointsById: Map<string, { endpoint: Endpoint; circuit: Circuit }>
  circuitContextsById: Map<string, CircuitContext>
  parentCircuitsByChildId: Map<string, ParentCircuitInfo>
  panelFeedersByPanelId: Map<string, { feederCircuit: Circuit }>
}

const cache = new WeakMap<Panel[], ElectricalLookupIndex>()
const panelSnapshotIndexes = new WeakMap<Panel, ElectricalLookupIndex>()
const mutablePanelSnapshots = new WeakSet<Panel>()
const scopedIndexes = new WeakMap<Panel[], ElectricalLookupIndex>()
const draftIndexes = new WeakSet<ElectricalLookupIndex>()
const endpointRenderSignatures = new WeakMap<Endpoint, string>()
const endpointRenderRevisionsByProject = new Map<
  string,
  Map<string, Array<{ signature: string; endpoint: Endpoint }>>
>()
const MAX_ENDPOINT_RENDER_REVISIONS = 2
const MAX_ENDPOINT_RENDER_PROJECTS = 10

/** Mutable command drafts keep the caller's early-exit tree search instead. */
export function getElectricalSnapshotIndex(panels: Panel[]): ElectricalLookupIndex | undefined {
  const scoped = scopedIndexes.get(panels)
  if (scoped) return scoped
  if (isDraft(panels) || !Object.isFrozen(panels)) return undefined
  return getElectricalLookupIndex(panels)
}

/** Complete subtree index for callers that only have one immutable root panel. */
export function getElectricalPanelSnapshotIndex(panel: Panel): ElectricalLookupIndex | undefined {
  if (isDraft(panel) || !Object.isFrozen(panel) || mutablePanelSnapshots.has(panel))
    return undefined
  const cached = panelSnapshotIndexes.get(panel)
  if (cached) return cached

  const panels = [panel]
  Object.freeze(panels)
  const index = getElectricalLookupIndex(panels)
  // A frozen outer panel can still contain editable arrays, circuits or drafts.
  // Only reuse indexes the existing builder accepted as immutable throughout.
  if (cache.get(panels) !== index) {
    mutablePanelSnapshots.add(panel)
    return undefined
  }
  panelSnapshotIndexes.set(panel, index)
  return index
}

/**
 * Share lookups during one synchronous, read-only pass over an owned snapshot,
 * including plain worker clones. The callback must not edit electrical topology.
 * Nothing is retained after the pass, so a later edit gets a fresh index. Drafts
 * (including plain arrays wrapping draft panels) keep uncached mutable queries.
 */
export function withElectricalSnapshotIndex<T>(panels: Panel[], read: () => T): T {
  if (isDraft(panels) || scopedIndexes.has(panels)) return read()
  const index = getElectricalLookupIndex(panels)
  if (draftIndexes.has(index)) return read()
  scopedIndexes.set(panels, index)
  try {
    return read()
  } finally {
    scopedIndexes.delete(panels)
  }
}

function getEndpointRenderSignature(endpoint: Endpoint): string {
  const cached = endpointRenderSignatures.get(endpoint)
  if (cached) return cached
  const signature = JSON.stringify(endpoint)
  endpointRenderSignatures.set(endpoint, signature)
  return signature
}

/**
 * Preserve entity identity across full history snapshots when the endpoint value
 * is unchanged. This lets leaf canvas subscriptions ignore clone-only revisions.
 */
export function getStableEndpointRenderRevision(projectId: string, endpoint: Endpoint): Endpoint {
  let projectRevisions = endpointRenderRevisionsByProject.get(projectId)
  if (!projectRevisions) {
    projectRevisions = new Map()
    endpointRenderRevisionsByProject.set(projectId, projectRevisions)
    if (endpointRenderRevisionsByProject.size > MAX_ENDPOINT_RENDER_PROJECTS) {
      const oldestProjectId = endpointRenderRevisionsByProject.keys().next().value
      if (oldestProjectId) endpointRenderRevisionsByProject.delete(oldestProjectId)
    }
  }
  const signature = getEndpointRenderSignature(endpoint)
  const revisions = projectRevisions.get(endpoint.id) ?? []
  const existing = revisions.find((revision) => revision.signature === signature)
  if (existing) return existing.endpoint
  projectRevisions.set(
    endpoint.id,
    [{ signature, endpoint }, ...revisions].slice(0, MAX_ENDPOINT_RENDER_REVISIONS)
  )
  return endpoint
}

interface IndexBuildState {
  cacheable: boolean
  hasDraft: boolean
  visitedPanels: Set<Panel>
}

function requireImmutable(state: IndexBuildState, value: object): void {
  if (isDraft(value)) {
    state.hasDraft = true
    state.cacheable = false
  } else if (state.cacheable && !Object.isFrozen(value)) {
    state.cacheable = false
  }
}

function addCircuit(
  index: ElectricalLookupIndex,
  circuit: Circuit,
  panel: Panel,
  protection: ProtectionDevice | undefined,
  state: IndexBuildState
): void {
  requireImmutable(state, circuit)
  requireImmutable(state, circuit.endpoints)
  if (circuit.subCircuitIds) requireImmutable(state, circuit.subCircuitIds)
  if (!index.circuitsById.has(circuit.id)) {
    index.circuitsById.set(circuit.id, { circuit, parent: protection ?? panel })
    index.circuitContextsById.set(circuit.id, protection ? { panel, protection } : { panel })
  }
  for (const childId of circuit.subCircuitIds ?? []) {
    if (!index.parentCircuitsByChildId.has(childId)) {
      index.parentCircuitsByChildId.set(childId, {
        parentCircuit: circuit,
        parentProtection: protection ?? null,
      })
    }
  }
  for (const endpoint of circuit.endpoints) {
    requireImmutable(state, endpoint)
    if (!index.endpointsById.has(endpoint.id)) {
      index.endpointsById.set(endpoint.id, { endpoint, circuit })
    }
  }
}

function addPanel(index: ElectricalLookupIndex, panel: Panel, state: IndexBuildState): void {
  if (state.visitedPanels.has(panel)) return
  state.visitedPanels.add(panel)
  requireImmutable(state, panel)
  requireImmutable(state, panel.circuits)
  requireImmutable(state, panel.protections)
  if (panel.subPanels) requireImmutable(state, panel.subPanels)
  if (!index.panelsById.has(panel.id)) index.panelsById.set(panel.id, panel)
  if (!index.panelsByName.has(panel.name)) index.panelsByName.set(panel.name, panel)

  for (const circuit of panel.circuits) addCircuit(index, circuit, panel, undefined, state)
  const seenPanelFeeds = new Set<string>()
  for (const protection of panel.protections) {
    requireImmutable(state, protection)
    if (protection.circuits) requireImmutable(state, protection.circuits)
    if (!index.protectionsById.has(protection.id)) {
      index.protectionsById.set(protection.id, protection)
      index.protectionPanelsById.set(protection.id, panel)
    }
    for (const circuit of protection.circuits ?? []) {
      addCircuit(index, circuit, panel, protection, state)
    }
    const targetPanelId = protection.subPanelId
    if (targetPanelId && !seenPanelFeeds.has(targetPanelId)) {
      seenPanelFeeds.add(targetPanelId)
      const feederCircuit =
        protection.circuits?.find((circuit) =>
          circuit.endpoints.some(
            (endpoint) =>
              endpoint.symbol === 'panel_distribution' && endpoint.panelId === targetPanelId
          )
        ) ?? protection.circuits?.[0]
      if (feederCircuit && !index.panelFeedersByPanelId.has(targetPanelId)) {
        index.panelFeedersByPanelId.set(targetPanelId, { feederCircuit })
      }
    }
  }
  for (const subPanel of panel.subPanels ?? []) addPanel(index, subPanel, state)
}

/**
 * Build all common electrical entity lookups once per immutable V2 panels revision.
 * Immer preserves that array reference until electrical data changes, so hundreds
 * of mounted canvas subscribers share one linear pass instead of each walking the
 * complete project independently.
 */
export function getElectricalLookupIndex(panels: Panel[]): ElectricalLookupIndex {
  const scoped = scopedIndexes.get(panels)
  if (scoped) return scoped
  const cached = cache.get(panels)
  if (cached) return cached

  const index: ElectricalLookupIndex = {
    panelsById: new Map(),
    panelsByName: new Map(),
    protectionsById: new Map(),
    protectionPanelsById: new Map(),
    circuitsById: new Map(),
    endpointsById: new Map(),
    circuitContextsById: new Map(),
    parentCircuitsByChildId: new Map(),
    panelFeedersByPanelId: new Map(),
  }
  const state: IndexBuildState = {
    cacheable: !isDraft(panels) && Object.isFrozen(panels),
    hasDraft: isDraft(panels),
    visitedPanels: new Set(),
  }
  for (const panel of panels) addPanel(index, panel, state)
  // Commands also query live Immer drafts and mutable import fixtures. Rebuilding
  // those avoids stale parent/feed relationships after an in-place mutation.
  if (state.cacheable) {
    cache.set(panels, index)
    if (panels.length === 1) panelSnapshotIndexes.set(panels[0]!, index)
  }
  if (state.hasDraft) draftIndexes.add(index)
  return index
}
