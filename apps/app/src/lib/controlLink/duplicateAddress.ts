import type { Endpoint } from '@/types/schema'

/**
 * A duplicate keeps what its source is connected to (the operating device, the group addresses)
 * but not the physical channel: a channel belongs to exactly one connection of a device, so a
 * copy starting with the same one would immediately be a duplicate-channel finding.
 * Mutates and returns the freshly cloned endpoint.
 */
export function clearDuplicatedControlChannel<T extends Endpoint>(clone: T): T {
  if (clone.busDeviceProps) {
    const { deviceAddress: _address, ...props } = clone.busDeviceProps
    clone.busDeviceProps = props
  }
  if (clone.controlLink) {
    const { channel: _channel, ...link } = clone.controlLink
    clone.controlLink = { ...link, ...clearedButtonChannels(link) }
  }
  if (clone.domoticaChildProps) {
    const { channel: _channel, ...child } = clone.domoticaChildProps
    clone.domoticaChildProps = { ...child, ...clearedButtonChannels(child) }
  }
  return clone
}

function clearedButtonChannels(addressing: NonNullable<Endpoint['controlLink']> | NonNullable<Endpoint['domoticaChildProps']>) {
  return addressing.buttonAddresses == null ? {} : {
    buttonAddresses: addressing.buttonAddresses.map(({ channel: _channel, ...button }) => ({ ...button })),
  }
}
