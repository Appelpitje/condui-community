import type { Panel, TrunkDevice } from '@/types/schema'

/** Where a modular changeover's grid input (port 1) is tapped. */
export type ChangeoverGridSource = NonNullable<TrunkDevice['changeoverGridSource']>

export type ChangeoverGridSourceUnavailableReason =
  | 'no-changeover'
  | 'no-backup-converter'
  | 'not-split-switchable'
  | 'converter-grid-input-disconnected'

/** Stable graph id of the T junction on the converter grid-input leg that feeds port 1. */
export function converterInputSplitNodeId(assemblyId: string): string {
  return `${assemblyId}-converter-input-split`
}

/** Persisted request; missing means the historical main-grid tap. */
export function getRequestedChangeoverGridSource(
  changeover: Pick<TrunkDevice, 'changeoverGridSource'> | undefined
): ChangeoverGridSource {
  return changeover?.changeoverGridSource === 'converter-input' ? 'converter-input' : 'grid'
}

/**
 * Why the converter-input tap cannot be effective, or undefined when it can. The tap needs a
 * separate normal (grid-only) bus to keep the main grid run, and a connected converter grid input
 * to tap from. Pure: callers resolve the devices and panel themselves.
 */
export function getConverterInputTapBlocker(input: {
  changeover: TrunkDevice | undefined
  converter: TrunkDevice | undefined
  panel: Pick<Panel, 'busSections'> | undefined
}): ChangeoverGridSourceUnavailableReason | undefined {
  if (!input.changeover) return 'no-changeover'
  if (!input.converter) return 'no-backup-converter'
  const sections = input.panel?.busSections ?? []
  if (
    !sections.some((section) => section.role === 'normal') ||
    !sections.some((section) => section.role === 'backup')
  ) {
    return 'not-split-switchable'
  }
  if (input.converter.converterGridInputConnected === false) {
    return 'converter-grid-input-disconnected'
  }
  return undefined
}

/**
 * The source the supply graph actually uses. An unavailable converter-input request falls back
 * to the grid tap without being cleared, so it returns once the panel allows it again.
 */
export function resolveEffectiveChangeoverGridSource(input: {
  changeover: TrunkDevice | undefined
  converter: TrunkDevice | undefined
  panel: Pick<Panel, 'busSections'> | undefined
}): ChangeoverGridSource {
  return getRequestedChangeoverGridSource(input.changeover) === 'converter-input' &&
    !getConverterInputTapBlocker(input)
    ? 'converter-input'
    : 'grid'
}

/**
 * Split the converter grid-input devices (source-to-converter order) around the port-1 tap.
 * With the grid tap, `converter-leg` devices simply continue after the `input-leg` ones.
 */
export function partitionConverterGridLegDevices<
  T extends Pick<TrunkDevice, 'converterGridPlacement'>,
>(legDevices: readonly T[], source: ChangeoverGridSource): { shared: T[]; converterOnly: T[] } {
  const shared = legDevices.filter((device) => device.converterGridPlacement !== 'converter-leg')
  const converterOnly = legDevices.filter(
    (device) => device.converterGridPlacement === 'converter-leg'
  )
  return source === 'converter-input'
    ? { shared, converterOnly }
    : { shared: [...shared, ...converterOnly], converterOnly: [] }
}

/** True for a converter-grid device on the vertical leg, on either side of the tap. */
export function isConverterGridLegPlacement(
  placement: TrunkDevice['converterGridPlacement']
): boolean {
  return placement === 'input-leg' || placement === 'converter-leg'
}

/**
 * The effective source for a panel's positioned supply devices, as both the one-wire layout and
 * its derived wires draw it. Mirrors the reconciler: one changeover, one backup converter.
 */
export function resolveSupplyLayoutChangeoverGridSource(
  devices: readonly TrunkDevice[],
  panel: Pick<Panel, 'busSections'> | undefined
): ChangeoverGridSource {
  const changeover = devices.find((device) => device.symbol === 'source_changeover')
  const converter = devices.find((device) => device.supplyPath === 'backup')
  if (!changeover || !converter) return 'grid'
  return resolveEffectiveChangeoverGridSource({ changeover, converter, panel })
}

/**
 * Drawing order of the converter grid-input leg, from the converter downwards: converter-only
 * devices sit nearest the converter (above the port-1 tap when there is one), shared devices
 * below them. Within each group the stored order is kept.
 */
export function orderConverterGridLegDevicesFromConverter<
  T extends { device: Pick<TrunkDevice, 'converterGridPlacement'> },
>(positions: readonly T[]): T[] {
  return [
    ...positions.filter(({ device }) => device.converterGridPlacement === 'converter-leg'),
    ...positions.filter(({ device }) => device.converterGridPlacement !== 'converter-leg'),
  ]
}
