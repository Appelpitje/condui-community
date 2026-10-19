import { z } from 'zod'
import type { ProjectV2 } from '@/types/projectV2'
import { buildElectricalStructureSnapshot } from '@/lib/electricalStructure/builder'
import type { ElectricalStructureNode, StructureSourceReference } from '@/lib/electricalStructure/types'
import { stableHash } from '@/utils/stableHash'
import { CommandError, type EntityRef } from './types'

const id = z.string().min(1).max(200)
const offset = z.number().int().min(0).max(1000000).default(0)
export const projectGraphQuerySchema = z.strictObject({
  panelId: id.optional(),
  circuitId: id.optional(),
  includePlacements: z.boolean().default(false),
  nodeOffset: offset,
  linkOffset: offset,
  diagnosticOffset: offset,
  limit: z.number().int().min(1).max(100).default(40),
  expectedSnapshotToken: id.optional(),
})
export type ProjectGraphQuery = z.input<typeof projectGraphQuerySchema>

// Structural keys identify graph vertices. Only these native refs are accepted by
// ordinary project entity reads/commands; synthetic vertices deliberately have no ref.
const refKinds: Partial<Record<string, EntityRef['kind']>> = {
  installation: 'installation', panel: 'panel', circuit: 'circuit',
  protection: 'protection', endpoint: 'endpoint', 'trunk-device': 'trunkDevice',
  placement: 'placement', 'auxiliary-enclosure': 'auxiliaryEnclosure',
}
function nativeRef(source: StructureSourceReference): EntityRef | undefined {
  const kind = refKinds[source.entityKind]
  return kind && source.entityId ? { kind, id: source.entityId } : undefined
}
function summaryOf(node: ElectricalStructureNode): Record<string, unknown> {
  const value = node.sourceSummary
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}
function compactNode(node: ElectricalStructureNode) {
  const summary = summaryOf(node)
  const ref = node.kind === 'missing-target' || node.knowledge === 'missing'
    ? undefined : nativeRef(node.source)
  return {
    key: node.id,
    kind: node.kind,
    ...(ref ? { ref } : {}),
    ...(node.label ? { label: node.label.slice(0, 160) } : {}),
    ...(typeof summary.symbol === 'string' ? { symbol: summary.symbol.slice(0, 100) } : {}),
    ...(typeof summary.type === 'string' ? { type: summary.type.slice(0, 100) } : {}),
    ...(node.panelId ? { panelId: node.panelId } : {}),
    ...(node.circuitId ? { circuitId: node.circuitId } : {}),
    ...(node.enclosure ? { enclosure: node.enclosure } : {}),
    ...(node.kind === 'occurrence' && typeof summary.floorId === 'string'
      ? { floorId: summary.floorId } : {}),
    knowledge: node.knowledge,
    ...(node.diagnosticCode ? { diagnosticCode: node.diagnosticCode } : {}),
  }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

/** A read-only allowlist over the shared electrical graph, never a replacement project. */
export function inspectProjectGraph(project: ProjectV2, input: ProjectGraphQuery = {}) {
  const query = projectGraphQuerySchema.parse(input)
  const snapshot = buildElectricalStructureSnapshot(project)
  const allNodes = snapshot.nodes.filter((node) => query.includePlacements || node.kind !== 'occurrence')
    .map(compactNode).sort((a, b) => compare(a.key, b.key))
  const byKey = new Map(allNodes.map((node) => [node.key, node]))
  const allLinks = snapshot.relationships
    .filter((link) => byKey.has(link.from) && byKey.has(link.to))
    .map((link) => ({
      kind: link.kind, from: link.from, to: link.to, knowledge: link.knowledge,
      ...(link.source.entityKind === 'branch' && link.source.entityId
        ? { branchId: link.source.entityId } : {}),
      ...(typeof link.properties?.outputIndex === 'number'
        ? { outputIndex: link.properties.outputIndex } : {}),
      ...(typeof link.properties?.outputGroup === 'string'
        ? { outputGroup: link.properties.outputGroup.slice(0, 100) } : {}),
      ...(typeof link.properties?.channel === 'string'
        ? { channel: link.properties.channel.slice(0, 100) } : {}),
      ...(link.diagnosticCode ? { diagnosticCode: link.diagnosticCode } : {}),
    }))
    .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)))
  const allDiagnostics = snapshot.diagnostics.map((diagnostic) => ({
    code: diagnostic.code, severity: diagnostic.severity,
    message: diagnostic.message.slice(0, 400),
    ...(nativeRef(diagnostic.source) ? { ref: nativeRef(diagnostic.source) } : {}),
    nodeKeys: (diagnostic.relatedNodeIds ?? []).filter((key) => byKey.has(key)),
  }))
  // Content based, so independent CLI calls can safely paginate an unchanged archive.
  const snapshotToken = `graph-v1-${stableHash(JSON.stringify([allNodes, allLinks, allDiagnostics]))}`
  if (query.expectedSnapshotToken && query.expectedSnapshotToken !== snapshotToken)
    throw new CommandError('stale_revision', 'The graph changed. Restart the read with a fresh snapshot token.')
  if (query.panelId && !allNodes.some((node) => node.kind === 'panel' && node.ref?.id === query.panelId))
    throw new CommandError('check_failed', 'Panel not found', { reason: 'panel_not_found' })
  const circuit = query.circuitId
    ? allNodes.find((node) => node.kind === 'circuit' && node.ref?.id === query.circuitId) : undefined
  if (query.circuitId && !circuit)
    throw new CommandError('check_failed', 'Circuit not found', { reason: 'circuit_not_found' })
  if (circuit && query.panelId && circuit.panelId !== query.panelId)
    throw new CommandError('check_failed', 'Circuit does not belong to this panel', { reason: 'wrong_panel' })
  const nodes = allNodes.filter((node) =>
    (!query.panelId || node.panelId === query.panelId || (node.kind === 'panel' && node.ref?.id === query.panelId)) &&
    (!query.circuitId || node.circuitId === query.circuitId))
  const scopeKeys = new Set(nodes.map((node) => node.key))
  // Include cross-scope connections, but do not recursively expand the entire project.
  const links = allLinks.filter((link) => scopeKeys.has(link.from) || scopeKeys.has(link.to))
  const contextKeys = new Set([...scopeKeys, ...links.flatMap((link) => [link.from, link.to])])
  const scoped = !!(query.panelId || query.circuitId)
  const scopeRefs = new Set(nodes.flatMap((node) => node.ref ? [`${node.ref.kind}:${node.ref.id}`] : []))
  const diagnostics = allDiagnostics.filter((diagnostic) => !scoped ||
    diagnostic.nodeKeys.some((key) => contextKeys.has(key)) ||
    (diagnostic.ref && scopeRefs.has(`${diagnostic.ref.kind}:${diagnostic.ref.id}`)) ||
    (!diagnostic.ref && diagnostic.nodeKeys.length === 0))
  const nodePage = nodes.slice(query.nodeOffset, query.nodeOffset + query.limit)
  const linkPage = links.slice(query.linkOffset, query.linkOffset + query.limit)
  const pageKeys = new Set(nodePage.map((node) => node.key))
  const boundaryKeys = new Set(linkPage.flatMap((link) => [link.from, link.to]).filter((key) => !pageKeys.has(key)))
  const boundaryNodes = [...boundaryKeys].sort(compare).map((key) => byKey.get(key)!)
  const page = (total: number, start: number) => ({
    total, offset: start, nextOffset: start + query.limit < total ? start + query.limit : null,
  })
  const pages = {
    nodes: page(nodes.length, query.nodeOffset),
    links: page(links.length, query.linkOffset),
    diagnostics: page(diagnostics.length, query.diagnosticOffset),
  }
  return {
    version: 1 as const, projectId: project.project.id, snapshotToken,
    scope: { ...(query.panelId ? { panelId: query.panelId } : {}), ...(query.circuitId ? { circuitId: query.circuitId } : {}), includePlacements: query.includePlacements },
    validation: 'not-run' as const,
    nodes: nodePage, links: linkPage, boundaryNodes,
    diagnostics: diagnostics.slice(query.diagnosticOffset, query.diagnosticOffset + query.limit)
      .map((diagnostic) => ({
        ...diagnostic, nodeKeys: diagnostic.nodeKeys.slice(0, 100),
        ...(diagnostic.nodeKeys.length > 100 ? { relatedNodesTruncated: true } : {}),
      })),
    pages, truncated: Object.values(pages).some((entry) => entry.nextOffset !== null),
  }
}
