import { symbols, getSymbolById } from '@/lib/symbols'
import type { PlanSymbolColors, SymbolKey } from '@/types/schema'

/** Symbol category for visibility and hover-highlight */
export type SitplanSymbolCategory = keyof PlanSymbolColors

export const SITPLAN_CATEGORY_VISIBILITY_KEYS = {
  sockets: 'socketsVisible',
  lights: 'lightsVisible',
  switches: 'switchesVisible',
  panels: 'panelsVisible',
  fixedAppliances: 'fixedAppliancesVisible',
  dc: 'dcVisible',
  energyConversion: 'energyConversionVisible',
  earthing: 'earthingVisible',
  other: 'otherVisible',
} as const

const symbolMetadata = new Map(symbols.map((symbol) => [symbol.id, symbol]))

/** Map endpoint symbol key to visibility category */
export function getSymbolCategory(symbolKey: SymbolKey | 'earthing'): SitplanSymbolCategory | null {
  const metadata = symbolMetadata.get(symbolKey) ?? getSymbolById(symbolKey)
  if (symbolKey === 'earthing' || symbolKey === 'earthing_separator') return 'earthing'
  if (metadata?.category === 'energyConversion')
    return metadata.inputDomain === 'DC' && metadata.outputDomain === 'DC'
      ? 'dc'
      : 'energyConversion'
  if (
    symbolKey === 'socket' ||
    symbolKey === 'socket_gnd' ||
    symbolKey === 'socket_child' ||
    symbolKey === 'socket_gnd_child'
  )
    return 'sockets'
  if (
    symbolKey === 'light_point' ||
    symbolKey === 'light_spot' ||
    symbolKey === 'light_led' ||
    symbolKey === 'light_fluorescent'
  )
    return 'lights'
  if (
    symbolKey === 'switch' ||
    symbolKey === 'switch_1p_twoway' ||
    symbolKey === 'switch_2p_twoway' ||
    symbolKey === 'switch_dimmer' ||
    symbolKey === 'switch_1p_changeover' ||
    symbolKey === 'switch_1p_pull' ||
    symbolKey === 'switch_impulse' ||
    symbolKey === 'switch_cross' ||
    symbolKey === 'motion_detector' ||
    symbolKey === 'smoke_detector' ||
    symbolKey === 'relay' ||
    symbolKey === 'switch_single' ||
    symbolKey === 'switch_double'
  )
    return 'switches'
  if (symbolKey === 'panel_distribution' || symbolKey === 'junction_panel') {
    return 'panels'
  }
  const fixedApplianceKeys: SymbolKey[] = [
    'oven',
    'washer',
    'dryer',
    'dishwasher',
    'boiler',
    'ev',
    'freezer',
    'fridge',
    'microwave',
    'motor',
    'fixed_appliance_generic',
    'stove',
    'furnace',
    'heating',
    'ventilation',
    'door_lock',
  ]
  if (fixedApplianceKeys.includes(symbolKey)) return 'fixedAppliances'
  switch (metadata?.category) {
    case 'outlets':
      return 'sockets'
    case 'lighting':
      return 'lights'
    case 'switches':
      return 'switches'
    case 'appliances':
    case 'hvac':
    case 'sound':
    case 'domotica':
    case 'metering':
      return 'fixedAppliances'
    case 'grid':
    case 'protection':
      return 'other'
    default:
      return null
  }
}
