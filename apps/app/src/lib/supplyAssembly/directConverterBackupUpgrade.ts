import { findPanelById } from '@/lib/panel/panelTree'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { Circuit, ProtectionDevice } from '@/types/schema'
import type { TrunkDevice } from '@/types/schema'
import { protectionTypeToSymbolKey } from '@/lib/protectionKind'
import { getSupplyFeedDevicesForPanel } from '@/lib/feedTopology'
import { generateId } from '@/utils'
import {
  createDefaultAcCircuitCable,
  DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
} from '@/lib/wires/circuitWireDefaults'
import { getSupplyConverterAcPhaseAssignment } from './supplyConverterPhases'

export type DirectConverterBackupProtection = {
  protection: ProtectionDevice
  circuit: Circuit
}

/** Return the slot after the converter's contiguous AC-output device chain. */
export function getDirectConverterChangeoverInsertIndex(devices: TrunkDevice[]): number | null {
  const ordered = [...devices].sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
  const converterIndex = ordered.findIndex((device) => device.supplyPath === 'converter-branch')
  if (converterIndex < 0) return null

  let insertIndex = converterIndex + 1
  while (
    insertIndex < ordered.length &&
    (ordered[insertIndex]!.supplyPath === undefined ||
      ordered[insertIndex]!.supplyPath === 'serial')
  ) {
    insertIndex += 1
  }
  return insertIndex
}

/** Devices that become the inverter-side input chain when the changeover is inserted. */
export function getDirectConverterOutputChainForChangeover(
  devices: TrunkDevice[],
  insertIndex: number | undefined
): TrunkDevice[] | null {
  const ordered = [...devices].sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
  const preferredInsertIndex = getDirectConverterChangeoverInsertIndex(ordered)
  if (preferredInsertIndex === null || insertIndex !== preferredInsertIndex) return null
  const converterIndex = ordered.findIndex((device) => device.supplyPath === 'converter-branch')
  return ordered.slice(converterIndex + 1, preferredInsertIndex)
}

/**
 * In split-feed mode every visible grid-feed segment is an acceptable changeover drop target.
 * Normalize those forgiving targets back to the one electrically meaningful converter slot.
 */
export function resolveDirectConverterChangeoverInsertIndex(
  devices: TrunkDevice[],
  requestedInsertIndex: number | undefined,
  allowAnyGridFeedSegment: boolean
): number | null {
  const preferred = getDirectConverterChangeoverInsertIndex(devices)
  if (preferred === null) return null
  return allowAnyGridFeedSegment || requestedInsertIndex === preferred ? preferred : null
}

export function findDirectConverterBackupProtection(
  project: ProjectWithOptionalV2Electrical,
  panelId: string,
  converterId: string
): DirectConverterBackupProtection | null {
  const panel = findPanelById(getProjectElectricalPanels(project), panelId)
  if (!panel) return null
  for (const protection of panel.protections) {
    const circuit = (protection.circuits ?? []).find(
      (candidate) =>
        candidate.supplySource?.kind === 'converter-backup' &&
        candidate.supplySource.converterId === converterId
    )
    if (circuit) return { protection, circuit }
  }
  return null
}

export function panelHasPopulatedDirectConverterBackup(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): boolean {
  const panels = getProjectElectricalPanels(project)
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return false
  const converter = getSupplyFeedDevicesForPanel(installation, panels, panelId, 'root').find(
    (device) => device.supplyPath === 'converter-branch'
  )
  if (!converter) return false
  return (
    (findDirectConverterBackupProtection(project, panelId, converter.id)?.circuit.endpoints
      .length ?? 0) > 0
  )
}

/** Preserve an empty standalone backup protection when the converter gains a changeover. */
export function directConverterBackupProtectionToTrunkDevice(
  protection: ProtectionDevice
): TrunkDevice {
  return {
    id: protection.id,
    type: 'protection',
    symbol: protectionTypeToSymbolKey(protection.type) ?? 'mcb',
    label: protection.label,
    trunkPosition: 0,
    supplyPath: 'backup-output',
    protectionType: protection.type,
    ratingA: protection.ratingA,
    curve: protection.curve,
    sensitivityMa: protection.sensitivityMa,
    residualCurrentType: protection.residualCurrentType,
    selective: protection.selective,
    superImmunized: protection.superImmunized,
    breakingCapacityKa: protection.breakingCapacityKa,
    breakingCapacityOption: protection.breakingCapacityOption,
    surgeProtectionKind: protection.surgeProtectionKind,
    polesConfig: protection.polesConfig,
    poles: protection.poles,
    notes: protection.notes,
    installationDate: protection.installationDate,
    installationDateSuppressed: protection.installationDateSuppressed,
    rulesetDateOverride: protection.rulesetDateOverride,
    symbolLabelDisplay: protection.symbolLabelDisplay,
  }
}

/** Inline path, ordered from the converter backup port toward the future changeover port. */
export function directConverterBackupInlineDevicesToTrunkDevices(
  backup: DirectConverterBackupProtection
): TrunkDevice[] {
  const inlineDevices = [...(backup.circuit.trunkDevices ?? [])].sort(
    (a, b) => a.trunkPosition - b.trunkPosition
  )
  return [
    directConverterBackupProtectionToTrunkDevice(backup.protection),
    ...inlineDevices.map((device) => ({ ...device, supplyPath: 'backup-output' as const })),
  ].map((device, trunkPosition) => ({ ...device, trunkPosition }))
}

/** Rebuild the standalone inverter-backup circuit hidden inside a switched backup lane. */
export function restoreDirectConverterBackupProtectionFromTrunkDevices(
  project: ProjectWithOptionalV2Electrical,
  converter: TrunkDevice,
  devices: TrunkDevice[]
): DirectConverterBackupProtection | null {
  const ordered = [...devices].sort((a, b) => a.trunkPosition - b.trunkPosition)
  const source = ordered.find((device) => device.type === 'protection')
  if (!source) return null
  const installation = getProjectElectricalInstallation(project)
  const circuit: Circuit = {
    id: generateId(),
    code: source.label,
    kind: 'other',
    cable: createDefaultAcCircuitCable(),
    phaseAssignment: getSupplyConverterAcPhaseAssignment(
      converter,
      installation?.nominalVoltage.system ?? '1N~'
    ),
    supplySource: { kind: 'converter-backup', converterId: converter.id },
    endpoints: [],
    trunkDevices: ordered
      .filter((device) => device.id !== source.id)
      .map((device, trunkPosition) => {
        const restored = { ...device, trunkPosition }
        delete restored.supplyPath
        return restored
      }),
    ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
  }
  const protection: ProtectionDevice = {
    id: source.id,
    type: source.protectionType ?? 'MCB',
    label: source.label,
    ratingA: source.ratingA,
    curve: source.curve,
    sensitivityMa: source.sensitivityMa,
    residualCurrentType: source.residualCurrentType,
    selective: source.selective,
    superImmunized: source.superImmunized,
    breakingCapacityKa: source.breakingCapacityKa,
    breakingCapacityOption: source.breakingCapacityOption,
    surgeProtectionKind: source.surgeProtectionKind,
    polesConfig: source.polesConfig,
    poles: source.poles,
    notes: source.notes,
    installationDate: source.installationDate,
    installationDateSuppressed: source.installationDateSuppressed,
    rulesetDateOverride: source.rulesetDateOverride,
    symbolLabelDisplay: source.symbolLabelDisplay,
    circuits: [circuit],
  }
  return { protection, circuit }
}
