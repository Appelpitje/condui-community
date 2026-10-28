import type { ControlAddressing, ControlButtonAddress, Endpoint } from '@/types/schema'
import { normalizeChannel, normalizeGroups } from './controlAddress'

/** Only the pushbutton symbol supports multiple independently addressed buttons. */
export function getControlButtonCount(endpoint: Endpoint): number {
  const count = endpoint.symbol === 'switch_impulse' ? endpoint.switchProps?.switchingCount : undefined
  return count != null && Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1
}

export interface EffectiveControlButtonAddress {
  buttonIndex: number
  channel: string | undefined
  groups: string[]
}

/** Legacy addressing belongs to the first button only; blank overrides remain unassigned. */
export function getControlButtonAddress(
  addressing: ControlAddressing | undefined,
  buttonIndex: number,
): EffectiveControlButtonAddress {
  const override = Array.isArray(addressing?.buttonAddresses)
    ? addressing.buttonAddresses.find((entry) => entry?.buttonIndex === buttonIndex)
    : undefined
  const source = override ?? (buttonIndex === 0 ? addressing : undefined)
  return { buttonIndex, channel: normalizeChannel(source?.channel), groups: normalizeGroups(source?.groups) }
}

/** Active stored buttons plus the legacy first slot; never expand unconfigured multipliers. */
export function getActiveControlButtonAddresses(
  endpoint: Endpoint,
  addressing: ControlAddressing | undefined,
): EffectiveControlButtonAddress[] {
  const count = getControlButtonCount(endpoint)
  const indexes = new Set([0])
  for (const entry of Array.isArray(addressing?.buttonAddresses) ? addressing.buttonAddresses : []) {
    if (entry != null && Number.isInteger(entry.buttonIndex) && entry.buttonIndex >= 0 && entry.buttonIndex < count) {
      indexes.add(entry.buttonIndex)
    }
  }
  return [...indexes].sort((left, right) => left - right).map((index) =>
    getControlButtonAddress(addressing, index)
  )
}

/** One button edit replaces its override without rewriting legacy or inactive addresses. */
export function setControlButtonAddress<T extends ControlAddressing>(
  addressing: T,
  buttonIndex: number,
  patch: Pick<ControlAddressing, 'channel' | 'groups'>,
): T {
  if (!Number.isInteger(buttonIndex) || buttonIndex < 0) return addressing
  const current = getControlButtonAddress(addressing, buttonIndex)
  const values = { channel: current.channel, groups: current.groups, ...patch }
  const next: ControlButtonAddress = {
    buttonIndex,
    // This is a complete array entry, not a nested partial patch. Omit clears so
    // UI adapters do not serialize undefined as null inside the strict array.
    ...(values.channel == null ? {} : { channel: values.channel }),
    ...(values.groups == null || values.groups.length === 0 ? {} : { groups: values.groups }),
  }
  return {
    ...addressing,
    buttonAddresses: [
      ...(addressing.buttonAddresses ?? []).filter((entry) => entry.buttonIndex !== buttonIndex),
      next,
    ].sort((left, right) => left.buttonIndex - right.buttonIndex),
  }
}

/** Stable connection identity, independent of channel text and the current button count. */
export function controlConnectionId(endpointId: string, buttonIndex?: number): string {
  return buttonIndex == null ? endpointId : `${endpointId}:button:${buttonIndex}`
}
