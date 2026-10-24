import type {
  Circuit,
  Panel,
  PanelGridModuleRef,
  PanelLabelConfig,
  ProtectionDevice,
  ProtectionType,
  TrunkDevice,
} from '@/types/schema'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { getMainBusOrder } from '@/lib/panel/mainBusOrder'
import { walkPanels } from '@/lib/panel/panelTree'

/** How a board's main protection is named on its cabinet label. */
export type PanelMainProtectionRole = 'switch' | 'rcd' | 'protection'

/** Role wording follows the device kind; surge arresters never act as a board's main device. */
export function mainProtectionRoleForType(
  type: ProtectionType | undefined
): PanelMainProtectionRole | null {
  if (type === 'MAIN_SWITCH' || type === 'ROTATING_SWITCH') return 'switch'
  if (type === 'RCD' || type === 'RCBO') return 'rcd'
  if (type === 'MCB' || type === 'FUSE' || type === 'OTHER') return 'protection'
  return null
}

function findProtectionWithPanel(
  panels: readonly Panel[],
  id: string
): { protection: ProtectionDevice; panel: Panel } | undefined {
  for (const panel of walkPanels(panels)) {
    const protection = panel.protections?.find((candidate) => candidate.id === id)
    if (protection) return { protection, panel }
  }
  return undefined
}

function findCircuitTrunkDevice(
  panels: readonly Panel[],
  id: string
): { device: TrunkDevice; circuit: Circuit } | undefined {
  for (const panel of walkPanels(panels)) {
    const circuits = [
      ...(panel.circuits ?? []),
      ...(panel.protections ?? []).flatMap((protection) => protection.circuits ?? []),
    ]
    for (const circuit of circuits) {
      const device = circuit.trunkDevices?.find((candidate) => candidate.id === id)
      if (device) return { device, circuit }
    }
  }
  return undefined
}

interface MainProtectionCandidate {
  role: PanelMainProtectionRole
  automatic: boolean
}

function resolveCandidate(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical
): MainProtectionCandidate | null {
  if (ref.kind === 'protection') {
    const found = findProtectionWithPanel(getProjectElectricalPanels(project), ref.id)
    if (!found) return null
    const role = mainProtectionRoleForType(found.protection.type)
    if (!role) return null
    // A board's main device is the only item on its main bus with other protections
    // behind it; every circuit of the board then passes through it.
    const busItems = getMainBusOrder(found.panel)
    const automatic =
      busItems.length === 1 &&
      busItems[0]?.type === 'protection' &&
      busItems[0].id === ref.id &&
      (found.panel.protections?.length ?? 0) > 1
    return { role, automatic }
  }
  if (ref.kind === 'trunkDevice' && ref.scope === 'circuit') {
    const found = findCircuitTrunkDevice(getProjectElectricalPanels(project), ref.id)
    if (!found || found.device.type !== 'protection') return null
    const role = mainProtectionRoleForType(found.device.protectionType)
    // A sub-board's incoming feed is stored as its `PANEL` circuit; devices on it
    // protect everything the board contains.
    return role ? { role, automatic: found.circuit.code === 'PANEL' } : null
  }
  if (ref.kind === 'trunkDevice' && ref.scope === 'supply') {
    // Supply-wire devices sit upstream of the whole board they feed.
    const device = queryAllSupplyTrunkDevices(project).find((candidate) => candidate.id === ref.id)
    if (!device || device.type !== 'protection') return null
    const role = mainProtectionRoleForType(device.protectionType)
    return role ? { role, automatic: true } : null
  }
  return null
}

/** True when the module is a protection that can be marked as a board's main protection. */
export function canMarkPanelMainProtection(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical
): boolean {
  return resolveCandidate(ref, project) !== null
}

/**
 * Role printed on the module's label, or null. Detection is automatic; `config.main`
 * stores an explicit override only when the user disagrees with it.
 */
export function getPanelMainProtectionRole(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical,
  config: PanelLabelConfig | undefined
): PanelMainProtectionRole | null {
  const candidate = resolveCandidate(ref, project)
  if (!candidate) return null
  const marked = config?.main ?? candidate.automatic
  return marked ? candidate.role : null
}

/** Next stored override after toggling: missing again whenever it matches detection. */
export function toggledPanelMainProtectionOverride(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical,
  config: PanelLabelConfig | undefined
): boolean | null {
  const candidate = resolveCandidate(ref, project)
  if (!candidate) return null
  const next = !(config?.main ?? candidate.automatic)
  return next === candidate.automatic ? null : next
}

const ROLE_TEXT_KEYS: Record<PanelMainProtectionRole, [string, string]> = {
  switch: ['labelStripExport.mainRoleSwitch', 'Main switch'],
  rcd: ['labelStripExport.mainRoleRcd', 'Main RCD'],
  protection: ['labelStripExport.mainRoleProtection', 'Main protection'],
}

/** Upper-case band text in the current language. */
export function panelMainProtectionRoleText(
  role: PanelMainProtectionRole,
  t: (key: string, fallback: string) => string,
  language?: string
): string {
  const [key, fallback] = ROLE_TEXT_KEYS[role]
  return t(key, fallback).toLocaleUpperCase(language)
}

/** Label cell that carries the band: the one showing the module label, else the bottom one. */
export function panelMainProtectionSide(
  topSources: readonly string[],
  bottomSources: readonly string[]
): 'top' | 'bottom' {
  return topSources.includes('label') && !bottomSources.includes('label') ? 'top' : 'bottom'
}
