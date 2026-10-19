import type { ProjectV2, AssetModelV2 } from '@/types/projectV2'
import type { Circuit, Endpoint, Panel } from '@/types/schema'
import { CommandError, type CommandEnv, type EntityRef } from '@/lib/commands/project/types'
import type { RoomPlanGeometryPreview, RoomPlanScanResult } from './roomPlanImport'
import { roomScanCircuitGroup, type RoomScanObservation } from './roomScanCapture'
import { getEditableProjectElectricalPanels, getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { collectCircuits, findMainPanel, findPanelById, walkPanels } from '@/lib/panel/panelTree'
import { addProtectionToProject } from '@/lib/eendraad/protectionMutations'
import { addCircuitToProject } from '@/lib/eendraad/circuitMutations'
import { addEndpointWithPlacementToProject } from '@/lib/eendraad/endpointMutations'
import { addPanelInProject } from '@/lib/projectMutations/storeActions'
import { getDomainTranslator } from '@/lib/i18n/domainI18n'
import { getSymbolById } from '@/lib/symbols'
import { getEndpointTypeFromSymbol } from '@/utils/symbolMapping'
import { PROJECT_DOCUMENTS_STORAGE_LIMIT_BYTES, getProjectDocumentSizeBytes } from '@/lib/documents/projectDocuments'
import { ensurePanelPlacement } from '@/utils/panelPlacement'
import { querySitplanNotes, replaceSitplanNotes } from '@/lib/projectV2/annotations'
import { resolveScanRoomNames } from './roomScanRooms'
import { createDefaultAcCircuitCable } from '@/lib/wires/circuitWireDefaults'

export interface RoomScanEvidenceEntry extends RoomScanObservation {
  target: { type: 'endpoint' | 'panel'; id: string }
  placementId: string
  circuitId?: string
  pos: { x: number; y: number }
  heightCm: number
  roomId?: string
  roomName?: string
  rotationDeg?: number
}

/** Count consumer observations only; panels, supply and empty circuits do not disable capture. */
export function countRoomScanConsumerEndpoints(project: ProjectV2): number {
  return [...walkPanels(getProjectElectricalPanels(project))].reduce((sum, panel) => sum +
    collectCircuits(panel).reduce((total, circuit) => total + circuit.endpoints.filter((endpoint) =>
      endpoint.symbol !== 'panel_distribution'
    ).length, 0), 0)
}

function blankPanel(project: ProjectV2, env: CommandEnv): Panel {
  const t = getDomainTranslator(env.language)
  const panels = getEditableProjectElectricalPanels(project)
  const panel: Panel = {
    id: env.newId(), name: panels.length ? `${t('panels.secondaryPanel', { number: [...walkPanels(panels)].length + 1 })}` : `${t('panels.mainPanel')}`,
    symbol: 'panel_distribution', isMain: true, protections: [], circuits: [], subPanels: [],
  }
  addPanelInProject(project, panel)
  return findPanelById(getEditableProjectElectricalPanels(project), panel.id)!
}

/** A JSON document is one externalized project asset, including its reference crops. */
function documentAsset(input: {
  id: string; kind: 'model' | 'placements'; scanId: string; floorId: string; roomName: string
  relatedDocumentId?: string; payload: unknown; links: Array<{ type: string; id: string }>
}, env: CommandEnv): AssetModelV2 {
  const t = getDomainTranslator(env.language)
  const json = JSON.stringify(input.payload)
  const name = `${input.roomName} — ${t(input.kind === 'model' ? 'nativeRoomScan.modelDocument' : 'nativeRoomScan.placementsDocument')}`
  return {
    id: input.id, kind: 'document', sourceName: `${name}.json`, mimeType: 'application/json',
    dataUrl: `data:application/json,${encodeURIComponent(json)}`,
    sizeBytes: new TextEncoder().encode(json).length,
    document: {
      name, category: 'sourcePlan', includeInExport: false, addedAt: env.now(), links: input.links,
      roomScan: {
        version: 1, kind: input.kind, scanId: input.scanId, floorId: input.floorId,
        roomName: input.roomName, relatedDocumentId: input.relatedDocumentId,
      },
    },
  }
}

/** Ordinary editable entities plus two independent evidence assets, in the import transaction. */
export function importRoomScanPlacements(project: ProjectV2, input: {
  scan: RoomPlanScanResult; geometry: RoomPlanGeometryPreview; floorId: string; roomName: string; roomNames?: Record<string, string>; panelId?: string
}, env: CommandEnv): { created: EntityRef[]; changed: EntityRef[] } {
  const created: EntityRef[] = []
  const changed: EntityRef[] = []
  const t = getDomainTranslator(env.language)
  const names = resolveScanRoomNames(input.geometry.rooms, input.roomNames, (key) => t(key))
  if (!input.roomNames && input.geometry.rooms.length === 1) names[input.geometry.rooms[0]!.id] = input.roomName
  const labels = input.geometry.rooms.map((room) => ({ id: env.newId(), text: names[room.id]!, floorId: input.floorId, pos: room.center, fontSize: input.geometry.symbolSizePx * 0.7 }))
  if (labels.length) {
    replaceSitplanNotes(project, [...querySitplanNotes(project), ...labels])
    created.push(...labels.map((label) => ({ kind: 'note' as const, id: label.id })))
  }
  const scanId = env.newId()
  const modelId = input.scan.model ? env.newId() : undefined
  const evidenceId = input.geometry.placements.length ? env.newId() : undefined
  const existingPanels = getEditableProjectElectricalPanels(project)
  let host = findPanelById(existingPanels, input.panelId) ?? findMainPanel(existingPanels)
  const canReuseBlankPanel: boolean = !!host && countRoomScanConsumerEndpoints(project) === 0 && collectCircuits(host).length === 0
  let reusedBlankPanel = false
  const evidence: RoomScanEvidenceEntry[] = []
  const circuitGroups = new Map<string, { circuit: Circuit; count: number }>()

  for (const observation of input.geometry.placements) {
    const roomName = (observation.roomId && names[observation.roomId]) || input.roomName
    const heightM = Math.max(0, observation.heightCm / 100)
    if (observation.symbolId === 'panel_distribution') {
      const reuse: boolean = canReuseBlankPanel && !reusedBlankPanel
      const panel = reuse ? host! : blankPanel(project, env)
      reusedBlankPanel ||= !!reuse
      host ??= panel
      if (!reuse) created.push({ kind: 'panel', id: panel.id })
      else changed.push({ kind: 'panel', id: panel.id })
      // A panel's ordinary PANEL endpoint supplies its plan symbol. Reposition that occurrence
      // rather than creating a socket-like endpoint or guessing a feeder relationship.
      let endpoint = panel.circuits.flatMap((circuit) => circuit.endpoints).find((candidate) => candidate.panelId === panel.id)
      if (!endpoint) {
        const anchor = ensurePanelPlacement(project, panel)
        if (!anchor) throw new Error('Scanned panel has no target floor')
        const circuit: Circuit = { id: env.newId(), code: 'PANEL', kind: 'other', cable: createDefaultAcCircuitCable({ sectionMm2: 6 }), endpoints: [{ ...anchor.endpoint, placements: [anchor.placement] }] }
        if (!addCircuitToProject(project, panel.id, circuit)) throw new Error('Could not place scanned panel')
        endpoint = panel.circuits.flatMap((entry) => entry.endpoints).find((entry) => entry.id === anchor.endpoint.id)
      }
      if (!endpoint) throw new Error('Scanned panel has no plan symbol')
      const placement = endpoint.placements[0]
      if (!placement) throw new Error('Scanned panel has no placement')
      placement.floorId = input.floorId
      placement.pos = observation.pos
      placement.rotationDeg = observation.rotationDeg
      placement.mountingHeightM = heightM
      evidence.push({ ...observation, roomName, target: { type: 'panel', id: panel.id }, placementId: placement.id })
      continue
    }
    if (!host) {
      host = blankPanel(project, env)
      created.push({ kind: 'panel', id: host.id })
    }
    const symbol = getSymbolById(observation.symbolId)
    const type = symbol && getEndpointTypeFromSymbol(symbol)
    if (!type) throw new Error('Unsupported room scan symbol')
    const group = roomScanCircuitGroup(observation.symbolId)
    // Separate equipment branches; cap provisional socket/lighting groups at eight marks.
    const groupKey = `${observation.roomId ?? 'unassigned'}:${group === 'equipment' ? `${group}:${observation.id}` : group}`
    let current = circuitGroups.get(groupKey)
    if (!current || current.count >= 8) {
      const circuit: Circuit = {
        id: env.newId(), code: '', kind: group === 'equipment' ? 'fixed_appliance' : group === 'sockets' ? 'sockets' : 'lighting',
        cable: createDefaultAcCircuitCable({ sectionMm2: group === 'lighting' ? 1.5 : 2.5 }),
        hideWireLabel: true,
        notes: `${roomName} — ${t(`nativeRoomScan.group.${group}`)} · ${t('nativeRoomScan.toReview')}`,
        scanReview: { scanId, roomName }, endpoints: [], branches: [],
      }
      // Use the same visible MCB defaults as normal situation-plan circuit creation.
      // Scan review remains required; these are editable design defaults, not measurements.
      const protectionId = env.newId()
      addProtectionToProject(project, host.id, { id: protectionId, type: 'MCB', ratingA: group === 'lighting' ? 10 : 16, curve: 'C', polesConfig: '2P', poles: 2, label: '', notes: `${t('nativeRoomScan.toReview')}`, circuits: [] })
      addCircuitToProject(project, host.id, circuit, protectionId)
      created.push({ kind: 'protection', id: protectionId })
      const inserted = collectCircuits(host).find((candidate) => candidate.id === circuit.id)
      if (!inserted) throw new Error('Could not create scan circuit')
      current = { circuit: inserted, count: 0 }
      circuitGroups.set(groupKey, current)
      created.push({ kind: 'circuit', id: circuit.id })
    }
    const endpoint: Endpoint = {
      id: env.newId(), type, label: '', symbol: observation.symbolId, placements: [],
      ...(type === 'socket' ? { socketProps: { socketCount: observation.quantity } } : {}),
    }
    const placementId = env.newId()
    const added = addEndpointWithPlacementToProject(project, current.circuit.id, endpoint, {
      id: placementId, floorId: input.floorId, layer: 'electrical', pos: observation.pos, rotationDeg: observation.rotationDeg, scale: 1, mountingHeightM: heightM,
    }, undefined, { forceNewBranch: true })
    if (!added) throw new Error('Could not place scanned endpoint')
    current.count++
    created.push({ kind: 'endpoint', id: endpoint.id }, { kind: 'placement', id: added })
    evidence.push({ ...observation, roomName, target: { type: 'endpoint', id: endpoint.id }, placementId: added, circuitId: current.circuit.id })
  }

  const documents: AssetModelV2[] = []
  if (modelId && input.scan.model) {
    documents.push(documentAsset({
      id: modelId, kind: 'model', scanId, floorId: input.floorId, roomName: input.roomName,
      relatedDocumentId: evidenceId, links: [],
      payload: { version: 1, units: 'meters', ...input.scan.model },
    }, env))
    created.push({ kind: 'document', id: modelId })
  }
  if (evidenceId) {
    documents.push(documentAsset({
      id: evidenceId, kind: 'placements', scanId, floorId: input.floorId, roomName: input.roomName,
      relatedDocumentId: modelId, links: evidence.map((entry) => entry.target),
      payload: { version: 1, units: 'meters', entries: evidence },
    }, env))
    created.push({ kind: 'document', id: evidenceId })
  }
  const bytes = [...project.assets, ...documents].filter((asset) => asset.kind === 'document').reduce((sum, asset) => sum + getProjectDocumentSizeBytes({ url: asset.dataUrl ?? '', sizeBytes: asset.sizeBytes }), 0)
  if (bytes > PROJECT_DOCUMENTS_STORAGE_LIMIT_BYTES)
    throw new CommandError('check_failed', 'Scan documents exceed the project storage budget', { reason: 'document_budget' })
  project.assets.push(...documents)
  return { created, changed }
}
