import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { createUiDropBehaviorHooks } from '@/handlers/eendraad/uiDropBehaviorHooks'
import { generateId } from '@/utils'
import { getEndpointTypeFromSymbol } from '@/utils'
import type { SymbolMetadata } from '@/lib/symbols'
import type { Point, Selection } from '@/types/ui'
import type { Placement, Circuit, Endpoint, Floor, Panel } from '@/types/schema'
import { useProjectStore } from '@/stores/projectStore'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import { trackSymbolPlace } from '@/lib/analytics/editorEventAnalytics'
import { collectCircuits } from '@/utils/eendraad/panelHelpers'
import type { PlanDropCircuitChoice, PlanDropKind } from '@/lib/plan/planDropPicker'
import { logger } from '@/lib/logger'
import { endpointTypeToPlanDropKind, planDropKindToCircuitKind } from '@/lib/plan/planDropPicker'
import {
  executeDropBehavior,
  type DropBehaviorCallbacks,
  type DropBehaviorProject,
} from '@/lib/eendraad/dropBehaviors'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'

export interface CommitPlanSymbolDropParams {
  symbol: SymbolMetadata
  position: Point
  floorId: string
  floorLayer: string
  panelId: string
  circuitChoice: PlanDropCircuitChoice
  setSelection: (selection: Selection) => void
}

export type CreateEmptyCircuitOnPanelOptions = {
  /** Legacy MCB label; leave empty so circuit code sync sets the protection label after first endpoint. */
  protectionLabel?: string
  /** Stored on `Circuit.notes` (optional description). */
  circuitNotes?: string
}

type PlanDropProjectInput = {
  disciplines?: ProjectWithOptionalV2Electrical['disciplines']
}

function findCircuitInPanelTree(panels: readonly Panel[], circuitId: string): Circuit | null {
  for (const panel of panels) {
    for (const circuit of collectCircuits(panel)) {
      if (circuit.id === circuitId) return circuit
    }
    const nested = findCircuitInPanelTree(panel.subPanels ?? [], circuitId)
    if (nested) return nested
  }
  return null
}

function getCircuitForPlanDrop(circuitId: string): Circuit | null {
  const store = useProjectStore.getState()
  return (
    store.getCircuitById(circuitId) ??
    (store.currentProject
      ? findCircuitInPanelTree(store.currentProject.disciplines.electrical?.panels ?? [], circuitId)
      : null)
  )
}

function createStoreDropBehaviorCallbacks(
  overrides: Partial<DropBehaviorCallbacks> = {}
): DropBehaviorCallbacks {
  const store = useProjectStore.getState()
  return {
    ...createUiDropBehaviorHooks(),
    addPanel: store.addPanel,
    addProtection: store.addProtection,
    addCircuit: store.addCircuit,
    addCircuitToProtection: store.addCircuitToProtection,
    addEndpoint: store.addEndpoint,
    addPlacement: store.addPlacement,
    updateEndpoint: store.updateEndpoint,
    setSelection: () => {},
    getFloorById: (floorId) => {
      const floor = store.getFloorById(floorId)
      return floor
        ? {
            id: floor.id,
            layers: floor.layers,
            hiddenSitplanPlacementIds: floor.hiddenSitplanPlacementIds,
          }
        : null
    },
    updateFloor: store.updateFloor,
    getCircuitById: (circuitId) => store.getCircuitById(circuitId) ?? null,
    getProtectionById: (protectionId) => store.getProtectionById(protectionId) ?? null,
    addTrunkDevice: store.addTrunkDevice,
    addSupplyTrunkDevice: store.addSupplyTrunkDevice,
    addGroundTrunkDevice: store.addGroundTrunkDevice,
    ensureJunctionPanelPlacementForLabel: store.ensureJunctionPanelPlacementForLabel,
    updateCircuit: store.updateCircuit,
    updateProtection: store.updateProtection,
    updateInstallation: store.updateInstallation,
    addSupplyAssembly: store.addSupplyAssembly,
    replaceSupplyAssembly: store.replaceSupplyAssembly,
    moveCircuitOnMainBus: store.moveCircuitOnMainBus,
    moveCircuitToSecondaryBus: store.moveCircuitToSecondaryBus,
    deleteEndpoint: store.deleteEndpoint,
    addEendraadNote: store.addEendraadNote,
    ...overrides,
  }
}

/**
 * Add a new MCB + empty circuit on a panel (same defaults as plan drop “new circuit”), as one
 * `circuit.createEmpty` command. Returns the new circuit id.
 */
export function createEmptyCircuitOnPanel(
  panelId: string,
  dropKind: PlanDropKind,
  options?: CreateEmptyCircuitOnPanelOptions | string
): string | null {
  const normalized: CreateEmptyCircuitOnPanelOptions =
    typeof options === 'string' ? { protectionLabel: options } : (options ?? {})
  const outcome = runProjectCommand('circuit.createEmpty', {
    panelId,
    kind: dropKind,
    ...normalized,
  })
  return outcome?.results[0]?.created[0]?.id ?? null
}

/**
 * Place symbol on the plan and assign to a circuit, as one `plan.placeSymbol` command. Selects
 * the new placement on the situation plan.
 */
