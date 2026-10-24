import type { ControlDeviceFields, ControlSystem, DomoticaOutputWireProps, Endpoint, Panel } from '@/types/schema'
import { getElectricalLookupIndex } from '@/lib/projectV2/electricalLookupIndex'
import { normalizeChannel } from './controlAddress'

export interface DomoticaBusContext {
  parent: Endpoint
  wire: DomoticaOutputWireProps
  outputGroup: 'control' | 'endpoint'
  outputIndex: number
  system: ControlSystem | undefined
  /** Physical row identity; a name or protocol change never changes the bus identity. */
  busKey: string
}

/** Every child chained on one row reads the same physical bus configuration. */
export function getDomoticaBusContext(
  panels: Panel[], endpoint: Endpoint, endpoints?: ReadonlyMap<string, Endpoint>,
): DomoticaBusContext | undefined {
  const child = endpoint.domoticaChildProps
  if (!child || !Number.isInteger(child.outputIndex) || child.outputIndex < 0) return undefined
  const parent = endpoints
    ? endpoints.get(child.parentEndpointId)
    : getElectricalLookupIndex(panels).endpointsById.get(child.parentEndpointId)?.endpoint
  if (!parent?.domoticaProps) return undefined
  const wire = (child.outputGroup === 'control' ? parent.domoticaProps.controlOutputWires : parent.domoticaProps.endpointOutputWires)?.[child.outputIndex]
  if (wire?.connectionType !== 'bus') return undefined
  return {
    parent, wire, outputGroup: child.outputGroup, outputIndex: child.outputIndex,
    system: wire.busSystem ?? parent.domoticaProps.system,
    busKey: `${parent.id}:${child.outputGroup}:${child.outputIndex}`,
  }
}

const SYSTEM_NAMES: Record<ControlSystem, string> = {
  knx: 'KNX', niko_hc: 'Niko Home Control', dali: 'DALI', loxone: 'Loxone', qbus: 'Qbus', other: 'BUS',
}

export function getDomoticaBusLabel(context: DomoticaBusContext): string {
  if (context.wire.showBusLabel === false) return ''
  const name = context.wire.busName?.trim()
  const system = context.system == null || context.system === 'other' ? undefined : SYSTEM_NAMES[context.system]
  return [name, system].filter(Boolean).join(' · ') || 'BUS'
}

/** Identity belongs to the native device; the host's address/output protocol is unrelated. */
export function getDomoticaBusDeviceFields(context: DomoticaBusContext, endpoint: Endpoint): ControlDeviceFields {
  return { system: context.system, deviceAddress: normalizeChannel(endpoint.busDeviceProps?.deviceAddress) }
}
