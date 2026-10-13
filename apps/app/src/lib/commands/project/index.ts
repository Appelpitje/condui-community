import { panelEditLayout } from './commands/panelEditLayout'
import { panelRewire } from './commands/panelRewire'
import { ProjectCommandRegistry } from './registry'
import { electricalPlaceSymbol } from './commands/electricalPlaceSymbol'
import { eendraadMoveEndpoints } from './commands/eendraadMoveEndpoints'
import { electricalAssignEndpoints } from './commands/electricalAssignEndpoints'
import { planAssignCircuit, circuitSetCodeAndPosition } from './commands/planAssignCircuit'
import { electricalMoveProtectionOnBus } from './commands/electricalMoveProtectionOnBus'
import { entitiesDelete } from './commands/entitiesDelete'
import { floorRename } from './commands/floorRename'
import { planCopyToFloor } from './commands/planCopyToFloor'
import { planDuplicate } from './commands/planDuplicate'
import { circuitCreateEmpty, planPlaceSymbol } from './commands/planPlaceSymbol'
import { planMovePlacements, planMoveToFloor } from './commands/planPlacements'
import { propertiesEdit } from './commands/propertiesEdit'
import { electricalCreateCircuitAndAssign } from './commands/electricalCreateCircuitAndAssign'

export {
  electricalCreateCircuitAndAssign,
  electricalCreateCircuitAndAssignInputSchema,
  type ElectricalCreateCircuitAndAssignInput,
} from './commands/electricalCreateCircuitAndAssign'

export { panelEditLayout, panelEditLayoutInputSchema, type PanelEditLayoutInput } from './commands/panelEditLayout'
export { panelRewire, panelRewireInputSchema, type PanelRewireInput } from './commands/panelRewire'
export * from './types'
export { ProjectCommandRegistry, type ParsedInvocation } from './registry'
export {
  propertiesEditInputSchema,
  propertiesEdit,
  type PropertiesEditInput,
  type PropertiesEditAction,
  type PropertyEdit,
  type ProtectionPropertyPatch,
  type CircuitPropertyPatch,
  type EndpointPropertyPatch,
  type CircuitWirePropertyPatch,
} from './commands/propertiesEdit'
export { applyCommandBatch } from './transaction'
export { projectRevisionToken } from './revision'
export {
  createHeadlessProjectSession,
  createDefaultCommandEnv,
  type HeadlessProjectSession,
} from './headlessSession'

/** Every project command, by id. UI adapters, scripts and agents all run commands from here. */
export function createProjectCommandRegistry(): ProjectCommandRegistry {
  return new ProjectCommandRegistry()
    .register(floorRename)
    .register(planMovePlacements)
    .register(planMoveToFloor)
    .register(entitiesDelete)
    .register(planDuplicate)
    .register(circuitCreateEmpty)
    .register(planPlaceSymbol)
    .register(planCopyToFloor)
    .register(electricalPlaceSymbol)
    .register(eendraadMoveEndpoints)
    .register(electricalAssignEndpoints)
    .register(planAssignCircuit)
    .register(circuitSetCodeAndPosition)
    .register(electricalMoveProtectionOnBus)
    .register(panelEditLayout)
    .register(panelRewire)
    .register(propertiesEdit)
    .register(electricalCreateCircuitAndAssign)
}

export const projectCommands = createProjectCommandRegistry()
