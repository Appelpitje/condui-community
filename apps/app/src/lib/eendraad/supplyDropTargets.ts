import type { DropTarget } from '@/lib/layout/findDropTarget'

const SUPPLY_DROP_TARGETS = new Set<DropTarget['type']>([
  'supplyWire', 'supplyBackupWire', 'supplyBackupOutputWire',
  'supplyChangeoverGridWire', 'supplyConverterGridWire',
  'supplyConverterBackupWire', 'supplyConverterDcWire',
])

/** Supply lanes require a successful simulation; the old append ghost is misleading. */
export function isSupplyDropTarget(target: DropTarget | null | undefined): boolean {
  return !!target && SUPPLY_DROP_TARGETS.has(target.type)
}
