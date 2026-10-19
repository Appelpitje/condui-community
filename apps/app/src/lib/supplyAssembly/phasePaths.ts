import type {
  DerivedHandoffPhaseSupplyPath,
  DerivedPhaseSupplyPath,
  LiveAcPhase,
  OffGridSupplyAssembly,
  SupplyConnection,
  SupplyNode,
  SupplyPort,
  SupplyLoadHandoff,
} from './types'

type SupplyMode = 'grid' | 'backup'

interface TraversalEdge {
  target: string
  connectionId?: string
}

interface SupplyRoute {
  connectionIds: string[]
  nodeIds: Set<string>
}

const LIVE_PHASES: LiveAcPhase[] = ['L1', 'L2', 'L3']

const GRID_PATH_ROLES = new Set<SupplyConnection['pathRole']>([
  'grid-ac',
  'grid-only-bypass-ac',
  'load-ac',
])
const BACKUP_PATH_ROLES = new Set<SupplyConnection['pathRole']>(['inverter-backup-ac', 'load-ac'])

function portKey(nodeId: string, portId: string): string {
  return `${nodeId}:${portId}`
}

function addEdge(
  adjacency: Map<string, TraversalEdge[]>,
  source: string,
  edge: TraversalEdge
): void {
  const edges = adjacency.get(source) ?? []
  edges.push(edge)
  adjacency.set(source, edges)
}

function addBidirectionalEdge(
  adjacency: Map<string, TraversalEdge[]>,
  first: string,
  second: string,
  connectionId?: string
): void {
  addEdge(adjacency, first, { target: second, ...(connectionId ? { connectionId } : {}) })
  addEdge(adjacency, second, { target: first, ...(connectionId ? { connectionId } : {}) })
}

function internallyConnectedPorts(
  node: SupplyNode,
  mode: SupplyMode,
  phase: LiveAcPhase
): SupplyPort[][] {
  const acPorts = node.ports.filter(
    (port) => port.domain === 'AC' && port.conductors.includes(phase)
  )
  if (node.kind === 'ac-distribution' || node.kind === 'protection') return [acPorts]
  if (node.kind === 'inverter-unit' && node.properties.acConnection === 'separate' && mode === 'grid') {
    return [acPorts.filter((port) => port.role === 'inverter-grid-ac' || port.role === 'inverter-backup-ac')]
  }
  if (node.kind !== 'changeover-switch') return []

  const sourceRole = mode === 'grid' ? 'source-grid-ac' : 'source-backup-ac'
  return [acPorts.filter((port) => port.role === sourceRole || port.role === 'load-ac')]
}

function buildPhaseAdjacency(
  assembly: OffGridSupplyAssembly,
  phase: LiveAcPhase,
  mode: SupplyMode
): Map<string, TraversalEdge[]> {
  const adjacency = new Map<string, TraversalEdge[]>()
  const allowedRoles = mode === 'grid' ? GRID_PATH_ROLES : BACKUP_PATH_ROLES
  const internalTransfer = assembly.nodes.some((node) => node.kind === 'inverter-unit' && node.properties.acConnection === 'separate')

  for (const connection of assembly.connections) {
    // Grid power travels the converter's grid-input leg too: a changeover grid input
    // may be tapped from it. The leg dead-ends at the converter unless it transfers
    // internally, so this never creates a path through the converter itself.
    if (
      connection.domain !== 'AC' ||
      !connection.conductors.includes(phase) ||
      !(allowedRoles.has(connection.pathRole) ||
        (mode === 'grid' && connection.pathRole === 'inverter-grid-ac') ||
        (mode === 'grid' && internalTransfer && connection.pathRole === 'inverter-backup-ac'))
    ) {
      continue
    }
    const [first, second] = connection.endpoints
    addBidirectionalEdge(
      adjacency,
      portKey(first.nodeId, first.portId),
      portKey(second.nodeId, second.portId),
      connection.id
    )
  }

  for (const node of assembly.nodes) {
    for (const group of internallyConnectedPorts(node, mode, phase)) {
      for (let firstIndex = 0; firstIndex < group.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < group.length; secondIndex += 1) {
          addBidirectionalEdge(
            adjacency,
            portKey(node.id, group[firstIndex]!.id),
            portKey(node.id, group[secondIndex]!.id)
          )
        }
      }
    }
  }

  return adjacency
}

