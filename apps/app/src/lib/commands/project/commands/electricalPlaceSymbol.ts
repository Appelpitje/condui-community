import { z } from 'zod'
import { placeElectricalSymbolInProject } from '@/lib/eendraad/electricalSymbolDrop'
import { findPanelById } from '@/lib/panel/panelTree'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { getSymbolById } from '@/lib/symbols'
import { PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import {
  isModularSocketLibraryId,
  canDropModularSocketOnPanel,
  findPreferredModularSocketCircuit,
} from '@/lib/socket/modularSocket'
import { addCircuitToProject } from '@/lib/eendraad/circuitMutations'
import { getNextAvailableCircuitCode } from '@/utils/project'
import { resolveInitialProtectionBusLabel } from '@/lib/protectionKind'
import {
  createDefaultAcCircuitCable,
  DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
} from '@/lib/wires/circuitWireDefaults'
import { collectCircuits } from '@/lib/panel/panelTree'
import type { ProjectV2 } from '@/types/projectV2'
import { CommandError, defineProjectCommand, type EntityKind, type EntityRef } from '../types'
import { checkElectricalDropTarget, electricalDropTargetSchema } from '../electricalDropTarget'
import { applyPanelDropPlacement, panelDropPlacementSchema } from '../panelDropPlacement'

const point = z.object({ x: z.number().finite(), y: z.number().finite() })

const SELECTION_KINDS = new Set<string>(['endpoint', 'note', 'panel', 'protection', 'trunkDevice'])

/**
 * Drops a library symbol on a one-wire / panel position: protections on a bus or panel, devices
 * on a circuit or supply wire, endpoints on a circuit. Applies the shared target rules, then the
 * drop engine with all of its follow-ups (plan placements, panel grid, sub-panels, earthing).
 */
export const electricalPlaceSymbol = defineProjectCommand({
  id: 'electrical.placeSymbol',
  version: 1,
  input: z.object({
    symbolId: z.string().min(1),
    target: electricalDropTargetSchema,
    panelGrid: panelDropPlacementSchema.optional(),
    dropCanvasPosition: point.optional(),
    sitplan: z
      .object({
        activeFloorId: z.string().min(1).nullable(),
        viewportCenter: point.nullable(),
        activePanelId: z.string().min(1).nullable(),
      })
      .optional(),
  }),
  check(project, input) {
    if (!getSymbolById(input.symbolId)) {
      return { ok: false, code: 'unknown_symbol', message: 'Unknown symbol' }
    }
    const targetCheck = checkElectricalDropTarget(
      project,
      input.target,
      input.sitplan?.activeFloorId
    )
    if (!targetCheck.ok) return targetCheck
    if (
      input.sitplan?.activePanelId &&
      !findPanelById(getEditableProjectElectricalPanels(project), input.sitplan.activePanelId)
    ) {
      return { ok: false, code: 'panel_not_found', message: 'Situation-plan panel not found' }
    }
    if (input.panelGrid) {
      const panel =
        input.target.panelId &&
        findPanelById(getEditableProjectElectricalPanels(project), input.target.panelId)
      const protection = (PROTECTION_SYMBOL_IDS as readonly string[]).includes(input.symbolId)
      const valid =
        input.panelGrid.scope === 'supply'
          ? panel &&
            panel.isMain &&
            input.target.type === 'supplyWire' &&
            (protection || input.symbolId === 'energy_meter')
          : panel &&
            ((protection && input.target.type === 'mainBus') ||
              (input.target.type === 'circuit' &&
                (input.symbolId === 'energy_meter' || isModularSocketLibraryId(input.symbolId))) ||
              (input.target.type === 'mainBus' &&
                isModularSocketLibraryId(input.symbolId) &&
                input.panelGrid.ensureCircuitForProtectionId != null))
      if (!valid)
        return { ok: false, code: 'invalid_panel_drop', message: 'Invalid panel-grid drop target' }
      if (
        input.panelGrid.ensureCircuitForProtectionId &&
        (!panel ||
          input.panelGrid.scope !== 'main' ||
          !isModularSocketLibraryId(input.symbolId) ||
          !canDropModularSocketOnPanel(panel) ||
          !panel.protections.some(
            (protection) => protection.id === input.panelGrid!.ensureCircuitForProtectionId
          ))
      )
        return {
          ok: false,
          code: 'protection_not_found',
          message: 'Modular socket protection not found',
        }
      if (
        input.panelGrid.parentCircuitId &&
        (!protection ||
          input.panelGrid.scope !== 'main' ||
          !panel ||
          ![
            ...panel.circuits,
            ...panel.protections.flatMap((protection) => protection.circuits ?? []),
          ].some((circuit) => circuit.id === input.panelGrid!.parentCircuitId))
      ) {
        return {
          ok: false,
          code: 'parent_circuit_not_found',
          message: 'Parent circuit does not belong to the target panel',
        }
      }
    }
    return { ok: true }
  },
  apply(draft, input, env) {
    const project = draft as ProjectV2
    let target = input.target
    const additionalCreated: EntityRef[] = []
    if (input.panelGrid?.ensureCircuitForProtectionId) {
      const panel = findPanelById(
        getEditableProjectElectricalPanels(project),
        input.target.panelId!
      )!
      const protection = panel.protections.find(
        (protection) => protection.id === input.panelGrid!.ensureCircuitForProtectionId
      )!
      let circuit = findPreferredModularSocketCircuit(panel, protection)
      if (!circuit) {
        const id = env.newId()
        circuit = {
          id,
          code: resolveInitialProtectionBusLabel(
            protection.type,
            getNextAvailableCircuitCode(project, panel.id)
          ),
          kind: 'other',
          cable: createDefaultAcCircuitCable(),
          endpoints: [],
          ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
        }
        if (!addCircuitToProject(project, panel.id, circuit, protection.id))
          throw new CommandError('check_failed', 'Unable to create modular socket circuit', {
            reason: 'circuit_not_created',
          })
        additionalCreated.push({ kind: 'circuit', id })
      }
      target = { type: 'circuit', panelId: panel.id, circuitId: circuit.id }
    }
    const outcome = placeElectricalSymbolInProject(
      project,
      {
        symbolId: input.symbolId,
        target,
        dropCanvasPosition: input.dropCanvasPosition,
      },
      input.sitplan ?? { activeFloorId: null, viewportCenter: null, activePanelId: null },
      env.language
    )
    if (outcome.status === 'rejected') {
      throw new CommandError('check_failed', outcome.message, { reason: 'drop_rejected' })
    }
    if (outcome.status === 'blocked') {
      throw new CommandError('check_failed', 'This symbol cannot be placed here', {
        reason: outcome.reason,
      })
    }
    // The drop engine reads supply lists that fill in defaults on the draft; a drop that placed
    // nothing must stay a no-op instead of committing those defaults as an undo step.
    if (!outcome.mutated) {
      throw new CommandError('check_failed', 'Nothing was placed', { reason: 'nothing_placed' })
    }
    const created: EntityRef[] = [
      ...additionalCreated,
      ...outcome.created.map((entry) => ({
        kind: entry.kind as EntityKind,
        id: entry.id,
      })),
    ]
    const { selection } = outcome
    const changed = input.panelGrid
      ? applyPanelDropPlacement(draft as ProjectV2, input.target.panelId!, input.panelGrid, created)
      : []
    const relatedCircuitIds = new Set<string>()
    if (target.circuitId) relatedCircuitIds.add(target.circuitId)
    const createdEndpointIds = new Set(
      created.filter((ref) => ref.kind === 'endpoint').map((ref) => ref.id)
    )
    for (const panel of getEditableProjectElectricalPanels(draft)) {
      for (const circuit of collectCircuits(panel)) {
        if (circuit.endpoints.some((endpoint) => createdEndpointIds.has(endpoint.id)))
          relatedCircuitIds.add(circuit.id)
      }
    }
    return {
      created,
      changed,
      removed: [],
      related: [...relatedCircuitIds].map((id) => ({ kind: 'circuit' as const, id })),
      select:
        selection && selection.type && SELECTION_KINDS.has(selection.type)
          ? selection.ids.map((id) => ({ kind: selection.type as EntityKind, id }))
          : [],
    }
  },
})
