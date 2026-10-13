import { readLegacyCompatibilityFloors } from '@/lib/projectV2/buildingFloors'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import type { Placement, TrunkDevice } from '@/types/schema'
import { generateId } from '@/utils'
import {
  getSupplyDeviceMaxMultiplier,
  getSupplyDeviceSerialNumbers,
  supportsSupplyDeviceMultiplier,
} from '@/lib/supplyAssembly/inverterMultipliers'
import {
  getDefaultSupplyConverterAcPhaseAssignment,
  getSupplyInverterUnitPhaseAssignments,
} from '@/lib/supplyAssembly/supplyConverterPhases'
import { getProjectElectricalInstallation } from '@/lib/projectV2/electrical'

export interface SyncSupplyInverterMultiplierDeps {
  getDevice: (deviceId: string) => TrunkDevice | undefined
  updateDevice: (deviceId: string, updates: Partial<TrunkDevice>) => void
  getActiveFloorId: () => string | null
  getFallbackFloorId: () => string | undefined
  getInstallationSystem: () => NonNullable<
    ReturnType<typeof getProjectElectricalInstallation>
  >['nominalVoltage']['system']
}

export type SyncSupplyDeviceMultiplierDeps = SyncSupplyInverterMultiplierDeps

/**
 * Optional source for the next physical instance.  A multiplier normally grows
 * from its first placement, while an Alt-duplicate must inherit the placement
 * the user actually started dragging.
 */
export interface SupplyDeviceMultiplierPlacementSource {
  placement?: Placement
}

export function syncSupplyDeviceMultiplierCount(
  deps: SyncSupplyDeviceMultiplierDeps,
  deviceId: string,
  target: number,
  source?: SupplyDeviceMultiplierPlacementSource
): boolean {
  const device = deps.getDevice(deviceId)
  if (!device || !supportsSupplyDeviceMultiplier(device)) return false
  if (!Number.isInteger(target) || target < 1 || target > getSupplyDeviceMaxMultiplier(device)) {
    return false
  }

  const placements = [...(device.placements ?? [])]
  const basePlacement = placements[0]
  const sourcePlacement = source?.placement ?? basePlacement
  const floorId = sourcePlacement?.floorId ?? deps.getActiveFloorId() ?? deps.getFallbackFloorId()
  if (!sourcePlacement || !floorId) return false

  const nextPlacements: Placement[] = placements.slice(0, target)
  const createdFrom = Math.min(placements.length, target)
  for (let index = nextPlacements.length; index < target; index++) {
    nextPlacements.push({
      ...sourcePlacement,
      id: generateId(),
      floorId,
      pos: {
        x: sourcePlacement.pos.x + 24 * (index - createdFrom + 1),
        y: sourcePlacement.pos.y + 24 * (index - createdFrom + 1),
      },
    })
  }

  const serialNumbers = getSupplyDeviceSerialNumbers(device).slice(0, target)
  while (serialNumbers.length < target) serialNumbers.push('')
  const certificationPatch = {
    serialNumber: target === 1 ? serialNumbers[0] || undefined : undefined,
    serialNumbers: target > 1 ? serialNumbers : undefined,
  }

  if (device.symbol === 'battery') {
    deps.updateDevice(deviceId, {
      placements: nextPlacements,
      batteryProps: { ...(device.batteryProps ?? {}), ...certificationPatch },
    })
    return true
  }
  if (device.symbol === 'solar_panel') {
    deps.updateDevice(deviceId, {
      placements: nextPlacements,
      solarPanelProps: { ...(device.solarPanelProps ?? {}), ...certificationPatch },
    })
    return true
  }

  const system = deps.getInstallationSystem()
  const previousUnitAssignments = getSupplyInverterUnitPhaseAssignments(device, system, target)
  deps.updateDevice(deviceId, {
    placements: nextPlacements,
    conversionProps: {
      ...(device.conversionProps ?? {}),
      ...certificationPatch,
      acPhaseAssignment:
        target >= 3
          ? getDefaultSupplyConverterAcPhaseAssignment(system)
          : target === 1
            ? previousUnitAssignments[0]
            : undefined,
      acPhaseAssignments: target === 2 ? previousUnitAssignments : undefined,
    },
  })
  return true
}

export function syncSupplyInverterMultiplierCount(
  deps: SyncSupplyInverterMultiplierDeps,
  deviceId: string,
  target: number
): boolean {
  const device = deps.getDevice(deviceId)
  if (
    !device ||
    device.symbol !== 'inverter' ||
    (device.supplyPath !== 'converter-branch' && device.supplyPath !== 'backup')
  ) {
    return false
  }
  return syncSupplyDeviceMultiplierCount(deps, deviceId, target)
}

export function createSyncSupplyInverterMultiplierDeps(): SyncSupplyInverterMultiplierDeps {
  return {
    getDevice: (deviceId) => useProjectStore.getState().getTrunkDeviceById(deviceId)?.device,
    updateDevice: (deviceId, updates) =>
      useProjectStore.getState().updateSupplyTrunkDevice(deviceId, updates),
    getActiveFloorId: () => useUIStore.getState().activeFloorId,
    getFallbackFloorId: () => {
      const project = useProjectStore.getState().currentProject
      return project ? readLegacyCompatibilityFloors(project)[0]?.id : undefined
    },
    getInstallationSystem: () => {
      const project = useProjectStore.getState().currentProject
      return getProjectElectricalInstallation(project ?? {})?.nominalVoltage.system ?? '1N~'
    },
  }
}

export {
  getSupplyDeviceMultiplier,
  getSupplyInverterMultiplier,
} from '@/lib/supplyAssembly/inverterMultipliers'
