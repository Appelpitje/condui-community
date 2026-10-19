import type { Circuit, Endpoint } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { SitplanPlacementTarget } from '@/lib/eendraad/duplicateSitplanHelpers'
import { createDraftDropBehaviorCallbacks } from '@/lib/eendraad/draftDropBehaviorCallbacks'
import { executeDropBehavior } from '@/lib/eendraad/dropBehaviors'
import { addEndpointToProject } from '@/lib/eendraad/endpointMutations'
import { ensureSitplanPlacementsAt } from '@/lib/eendraad/duplicateSitplanHelpers'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { walkPanels } from '@/lib/panel/panelTree'
import { findEndpointById, findCircuitById, normalizeDomoticaCircuit } from '@/lib/eendraad/projectElectricalDomain'
import { circuitContainsJunctionPanelIdentity, getJunctionIdentity } from '@/lib/junctionIdentity'
import { getSymbolById } from '@/lib/symbols'
import { getDomainTranslator } from '@/lib/i18n/domainI18n'
import { CommandError } from '@/lib/commands/project/types'
import { clearDuplicatedControlChannel } from '@/lib/controlLink/duplicateAddress'
import { cloneDomoticaEndpointGroup } from '@/lib/eendraad/duplicateDomoticaEndpointGroup'

export type DuplicateEndpointDropResult = {
  endpointIds: string[]
  circuitIds: string[]
  createdCircuitIds: string[]
}

function findEndpoint(project: ProjectV2, id: string) {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findEndpointById(panel, id)
    if (found) return found
  }
  return undefined
}

function findCircuit(project: ProjectV2, id: string): Circuit | undefined {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findCircuitById(panel, id)
    if (found) return found.circuit
  }
  return undefined
}

function addDomoticaGroupToCircuit(
  project: ProjectV2,
  circuitId: string,
  parent: Endpoint,
  children: Endpoint[],
  insertAfter: string | null | undefined,
  newId: () => string,
): string[] {
  // Adding the parent alone triggers normalizeDomoticaCircuit, which correctly
  // blanks references to children that do not exist yet. Restore the cloned
  // slot list only after every child has been inserted, then normalize once.
  const intendedProps = parent.domoticaProps ? JSON.parse(JSON.stringify(parent.domoticaProps)) as Endpoint['domoticaProps'] : undefined
  if (!addEndpointToProject(project, circuitId, parent, insertAfter, undefined, newId)) {
    throw new CommandError('check_failed', 'Domotica module could not be duplicated', { reason: 'endpoint_not_added' })
  }
  let after = parent.id
  for (const child of children) {
    if (!addEndpointToProject(project, circuitId, child, after, undefined, newId)) {
      throw new CommandError('check_failed', 'Domotica output could not be duplicated', { reason: 'endpoint_not_added' })
    }
    after = child.id
  }
  if (intendedProps) parent.domoticaProps = intendedProps
  const circuit = findCircuit(project, circuitId)
  if (circuit) normalizeDomoticaCircuit(circuit)
  return [parent.id, ...children.map((child) => child.id)]
}