function findRoute(
  assembly: OffGridSupplyAssembly,
  phase: LiveAcPhase,
  mode: SupplyMode,
  targetNodeIds: ReadonlySet<string> = new Set(
    assembly.loadHandoffs.map((handoff) => handoff.handoffNodeId)
  )
): SupplyRoute | undefined {
  const adjacency = buildPhaseAdjacency(assembly, phase, mode)
  const sources = assembly.nodes.flatMap((node) => {
    const isSource =
      mode === 'grid' ? node.kind === 'utility-source' : node.kind === 'inverter-unit'
    if (!isSource) return []
    return node.ports
      .filter(
        (port) =>
          port.domain === 'AC' &&
          port.conductors.includes(phase) &&
          (mode === 'grid' || port.role === 'inverter-backup-ac')
      )
      .map((port) => ({ key: portKey(node.id, port.id), nodeId: node.id }))
  })
  const targets = new Set(
    assembly.nodes.flatMap((node) => {
      if (!targetNodeIds.has(node.id)) return []
      return node.ports
        .filter((port) => port.domain === 'AC' && port.conductors.includes(phase))
        .map((port) => portKey(node.id, port.id))
    })
  )

  const queue = sources.map((source) => ({
    key: source.key,
    connectionIds: [] as string[],
    nodeIds: new Set([source.nodeId]),
  }))
  const visited = new Set(sources.map((source) => source.key))

  while (queue.length > 0) {
    const current = queue.shift()!
    if (targets.has(current.key)) {
      return { connectionIds: current.connectionIds, nodeIds: current.nodeIds }
    }
    for (const edge of adjacency.get(current.key) ?? []) {
      if (visited.has(edge.target)) continue
      visited.add(edge.target)
      const targetNodeId = edge.target.slice(0, edge.target.lastIndexOf(':'))
      queue.push({
        key: edge.target,
        connectionIds: edge.connectionId
          ? [...current.connectionIds, edge.connectionId]
          : current.connectionIds,
        nodeIds: new Set([...current.nodeIds, targetNodeId]),
      })
    }
  }
  return undefined
}

function sourceHasPhase(
  assembly: OffGridSupplyAssembly,
  phase: LiveAcPhase,
  mode: SupplyMode
): boolean {
  return assembly.nodes.some((node) => {
    const isSource =
      mode === 'grid' ? node.kind === 'utility-source' : node.kind === 'inverter-unit'
    if (!isSource) return false
    return node.ports.some(
      (port) =>
        port.domain === 'AC' &&
        port.conductors.includes(phase) &&
        (mode === 'grid' || port.role === 'inverter-backup-ac')
    )
  })
}

