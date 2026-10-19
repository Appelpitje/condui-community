import type { TrunkDevice } from '@/types/schema'

type SupplyDeviceOrientationSource = Pick<
  TrunkDevice,
  'supplyPath' | 'converterGridPlacement' | 'changeoverGridPlacement' | 'supplyDcBusId'
>

/** Layout facts that change a supply device's orientation without changing the device. */
export interface SupplyDeviceOrientationContext {
  /**
   * Effective changeover grid source of the panel. With `converter-input` the changeover's
   * port-1 devices sit inline on the horizontal wire from the inverter-leg tap.
   */
  changeoverGridSource?: 'grid' | 'converter-input'
}

/** Supply devices placed on upright risers must keep their normal artwork orientation. */
export function isVerticalSupplyDevice(
  device: SupplyDeviceOrientationSource,
  context?: SupplyDeviceOrientationContext
): boolean {
  return (
    (device.supplyPath === 'converter-grid' &&
      (device.converterGridPlacement === 'input-leg' ||
        device.converterGridPlacement === 'converter-leg')) ||
    (device.supplyPath === 'changeover-grid' &&
      device.changeoverGridPlacement === 'input-leg' &&
      context?.changeoverGridSource !== 'converter-input') ||
    device.supplyPath === 'converter-dc-top' ||
    !!device.supplyDcBusId
  )
}
