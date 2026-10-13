/**
 * A library symbol dropped onto an electrical position, on a mutable project (a project
 * command draft). Shared by every canvas: the one-wire and panel canvases pass the drop target
 * their hit zones resolved; the plan passes a circuit plus the symbol's own plan placement.
 * Follow-ups (automatic plan placements, panel grid, sub-panels, earthing) run inside the drop
 * engine, so every caller gets the same project changes.
 */
import type { TFunction } from 'i18next'
import type { ProjectV2 } from '@/types/projectV2'
import type { Placement } from '@/types/schema'
import type { Point, Selection } from '@/types/ui'
import type { SitplanPlacementTarget } from '@/lib/eendraad/duplicateSitplanHelpers'
import { createDraftDropBehaviorCallbacks } from '@/lib/eendraad/draftDropBehaviorCallbacks'
import { executeDropBehavior, type DropBehaviorProject } from '@/lib/eendraad/dropBehaviors'
import { addEndpointWithPlacementToProject } from '@/lib/eendraad/endpointMutations'
import { findCircuitById } from '@/lib/eendraad/projectElectricalDomain'
import { normalizeProtectionPlacementDropTarget } from '@/lib/eendraad/protectionPlacementDropTarget'
import domainI18n, { getDomainTranslator } from '@/lib/i18n/domainI18n'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import { getSymbolById } from '@/lib/symbols'

const PROTECTION_IDS = new Set<string>(PROTECTION_SYMBOL_IDS)

export interface ElectricalSymbolDropInput {
  symbolId: string
  target: DropTarget
  /** The dropped symbol's own situation-plan placement (plan canvas drops). */
  planPlacement?: Pick<Placement, 'id' | 'floorId' | 'layer' | 'pos' | 'rotationDeg' | 'scale'>
  /** Canvas position of the drop, for free-floating symbols such as notes. */
  dropCanvasPosition?: Point
}

export type ElectricalSymbolDropOutcome =
  | {
      status: 'placed'
      /** What the drop engine selects afterwards. */
      selection: Selection | null
      created: Array<{
        kind: 'endpoint' | 'protection' | 'circuit' | 'panel' | 'trunkDevice' | 'note'
        id: string
      }>
      /** First endpoint's plan placement when `planPlacement` was given. */
      placementId: string | null
      /** Whether the drop engine called any mutating callback; false means a no-op drop. */
      mutated: boolean
    }
  | { status: 'rejected'; message: string }
  | { status: 'blocked'; reason: 'protection_after_junction_panel' | 'unknown_symbol' }

function findCircuit(project: ProjectV2, circuitId: string) {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findCircuitById(panel, circuitId)
    if (found) return found.circuit
  }
  return undefined
}

/** A protection may not be inserted on a circuit after its junction-panel boundary. */
function blocksProtectionAfterJunctionPanel(
  project: ProjectV2,
  symbolId: string,
  target: DropTarget
): boolean {
  if (!PROTECTION_IDS.has(symbolId) || target.type !== 'circuit' || !target.circuitId) return false
  const devices = [...(findCircuit(project, target.circuitId)?.trunkDevices ?? [])].sort(
    (left, right) => (left.trunkPosition ?? 0) - (right.trunkPosition ?? 0)
  )
  const junctionPanelIndex = devices.findIndex(
    (device) => device.type === 'junction_panel' || device.symbol === 'junction_panel'
  )
  if (junctionPanelIndex < 0) return false
  const isRotatingSwitchBranch =
    symbolId === 'rotating_switch' && (target.branchEndpoints?.length ?? 0) > 0
  const insertsBeforeBoundary =
    typeof target.circuitTrunkSegmentIndex === 'number' &&
    target.circuitTrunkSegmentIndex <= junctionPanelIndex
  return !isRotatingSwitchBranch && !insertsBeforeBoundary
}

/** The drop target rules every canvas shares, before the drop engine runs. */
export function normalizeElectricalDropTarget(symbolId: string, target: DropTarget): DropTarget {
  const symbol = getSymbolById(symbolId)
  if (!symbol) return target
  // A generic panel-frame drop of a protection behaves like a drop on that panel's main bus.
  const onMainBus =
    target.type === null && target.panelId && PROTECTION_IDS.has(symbolId)
      ? { ...target, type: 'mainBus' as const }
      : target
  return normalizeProtectionPlacementDropTarget(symbol, onMainBus)
}

