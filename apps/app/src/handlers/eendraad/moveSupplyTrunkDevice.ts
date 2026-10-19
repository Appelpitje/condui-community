import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { ElectricalEnclosureRef } from '@/types/supplyAssembly'

export function moveSupplyTrunkDevice(options: {
  deviceId: string
  target: DropTarget
  targetMounting?: ElectricalEnclosureRef
  label?: string
}): boolean {
  const outcome = runProjectCommand(
    'electrical.moveSupplyTrunkDevice',
    {
      deviceId: options.deviceId,
      target: options.target,
      targetMounting: options.targetMounting,
    },
    { label: options.label ?? 'move supply device' }
  )
  return !!outcome?.changed
}
