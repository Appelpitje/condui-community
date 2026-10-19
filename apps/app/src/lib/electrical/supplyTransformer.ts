import type { Installation, TrunkDevice } from '@/types/schema'

/** The MV source is external equipment, never a physical panel module. */
export function isSupplyTransformer(device: TrunkDevice | undefined): boolean {
  return device?.symbol === 'transformer' && device.conversionProps?.transformerRole === 'supply'
}

/** Fluvius C2/112 supplement, section 8.1; editable defaults, not site approval. */
export const DEFAULT_SUPPLY_TRANSFORMER_PRIMARY_V = 10600
export const SUPPLY_TRANSFORMER_PRIMARY_PRESETS_V = [10600, 11700, 12600, 15750] as const

/** The source record owns the MV nameplate; the installation voltage is its LV output. */
export function getInstallationSupplyTransformers(installation: Installation) {
  const devices = installation.mainSupply.supplyTrunkDevices ?? installation.feedTopology?.sharedFeed.trunkDevices ?? []
  return devices.filter((device) => device.symbol === 'transformer' &&
    (device.supplyPath == null || device.supplyPath === 'serial'))
}

export function getInstallationSupplyTransformer(installation: Installation) {
  return getInstallationSupplyTransformers(installation).find(isSupplyTransformer)
}

export function syncSupplyTransformerOutput(installation: Installation): string | undefined {
  const device = getInstallationSupplyTransformer(installation)
  const output = installation.nominalVoltage.uLineToLine
  if (!device?.conversionProps || device.conversionProps.transformerSecondaryVoltageV === output) return undefined
  device.conversionProps.transformerSecondaryVoltageV = output
  return device.id
}