/** Duplicate an endpoint through the same drop behavior and draft mutation helpers as symbol placement. */
export function duplicateEndpointAtDropTargetInProject(
  project: ProjectV2,
  sourceEndpointId: string,
  target: DropTarget,
  sitplanTarget: SitplanPlacementTarget,
  newId: () => string,
  language: string,
): DuplicateEndpointDropResult {
  const beforeCircuitIds = new Set([...walkPanels(getEditableProjectElectricalPanels(project))].flatMap((panel) => [
    ...(panel.circuits ?? []).map((circuit) => circuit.id),
    ...(panel.protections ?? []).flatMap((protection) => (protection.circuits ?? []).map((circuit) => circuit.id)),
  ]))
  const sourceInfo = findEndpoint(project, sourceEndpointId)
  const source = sourceInfo?.endpoint
  if (!sourceInfo || !source?.symbol) throw new CommandError('check_failed', 'Endpoint cannot be duplicated', { reason: 'invalid_source' })
  const symbol = getSymbolById(source.symbol)
  if (!symbol) throw new CommandError('check_failed', 'Endpoint symbol is unavailable', { reason: 'unknown_symbol' })

  const targetCircuitId = target.circuitId ?? (target.protectionId
    ? walkPanels(getEditableProjectElectricalPanels(project))
        .flatMap((panel) => panel.protections)
        .find((protection) => protection.id === target.protectionId)?.circuits?.[0]?.id
    : undefined)
  const targetCircuit = targetCircuitId ? findCircuit(project, targetCircuitId) : undefined

  if (source.symbol === 'junction_panel') {
    if (
      (targetCircuitId && sourceInfo.circuit.id === targetCircuitId) ||
      (targetCircuit && circuitContainsJunctionPanelIdentity(targetCircuit, getJunctionIdentity(source)))
    ) throw new CommandError('check_failed', 'This junction panel cannot be duplicated there', { reason: 'duplicate_junction_panel' })
  }

  // A Domotica parent and its outputs form one diagram module. Preserve this when
  // the drop resolves to an existing circuit instead of copying an empty parent.
  if (source.symbol === 'domotica' && !source.domoticaChildProps && targetCircuit) {
    const group = cloneDomoticaEndpointGroup(source, sourceInfo.circuit, newId)
    const added = addDomoticaGroupToCircuit(project, targetCircuit.id, group.parent, group.children, target.endpointId ?? target.insertAfterEndpointId, newId)
    return {
      endpointIds: added,
      circuitIds: [targetCircuit.id],
      createdCircuitIds: [],
    }
  }

  const createdEndpointIds: string[] = []
  const rejected: string[] = []
  let behaviorTarget = target
  const callbacks = createDraftDropBehaviorCallbacks(project, sitplanTarget, {
    newId,
    addEndpoint: (circuitId, generated, insertAfter, branchOpts) => {
      const freshSource = findEndpoint(project, sourceEndpointId)?.endpoint ?? source
      if (source.symbol === 'domotica' && !source.domoticaChildProps && !targetCircuit) {
        const group = cloneDomoticaEndpointGroup(freshSource, sourceInfo.circuit, newId)
        createdEndpointIds.push(...addDomoticaGroupToCircuit(project, circuitId, group.parent, group.children, insertAfter, newId))
        return
      }
      const cloned: Endpoint = {
        ...clearDuplicatedControlChannel(JSON.parse(JSON.stringify(freshSource)) as Endpoint),
        ...generated,
        placements: [],
        domoticaChildProps: generated.domoticaChildProps,
        converterDcConnection: generated.converterDcConnection,
        id: generated.id,
      }
      if (freshSource.symbol === 'junction_panel') {
        cloned.junctionIdentity = freshSource.junctionIdentity
        cloned.junctionAssetId = freshSource.junctionAssetId
      }
      if (!cloned.domoticaChildProps) delete (cloned as { label?: string }).label
      const inserted = addEndpointToProject(project, circuitId, cloned, insertAfter, branchOpts, newId)
      if (inserted) createdEndpointIds.push(cloned.id)
    },
    onDropRejected: (message) => rejected.push(message),
  })

  // An Alt-drop on a main-bus slot creates the usual empty protected circuit,
  // then inserts the cloned endpoint (and any owned Domotica outputs) into it.
  if (target.type === 'mainBus') {
    const panelId = target.panelId
    const mcb = getSymbolById('mcb')
    if (!panelId || !mcb) throw new CommandError('check_failed', 'A main-bus destination is required', { reason: 'panel_not_found' })
    executeDropBehavior(mcb, target, project, getDomainTranslator(language), callbacks, false)
    const createdCircuit = [...walkPanels(getEditableProjectElectricalPanels(project))]
      .flatMap((panel) => [
        ...(panel.circuits ?? []),
        ...(panel.protections ?? []).flatMap((protection) => protection.circuits ?? []),
      ])
      .find((circuit) => !beforeCircuitIds.has(circuit.id) && circuit.endpoints.length === 0)
    if (!createdCircuit) throw new CommandError('check_failed', 'A destination circuit could not be created', { reason: 'circuit_not_created' })
    behaviorTarget = { type: 'circuit', panelId, circuitId: createdCircuit.id }
  }

  executeDropBehavior(symbol, behaviorTarget, project, getDomainTranslator(language), callbacks, false)
  if (rejected.length) throw new CommandError('check_failed', rejected[0]!, { reason: 'drop_rejected' })
  if (!createdEndpointIds.length) throw new CommandError('check_failed', 'Endpoint was not duplicated', { reason: 'nothing_duplicated' })

  ensureSitplanPlacementsAt(
    project,
    createdEndpointIds,
    (id) => findEndpoint(project, id)?.endpoint,
    (id, placement) => {
      const endpoint = findEndpoint(project, id)?.endpoint
      if (endpoint) endpoint.placements.push(placement)
    },
    sitplanTarget,
    newId,
  )
  const circuitIds = [...new Set(createdEndpointIds.map((id) => findEndpoint(project, id)?.circuit.id).filter((id): id is string => !!id))]
  const createdCircuitIds = [...walkPanels(getEditableProjectElectricalPanels(project))]
    .flatMap((panel) => [
      ...(panel.circuits ?? []).map((circuit) => circuit.id),
      ...(panel.protections ?? []).flatMap((protection) => (protection.circuits ?? []).map((circuit) => circuit.id)),
    ])
    .filter((id) => !beforeCircuitIds.has(id))
  return { endpointIds: createdEndpointIds, circuitIds, createdCircuitIds }
}
