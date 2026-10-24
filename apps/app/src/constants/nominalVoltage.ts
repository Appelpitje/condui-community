import type { Installation } from '@/types/schema'

/** Internal codes for Belgian supply voltage systems. */
export type NominalVoltageSystem = '1~' | '2~' | '1N~' | '3~' | '3N~' | 'DC'

/** Selectable supply systems in UI (excludes DC and legacy `1~`). */
export const SUPPLY_VOLTAGE_SYSTEMS = ['2~', '3~', '3N~', '1N~'] as const satisfies readonly NominalVoltageSystem[]

export type SupplyVoltageSystem = (typeof SUPPLY_VOLTAGE_SYSTEMS)[number]

/** Default when no system is set or legacy monophase is migrated. */
export const DEFAULT_SUPPLY_VOLTAGE_SYSTEM: SupplyVoltageSystem = '2~'

export function normalizeNominalVoltageSystem(system: string): NominalVoltageSystem {
  if (system === '1~') return DEFAULT_SUPPLY_VOLTAGE_SYSTEM
  if (system === '2~' || system === '1N~' || system === '3~' || system === '3N~' || system === 'DC') {
    return system
  }
  return DEFAULT_SUPPLY_VOLTAGE_SYSTEM
}

export function defaultVoltagesForSystem(
  system: NominalVoltageSystem,
): Pick<Installation['nominalVoltage'], 'uLineToNeutral' | 'uLineToLine'> {
  switch (system) {
    case '2~':
    case '3~':
      return { uLineToNeutral: 230, uLineToLine: 230 }
    case '1N~':
    case '3N~':
      return { uLineToNeutral: 230, uLineToLine: 400 }
    case '1~':
    case 'DC':
    default:
      return { uLineToNeutral: 230, uLineToLine: 230 }
  }
}

/** Active supply conductors, including neutral where present; PE is wired separately. */
export function supplyCableConductorsForSystem(system: NominalVoltageSystem): number {
  switch (system) {
    case '1~':
    case '2~':
    case '1N~':
    case 'DC':
      return 2
    case '3~':
      return 3
    case '3N~':
      return 4
  }
}

export function voltageLocaleKey(system: NominalVoltageSystem): string {
  switch (system) {
    case '2~':
      return 'installation.voltage_2x230'
    case '3~':
      return 'installation.voltage_3x230'
    case '3N~':
      return 'installation.voltage_3n400'
    case '1N~':
      return 'installation.voltage_1n400'
    case '1~':
      return 'installation.voltage_1x230'
    default:
      return 'installation.voltage_2x230'
  }
}

export function hidesLineToNeutralField(system: NominalVoltageSystem): boolean {
  return system === '2~' || system === '3~'
}

/**
 * One-time migration from pre-thread supply options (`1~`, `2~`, `3~`, `3N~`) to current
 * (`2~`, `3~`, `3N~`, `1N~`). Only `1~` (removed 1×230V) maps to `2~`; other legacy codes
 * are unchanged. Aligns L–N / L–L when the system code changes.
 */
export function normalizeInstallationNominalVoltage(installation: Installation): boolean {
  const raw = installation.nominalVoltage.system as string
  const system = normalizeNominalVoltageSystem(raw)
  const defaults = defaultVoltagesForSystem(system)
  let changed = false

  if (raw !== system) {
    installation.nominalVoltage.system = system
    changed = true
  }

  if (raw === '1~' || (changed && system !== 'DC')) {
    installation.nominalVoltage.uLineToNeutral = defaults.uLineToNeutral
    installation.nominalVoltage.uLineToLine = defaults.uLineToLine
    changed = true
  }

  return changed
}

export function applyNominalVoltageSystem(
  current: Installation['nominalVoltage'],
  system: SupplyVoltageSystem,
): Installation['nominalVoltage'] {
  return {
    ...current,
    system,
    ...defaultVoltagesForSystem(system),
  }
}
