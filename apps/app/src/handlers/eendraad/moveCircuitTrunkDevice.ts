import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import type { DropTarget } from '@/lib/layout/findDropTarget'

export function moveCircuitTrunkDevice(options: {
  deviceId: string
  sourceCircuitId: string
  target: DropTarget
  label?: string
}): boolean {
  const outcome = runProjectCommand(
    'electrical.moveCircuitTrunkDevice',
    {
      deviceId: options.deviceId,
      sourceCircuitId: options.sourceCircuitId,
      target: options.target,
    },
    { label: options.label ?? 'move circuit device' }
  )
  return !!outcome?.changed
}
