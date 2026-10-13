import { z } from 'zod'
import { findPanelById } from '@/lib/panel/panelTree'
import { createEmptyCircuitInProject, placeSymbolOnPlanInProject } from '@/lib/plan/planSymbolDrop'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { getSymbolById } from '@/lib/symbols'
import type { ProjectV2 } from '@/types/projectV2'
import { getEndpointTypeFromSymbol } from '@/utils/symbolMapping'
import { defineProjectCommand, type CommandCheck, type EntityRef } from '../types'

const point = z.object({ x: z.number().finite(), y: z.number().finite() })
const dropKind = z.enum(['lighting', 'sockets', 'fixed_appliance', 'other'])

function checkPanel(project: ProjectV2, panelId: string): CommandCheck {
  return findPanelById(getEditableProjectElectricalPanels(project), panelId)
    ? { ok: true }
    : { ok: false, code: 'panel_not_found', message: 'Panel not found' }
}

/** Adds a new MCB with an empty circuit on a panel, with the plan-drop defaults. */
export const circuitCreateEmpty = defineProjectCommand({
  id: 'circuit.createEmpty',
  version: 1,
  input: z.object({
    panelId: z.string().min(1),
    kind: dropKind,
    protectionLabel: z.string().optional(),
    circuitNotes: z.string().optional(),
  }),
  check: (project, input) => checkPanel(project, input.panelId),
  apply(draft, input, env) {
    const circuitId = createEmptyCircuitInProject(
      draft as ProjectV2,
      input.panelId,
      input.kind,
      { protectionLabel: input.protectionLabel, circuitNotes: input.circuitNotes },
      { activeFloorId: null },
      env.language
    )
    if (!circuitId) throw new Error('The circuit could not be created')
    const ref: EntityRef = { kind: 'circuit', id: circuitId }
    return { created: [ref], changed: [], removed: [], related: [ref] }
  },
})

/**
 * Places a library symbol on the situation plan at a floor position, on an existing circuit or
 * on a new MCB + circuit, through the same drop rules as the one-wire canvas. Selects the new
 * placement. Device symbols (junction box, energy meter, converters) become circuit devices.
 */
export const planPlaceSymbol = defineProjectCommand({
  id: 'plan.placeSymbol',
  version: 1,
  input: z.object({
    symbolId: z.string().min(1),
    floorId: z.string().min(1),
    floorLayer: z.string().min(1).default('electrical'),
    pos: point,
    panelId: z.string().min(1),
    circuit: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('existing'), circuitId: z.string().min(1) }),
      z.object({
        mode: z.literal('new'),
        protectionLabel: z.string().optional(),
        circuitNotes: z.string().optional(),
      }),
    ]),
    /** Plan viewport centre on the active floor, for automatic placements of extra devices. */
    viewportCenter: point.nullable().optional(),
  }),
  check(project, input) {
    const symbol = getSymbolById(input.symbolId)
    if (!symbol || !getEndpointTypeFromSymbol(symbol)) {
      return {
        ok: false,
        code: 'unsupported_symbol',
        message: 'This symbol cannot be placed on the plan',
      }
    }
    if (!selectProjectBuildingFloors(project).some((floor) => floor.id === input.floorId)) {
      return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    }
    return checkPanel(project, input.panelId)
  },
  apply(draft, input, env) {
    const outcome = placeSymbolOnPlanInProject(
      draft as ProjectV2,
      input,
      {
        activeFloorId: input.floorId,
        viewportCenter: input.viewportCenter ?? null,
      },
      env.language
    )
    if (!outcome) throw new Error('The symbol could not be placed')
    const circuit: EntityRef = { kind: 'circuit', id: outcome.circuitId }
    const placement: EntityRef[] = outcome.placementId
      ? [{ kind: 'placement', id: outcome.placementId }]
      : []
    return {
      created: [
        ...(outcome.endpointId ? [{ kind: 'endpoint' as const, id: outcome.endpointId }] : []),
        ...placement,
        ...(outcome.createdCircuit ? [circuit] : []),
      ],
      // Device symbols change the circuit instead of adding an endpoint.
      changed: outcome.endpointId ? [] : [circuit],
      removed: [],
      related: [circuit],
      select: placement,
    }
  },
})