function derivePathsToHandoff(
  assembly: OffGridSupplyAssembly,
  handoff: SupplyLoadHandoff | undefined,
  presentPhases: readonly LiveAcPhase[]
): DerivedPhaseSupplyPath[] {
  const targetNodeIds = handoff ? new Set([handoff.handoffNodeId]) : undefined
  const handoffConductors = handoff ? new Set(handoff.conductors) : undefined
  const present = new Set(presentPhases)
  return LIVE_PHASES.map((phase): DerivedPhaseSupplyPath => {
    if (!present.has(phase) || (handoffConductors && !handoffConductors.has(phase))) {
      return { phase, gridConnectionIds: [], backupConnectionIds: [], state: 'not-present' }
    }

    const gridRoute = findRoute(assembly, phase, 'grid', targetNodeIds)
    const backupRoute = findRoute(assembly, phase, 'backup', targetNodeIds)
    const hasGridSource = sourceHasPhase(assembly, phase, 'grid')
    const hasBackupSource = sourceHasPhase(assembly, phase, 'backup')
    const gridChangeover = nodeIdOfKind(assembly, gridRoute, 'changeover-switch')
    const backupChangeover = nodeIdOfKind(assembly, backupRoute, 'changeover-switch')
    const inverterUnitNodeId = nodeIdOfKind(assembly, backupRoute, 'inverter-unit')
    const internalTransfer = Boolean(inverterUnitNodeId && gridRoute?.nodeIds.has(inverterUnitNodeId) &&
      assembly.nodes.some((node) => node.id === inverterUnitNodeId && node.kind === 'inverter-unit' && node.properties.acConnection === 'separate'))
    const isolatedInternalTransfer = !gridRoute && Boolean(backupRoute && inverterUnitNodeId &&
      assembly.nodes.some((node) => node.id === inverterUnitNodeId && node.kind === 'inverter-unit' &&
        node.properties.acConnection === 'separate' && node.properties.gridInputConnected === false))
    const isCoordinatedBackup =
      Boolean(gridRoute && backupRoute && inverterUnitNodeId) &&
      (internalTransfer || (Boolean(gridChangeover) && gridChangeover === backupChangeover))
    const isGridOnlyThroughChangeover = Boolean(
      gridRoute && !backupRoute && gridChangeover && !hasBackupSource
    )
    const isBackupOnlyThroughChangeover = Boolean(
      !gridRoute && backupRoute && backupChangeover && inverterUnitNodeId && !hasGridSource
    ) || isolatedInternalTransfer

    return {
      phase,
      gridConnectionIds: gridRoute?.connectionIds ?? [],
      backupConnectionIds: backupRoute?.connectionIds ?? [],
      ...((isCoordinatedBackup || isGridOnlyThroughChangeover) && gridChangeover
        ? { changeoverNodeId: gridChangeover }
        : isBackupOnlyThroughChangeover && backupChangeover
          ? { changeoverNodeId: backupChangeover }
          : {}),
      ...((isCoordinatedBackup || isBackupOnlyThroughChangeover) && inverterUnitNodeId
        ? { inverterUnitNodeId }
        : {}),
      state: isCoordinatedBackup
        ? 'backup-switchable'
        : isGridOnlyThroughChangeover
          ? 'grid-only-through-changeover'
          : isBackupOnlyThroughChangeover
            ? 'backup-only-through-changeover'
            : gridRoute && !backupRoute && !gridChangeover
              ? 'grid-only'
              : 'invalid',
    }
  })
}

function nodeIdOfKind(
  assembly: OffGridSupplyAssembly,
  route: SupplyRoute | undefined,
  kind: SupplyNode['kind']
): string | undefined {
  return assembly.nodes.find((node) => node.kind === kind && route?.nodeIds.has(node.id))?.id
}

/** Derive live-phase supply semantics from graph connectivity; never persist this result. */
export function derivePhaseSupplyPaths(
  assembly: OffGridSupplyAssembly,
  presentPhases: readonly LiveAcPhase[]
): DerivedPhaseSupplyPath[] {
  return derivePathsToHandoff(assembly, undefined, presentPhases)
}

/**
 * Resolve every destination independently. This is the authoritative derivation
 * for split-bus panels; the legacy helper above intentionally keeps its aggregate
 * behavior for the existing single-handoff renderer.
 */
export function deriveHandoffPhaseSupplyPaths(
  assembly: OffGridSupplyAssembly,
  presentPhases: readonly LiveAcPhase[]
): DerivedHandoffPhaseSupplyPath[] {
  return assembly.loadHandoffs.flatMap((handoff) =>
    derivePathsToHandoff(assembly, handoff, presentPhases).map((path) => ({
      ...path,
      handoffId: handoff.id,
      target: handoff.target,
    }))
  )
}