export function commitPlanSymbolDrop(
  params: CommitPlanSymbolDropParams
): { endpointId: string; placementId: string; circuitId: string; panelId: string } | null {
  const { symbol, position, floorId, floorLayer, panelId, circuitChoice, setSelection } = params
  const endpointType = getEndpointTypeFromSymbol(symbol)
  if (!endpointType) return null

  const sitplanTarget = createUiDropBehaviorHooks().getSitplanTarget()
  const outcome = runProjectCommand('plan.placeSymbol', {
    symbolId: symbol.id,
    floorId,
    floorLayer,
    pos: position,
    panelId,
    circuit: circuitChoice,
    viewportCenter: sitplanTarget.activeFloorId === floorId ? sitplanTarget.viewportCenter : null,
  })
  const result = outcome?.results[0]
  const placementId = result?.select?.[0]?.id
  const endpointId = result?.created.find((ref) => ref.kind === 'endpoint')?.id
  const circuitId = result?.related?.find((ref) => ref.kind === 'circuit')?.id
  if (!placementId || !endpointId || !circuitId) return null

  setSelection({ type: 'placement', ids: [placementId] })
  trackSymbolPlace({
    canvas: 'plan',
    symbol,
    placementMethod: 'library_drop',
    endpointType,
    dropKind: endpointTypeToPlanDropKind(endpointType),
    assignmentMode: circuitChoice.mode,
  })
  return { endpointId, placementId, circuitId, panelId }
}

/**
 * @deprecated Use commitPlanSymbolDrop with PlanDropCircuitPanel. Kept for tests / callers that bypass the picker.
 */
export function createPlanDropHandler(
  currentProject: PlanDropProjectInput | null | undefined,
  activeFloorId: string | null,
  getFloorById: (id: string) => Floor | null | undefined,
  addCircuit: (panelId: string, circuit: Circuit, protectionId: string) => void,
  addEndpoint: (
    circuitId: string,
    endpoint: Endpoint,
    insertAfterEndpointId?: string | null,
    branchOpts?: { forceNewBranch?: boolean }
  ) => void,
  addPlacement: (endpointId: string, placement: Placement) => void,
  setSelection: (selection: Selection) => void,
  addEndpointWithPlacement?: (
    circuitId: string,
    endpoint: Endpoint,
    placement: Placement,
    insertAfterEndpointId?: string | null,
    branchOpts?: { forceNewBranch?: boolean }
  ) => void
) {
  return (position: Point, symbolData: unknown) => {
    if (!currentProject) {
      logger.warn('PlanCanvas: No current project')
      return
    }

    if (!activeFloorId) {
      logger.warn('PlanCanvas: No active floor selected')
      return
    }

    const symbol = symbolData as SymbolMetadata
    if (!symbol || !symbol.id) {
      logger.warn('PlanCanvas: Invalid symbol data:', symbolData)
      return
    }

    if (symbol.scope === 'eendraad') {
      logger.warn('PlanCanvas: Symbol scope is eendraad only:', symbol.id)
      return
    }

    const activeFloor = getFloorById(activeFloorId)
    if (!activeFloor) return

    if (symbol.id === 'note') {
      const noteId = `note-${Date.now()}`
      useProjectStore.getState().addSitplanNote({
        id: noteId,
        text: 'New note',
        fontSize: 14,
        pos: position,
        floorId: activeFloorId,
      })
      setSelection({ type: 'note', ids: [noteId] })
      trackGoogleAnalyticsEvent('note_place', {
        canvas: 'plan',
        source: 'symbol_drop',
      })
      return
    }

    const defaultPanel = currentProject.disciplines?.electrical?.panels?.[0]
    if (!defaultPanel) return

    const endpointType = getEndpointTypeFromSymbol(symbol)
    if (!endpointType) return

    const dropKind = endpointTypeToPlanDropKind(endpointType)
    const circuitKind = planDropKindToCircuitKind(dropKind)

    const panelCircuits = collectCircuits(defaultPanel)
    const lastWorkedCircuitId = useProjectStore.getState().lastWorkedCircuitId
    const preferredCircuit = lastWorkedCircuitId
      ? panelCircuits.find((c) => c.id === lastWorkedCircuitId && c.code !== 'PANEL')
      : undefined
    let circuit = preferredCircuit ?? panelCircuits.find((c) => c.kind === circuitKind)

    if (!circuit) {
      const circuitId = createEmptyCircuitOnPanel(defaultPanel.id, dropKind)
      if (!circuitId) return
      circuit = getCircuitForPlanDrop(circuitId) ?? undefined
      if (!circuit) return
    }

    const newPlacement: Placement = {
      id: generateId(),
      floorId: activeFloorId,
      layer: activeFloor.layers?.[0] || 'electrical',
      pos: position,
      rotationDeg: 0,
      scale: 1,
    }

    let endpointId: string | null = null
    const store = useProjectStore.getState()
    const callbacks = createStoreDropBehaviorCallbacks({
      addCircuit: (panelId, circuitToAdd, protectionId) => {
        if (protectionId) addCircuit(panelId, circuitToAdd, protectionId)
      },
      addEndpoint: (targetCircuitId, endpoint, insertAfterEndpointId, branchOpts) => {
        endpointId = endpoint.id
        if (addEndpointWithPlacement) {
          addEndpointWithPlacement(
            targetCircuitId,
            endpoint,
            newPlacement,
            insertAfterEndpointId ?? undefined,
            branchOpts
          )
        } else {
          addEndpoint(targetCircuitId, endpoint, insertAfterEndpointId ?? undefined, branchOpts)
          addPlacement(endpoint.id, newPlacement)
        }
      },
      addPlacement: () => {},
      setSelection: () => {},
    })
    executeDropBehavior(
      symbol,
      {
        type: 'circuit',
        panelId: defaultPanel.id,
        circuitId: circuit.id,
        insertAfterEndpointId: circuit.endpoints[circuit.endpoints.length - 1]?.id,
      } as DropTarget,
      (store.currentProject ?? currentProject) as DropBehaviorProject,
      ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never,
      callbacks,
      false
    )
    if (!endpointId) return

    setSelection({ type: 'endpoint', ids: [endpointId] })
  }
}
