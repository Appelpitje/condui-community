import type { TFunction } from 'i18next'
import type { Panel, PanelGridModuleRef, ProtectionDevice } from '@/types/schema'
import type { Selection } from '@/types/ui'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { findCircuitInProject } from '@/lib/eendraad/frameContent'
import { getSymbolById } from '@/lib/symbols'
import { findTrunkDeviceInProject } from '@/utils/project'
import { panelGridModuleRefKey } from '@/lib/panel/panelGridLayout'

export interface PanelHiddenModulePresentation {
  key: string
  label: string
  symbolId?: string
  typeLabel?: string
}

export function getPanelModuleSelection(ref: PanelGridModuleRef): Selection {
  if (ref.kind === 'protection') return { type: 'protection', ids: [ref.id] }
  if (ref.kind === 'trunkDevice') return { type: 'trunkDevice', ids: [ref.id] }
  return { type: 'endpoint', ids: [ref.endpointId] }
}

const protectionSymbolIds: Partial<Record<ProtectionDevice['type'], string>> = {
  MCB: 'mcb',
  RCD: 'rcd',
  RCBO: 'rcbo',
  FUSE: 'fuse',
  MAIN_SWITCH: 'main_switch',
  SPD: 'spd',
  ROTATING_SWITCH: 'rotating_switch',
}

function findProtection(panels: Panel[], id: string): ProtectionDevice | undefined {
  for (const panel of panels) {
    const protection = panel.protections.find((candidate) => candidate.id === id)
    if (protection) return protection
    const nested = findProtection(panel.subPanels ?? [], id)
    if (nested) return nested
  }
  return undefined
}

function localizedSymbolName(symbolId: string | undefined, t: TFunction): string | undefined {
  if (!symbolId) return undefined
  const symbol = getSymbolById(symbolId)
  if (!symbol) return undefined
  return t(`symbols.${symbol.id}`, symbol.name)
}

function withCircuit(device: string, circuitCode: string | undefined, t: TFunction): string {
  const circuit = circuitCode?.trim()
  return circuit
    ? t('hiddenItemsDialog.deviceOnCircuit', '{{device}} on {{circuit}}', {
        device,
        circuit,
      })
    : device
}

export function getPanelHiddenModulePresentation(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical,
  t: TFunction
): PanelHiddenModulePresentation {
  const key = panelGridModuleRefKey(ref)

  if (ref.kind === 'protection') {
    const protection = findProtection(getProjectElectricalPanels(project), ref.id)
    const symbolId = protection ? protectionSymbolIds[protection.type] : undefined
    const device =
      localizedSymbolName(symbolId, t) ||
      protection?.label?.trim() ||
      t('hiddenItemsDialog.protectionFallback', 'Protection device')
    const circuitCodes = protection?.circuits
      ?.map((circuit) => circuit.code.trim())
      .filter(Boolean)
      .join(', ')
    return { key, label: withCircuit(device, circuitCodes, t), symbolId, typeLabel: device }
  }

  if (ref.kind === 'trunkDevice') {
    const device = findTrunkDeviceInProject(project, ref.id)
    const symbolId = device?.symbol
    const deviceName =
      localizedSymbolName(symbolId, t) ||
      device?.label?.trim() ||
      t('hiddenItemsDialog.trunkDeviceFallback', 'Trunk device')
    const circuitCode = ref.circuitId
      ? findCircuitInProject(project, ref.circuitId)?.code
      : undefined
    return {
      key,
      label: withCircuit(deviceName, circuitCode, t),
      symbolId,
      typeLabel: deviceName,
    }
  }

  const circuit = findCircuitInProject(project, ref.circuitId)
  const endpoint = circuit?.endpoints.find((candidate) => candidate.id === ref.endpointId)
  const symbolId = endpoint?.symbol
  const deviceName =
    localizedSymbolName(symbolId, t) ||
    endpoint?.label?.trim() ||
    t('hiddenItemsDialog.domoticaFallback', 'Domotica module')
  return {
    key,
    label: withCircuit(deviceName, circuit?.code, t),
    symbolId,
    typeLabel: deviceName,
  }
}
