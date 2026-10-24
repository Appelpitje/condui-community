import type {
  Circuit,
  Endpoint,
  ProtectionDevice,
  Panel,
  Installation,
  TrunkDevice,
  PanelGridConfig,
  JunctionPanelTerminalComponent,
} from '@/types/schema'
import type {
  PropertiesEditInput,
  InstallationPropertyPatch,
} from '@/lib/commands/project/commands/propertiesEdit'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
export type { InstallationPropertyPatch } from '@/lib/commands/project/commands/propertiesEdit'

let fieldSession: { target: HTMLElement; key: string } | undefined
let nextFieldSession = 0

/** A focused text field may commit several debounced values while remaining one undo step. */
export function beginPropertiesFieldEdit(target: HTMLElement) {
  if (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement &&
      ['text', 'number', 'range', 'search'].includes(target.type))
  ) {
    fieldSession = { target, key: `property-field-${++nextFieldSession}` }
  }
}

export function endPropertiesFieldEdit() {
  fieldSession = undefined
}

/** Explicit undefined in existing editor callbacks means clear; omitted keys mean preserve. */
function serializeClears(value: unknown): unknown {
  if (value === undefined) return null
  if (Array.isArray(value)) return value.map(serializeClears)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, serializeClears(child)])
    )
  }
  return value
}

function serializeInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(serializeInput)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [
          key,
          key === 'set' || key === 'installation' ? serializeClears(child) : serializeInput(child),
        ])
    )
  }
  return value
}

function run(input: unknown) {
  if (fieldSession && !fieldSession.target.isConnected) endPropertiesFieldEdit()
  return runProjectCommand('properties.edit', serializeInput(input), {
    source: 'properties',
    label: 'edit selection properties',
    historyGroup: fieldSession?.key,
  })
}

/** The single entry point used by individual and multi-selection property editors. */
export function editProperties(input: PropertiesEditInput) {
  return run(input)
}

export function updateProtectionProperties(id: string, set: Partial<ProtectionDevice>) {
  return run({ edits: [{ kind: 'protection', ids: [id], set }] })
}

export function updateCircuitProperties(id: string, set: Partial<Circuit>) {
  return run({ edits: [{ kind: 'circuit', ids: [id], set }] })
}

export function updateEndpointProperties(
  id: string,
  set: Partial<Endpoint> & { circuitId?: string }
) {
  const { circuitId, ...properties } = set
  return run({
    edits: Object.keys(properties).length ? [{ kind: 'endpoint', ids: [id], set: properties }] : [],
    ...(circuitId !== undefined
      ? { actions: [{ kind: 'assignEndpoints', endpointIds: [id], targetCircuitId: circuitId }] }
      : {}),
  })
}

export function updatePanelProperties(id: string, set: Partial<Panel>) {
  return run({ edits: [{ kind: 'panel', ids: [id], set }] })
}
export function updatePanelGridProperties(id: string, set: Partial<PanelGridConfig>) {
  return run({ edits: [{ kind: 'panelGrid', ids: [id], set }] })
}
export function updateTrunkProperties(id: string, set: Partial<TrunkDevice>) {
  return run({ edits: [{ kind: 'trunkDevice', ids: [id], set }] })
}
export function updateInstallationProperties(
  set: Partial<Installation> | InstallationPropertyPatch
) {
  return run({ installation: set })
}
export function updateJunctionPanelGridProperties(id: string, set: Partial<PanelGridConfig>) {
  return run({ edits: [{ kind: 'junctionPanelGrid', ids: [id], set }] })
}
export function updateJunctionPanelTerminalProperties(
  id: string,
  set: Partial<JunctionPanelTerminalComponent>
) {
  return run({ edits: [{ kind: 'junctionPanelTerminal', ids: [id], set }] })
}
export function updateAuxiliaryEnclosureProperties(
  id: string,
  set: Partial<import('@/types/supplyAssembly').AuxiliaryElectricalEnclosure>
) {
  return run({ edits: [{ kind: 'auxiliaryEnclosure', ids: [id], set }] })
}
export function updateCanonicalWireProperties(
  anchor: string,
  defaultCable: import('@/types/schema').CableSpec,
  set: import('@/lib/wires/editWireRun').WireRunChanges,
  sharedGeometryAnchors?: readonly string[]
) {
  return run({
    edits: [
      {
        kind: 'canonicalWire',
        ids: [anchor],
        defaultCable,
        set,
        ...(sharedGeometryAnchors ? { sharedGeometryAnchors: [...sharedGeometryAnchors] } : {}),
      },
    ],
  })
}