const MUTATING_CALLBACK = /^(add|update|delete|ensure|move|replace)/

/** Wraps the callbacks that change the project so a no-op drop can be told apart. */
function markMutatingCallbacks<T extends object>(callbacks: T, onMutate: () => void): T {
  const wrapped = { ...callbacks } as Record<string, unknown>
  for (const [key, value] of Object.entries(callbacks)) {
    if (typeof value === 'function' && MUTATING_CALLBACK.test(key)) {
      wrapped[key] = (...args: unknown[]) => {
        onMutate()
        return (value as (...a: unknown[]) => unknown)(...args)
      }
    }
  }
  return wrapped as T
}

export function placeElectricalSymbolInProject(
  project: ProjectV2,
  input: ElectricalSymbolDropInput,
  sitplanTarget: SitplanPlacementTarget,
  language?: string,
  t: TFunction = language
    ? (getDomainTranslator(language) as TFunction)
    : (domainI18n.t.bind(domainI18n) as TFunction)
): ElectricalSymbolDropOutcome {
  const symbol = getSymbolById(input.symbolId)
  if (!symbol) return { status: 'blocked', reason: 'unknown_symbol' }
  const target = normalizeElectricalDropTarget(input.symbolId, input.target)
  if (blocksProtectionAfterJunctionPanel(project, input.symbolId, target)) {
    return { status: 'blocked', reason: 'protection_after_junction_panel' }
  }

  let selection: Selection | null = null
  let rejection: string | null = null
  let placementId: string | null = null
  const created: Extract<ElectricalSymbolDropOutcome, { status: 'placed' }>['created'] = []
  let mutated = false
  const base = markMutatingCallbacks(
    createDraftDropBehaviorCallbacks(project, sitplanTarget, {}, language),
    () => {
      mutated = true
    }
  )
  const planPlacement = input.planPlacement
  executeDropBehavior(
    symbol,
    target,
    project as DropBehaviorProject,
    t,
    {
      ...base,
      dropCanvasPosition: input.dropCanvasPosition,
      setSelection: (next) => {
        selection = next
      },
      onDropRejected: (message) => {
        rejection = message
      },
      addEndpoint: (circuitId, endpoint, insertAfterEndpointId, branchOpts) => {
        created.push({ kind: 'endpoint', id: endpoint.id })
        if (!planPlacement) {
          base.addEndpoint(circuitId, endpoint, insertAfterEndpointId, branchOpts)
          return
        }
        const added = addEndpointWithPlacementToProject(
          project,
          circuitId,
          endpoint,
          { ...planPlacement, layer: planPlacement.layer },
          insertAfterEndpointId ?? undefined,
          branchOpts
        )
        // Symbols that create several endpoints (two-way, cross) select the first placement.
        mutated = true
        placementId ??= added
      },
      ...(planPlacement ? { addPlacement: () => {} } : {}),
      addProtection: (panelId, protection) => {
        created.push({ kind: 'protection', id: protection.id })
        base.addProtection(panelId, protection)
      },
      addCircuit: (panelId, circuit, protectionId) => {
        created.push({ kind: 'circuit', id: circuit.id })
        base.addCircuit(panelId, circuit, protectionId)
      },
      addPanel: (panel, parentPanelId) => {
        created.push({ kind: 'panel', id: panel.id })
        base.addPanel(panel, parentPanelId)
      },
      addTrunkDevice: (circuitId, device) => {
        created.push({ kind: 'trunkDevice', id: device.id })
        base.addTrunkDevice(circuitId, device)
      },
      addSupplyTrunkDevice: (device, insertIndex, supplyTarget) => {
        created.push({ kind: 'trunkDevice', id: device.id })
        base.addSupplyTrunkDevice(device, insertIndex, supplyTarget)
      },
      addGroundTrunkDevice: (device, insertIndex, panelId) => {
        created.push({ kind: 'trunkDevice', id: device.id })
        base.addGroundTrunkDevice(device, insertIndex, panelId)
      },
      addEendraadNote: (note) => {
        created.push({ kind: 'note', id: note.id })
        base.addEendraadNote(note)
      },
    },
    false
  )
  if (rejection) return { status: 'rejected', message: rejection }
  return { status: 'placed', selection, created, placementId, mutated }
}
