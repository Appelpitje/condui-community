import { supplyCableConductorsForSystem, type NominalVoltageSystem } from '@/constants/nominalVoltage'
import type { CableSpec } from '@/types/schema'

/** Blank utility feed through the meter/protections to the active bus; PE has its own path. */
export function createDefaultSupplyCable(system: NominalVoltageSystem = '2~'): CableSpec {
  return {
    kind: 'XVB',
    conductors: supplyCableConductorsForSystem(system),
    sectionMm2: 6,
    hasPE: false,
  }
}
