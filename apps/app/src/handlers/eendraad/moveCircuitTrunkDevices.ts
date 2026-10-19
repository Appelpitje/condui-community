import { liveProjectSession } from '@/stores/liveProjectCommandSession'
import type { DropTarget } from '@/lib/layout/findDropTarget'

export function moveCircuitTrunkDevices(
  devices: readonly { id: string; sourceCircuitId: string }[],
  target: DropTarget
): boolean {
  try {
    const segment = target.circuitTrunkSegmentIndex
    const outcome = liveProjectSession.execute(
      devices.map((device, index) => ({
        id: 'electrical.moveCircuitTrunkDevice',
        input: {
          deviceId: device.id,
          sourceCircuitId: device.sourceCircuitId,
          target:
            typeof segment === 'number'
              ? { ...target, circuitTrunkSegmentIndex: segment + index }
              : target,
        },
      })),
      { label: devices.length > 1 ? 'move circuit device selection' : 'move circuit device' }
    )
    return outcome.changed
  } catch {
    return false
  }
}
