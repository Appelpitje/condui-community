import type { TrunkDevice } from '@/types/schema'

export function supportsSupplyInverterMultiplier(device: TrunkDevice | undefined): boolean {
  if (!device || device.symbol !== 'inverter') return false
  return device.supplyPath === 'backup' || device.supplyPath === 'converter-branch'
}

export function supportsSupplyDeviceMultiplier(device: TrunkDevice | undefined): boolean {
  if (!device) return false
  if (supportsSupplyInverterMultiplier(device)) return true
  return (
    (device.symbol === 'battery' || device.symbol === 'solar_panel') &&
    (device.supplyPath === 'converter-dc' || device.supplyPath === 'converter-dc-top')
  )
}

/** Inverters run as one to three units; panels and batteries go up to 99. */
export function getSupplyDeviceMaxMultiplier(device: Pick<TrunkDevice, 'symbol'>): number {
  return device.symbol === 'inverter' ? 3 : 99
}

export function getSupplyDeviceMultiplier(device: TrunkDevice): number {
  if (!supportsSupplyDeviceMultiplier(device)) return 1
  const serialNumbers =
    device.symbol === 'inverter'
      ? device.conversionProps?.serialNumbers
      : device.symbol === 'battery'
        ? device.batteryProps?.serialNumbers
        : device.solarPanelProps?.serialNumbers
  return Math.max(1, device.placements?.length ?? 0, serialNumbers?.length ?? 0)
}

export function getSupplyDeviceSerialNumbers(device: TrunkDevice): string[] {
  const count = getSupplyDeviceMultiplier(device)
  const props =
    device.symbol === 'inverter'
      ? device.conversionProps
      : device.symbol === 'battery'
        ? device.batteryProps
        : device.symbol === 'solar_panel'
          ? device.solarPanelProps
          : undefined
  const stored = props?.serialNumbers ?? []
  return Array.from({ length: count }, (_, index) =>
    index === 0 ? (stored[index] ?? props?.serialNumber ?? '') : (stored[index] ?? '')
  )
}

export function getSupplyInverterMultiplier(
  device: Pick<TrunkDevice, 'symbol' | 'placements' | 'conversionProps'>
): number {
  if (device.symbol !== 'inverter') return 1
  return Math.max(
    1,
    device.placements?.length ?? 0,
    device.conversionProps?.serialNumbers?.length ?? 0
  )
}

export function getSupplyInverterSerialNumbers(device: TrunkDevice): string[] {
  if (device.symbol !== 'inverter') return ['']
  return getSupplyDeviceSerialNumbers(device)
}

/** Keeps ordered per-unit serials aligned when situation-plan placements are removed. */
export function removeSupplyInverterPlacements(
  device: TrunkDevice,
  removedPlacementIds: ReadonlySet<string>
): boolean {
  if (device.symbol !== 'inverter' || !device.placements?.length) return false
  const serialNumbers = getSupplyInverterSerialNumbers(device)
  const phaseAssignments = device.conversionProps?.acPhaseAssignments ?? []
  const retainedIndexes = device.placements.flatMap((placement, index) =>
    removedPlacementIds.has(placement.id) ? [] : [index]
  )
  if (retainedIndexes.length === device.placements.length) return false

  device.placements = retainedIndexes.flatMap((index) => {
    const placement = device.placements?.[index]
    return placement ? [placement] : []
  })
  const retainedSerialNumbers = retainedIndexes.map((index) => serialNumbers[index] ?? '')
  const retainedPhaseAssignments = retainedIndexes.flatMap((index) => {
    const assignment = phaseAssignments[index]
    return assignment ? [assignment] : []
  })
  device.conversionProps = {
    ...(device.conversionProps ?? {}),
    serialNumber:
      retainedSerialNumbers.length === 1 ? retainedSerialNumbers[0] || undefined : undefined,
    serialNumbers: retainedSerialNumbers.length > 1 ? retainedSerialNumbers : undefined,
    acPhaseAssignment:
      retainedIndexes.length === 1
        ? (retainedPhaseAssignments[0] ?? device.conversionProps?.acPhaseAssignment)
        : undefined,
    acPhaseAssignments:
      retainedIndexes.length === 2 && retainedPhaseAssignments.length === 2
        ? retainedPhaseAssignments
        : undefined,
  }
  return true
}

/** Keeps ordered per-unit metadata aligned when any multiplied supply device is reduced. */
export function removeSupplyDevicePlacements(
  device: TrunkDevice,
  removedPlacementIds: ReadonlySet<string>
): boolean {
  if (device.symbol === 'inverter') {
    return removeSupplyInverterPlacements(device, removedPlacementIds)
  }
  if (
    (device.symbol !== 'battery' && device.symbol !== 'solar_panel') ||
    !device.placements?.length
  ) {
    return false
  }
  const serialNumbers = getSupplyDeviceSerialNumbers(device)
  const retainedIndexes = device.placements.flatMap((placement, index) =>
    removedPlacementIds.has(placement.id) ? [] : [index]
  )
  if (retainedIndexes.length === device.placements.length) return false

  device.placements = retainedIndexes.flatMap((index) => {
    const placement = device.placements?.[index]
    return placement ? [placement] : []
  })
  const retainedSerialNumbers = retainedIndexes.map((index) => serialNumbers[index] ?? '')
  const certificationPatch = {
    serialNumber:
      retainedSerialNumbers.length === 1 ? retainedSerialNumbers[0] || undefined : undefined,
    serialNumbers: retainedSerialNumbers.length > 1 ? retainedSerialNumbers : undefined,
  }
  if (device.symbol === 'battery') {
    device.batteryProps = { ...(device.batteryProps ?? {}), ...certificationPatch }
  } else {
    device.solarPanelProps = { ...(device.solarPanelProps ?? {}), ...certificationPatch }
  }
  return true
}
