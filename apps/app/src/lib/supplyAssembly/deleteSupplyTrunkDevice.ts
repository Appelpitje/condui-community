import { deleteProjectEntities } from '@/handlers/commands/deleteEntities'
import { useProjectStore } from '@/stores/projectStore'

/** Delete a supply device. Changeovers are downgraded to a direct inverter feed by the store. */
export function confirmDeleteSupplyTrunkDevice(deviceId: string, onDeleted?: () => void): void {
  const store = useProjectStore.getState()
  const result = store.getTrunkDeviceById(deviceId)
  if (!result?.isSupplyDevice) return

  deleteProjectEntities([{ kind: 'trunkDevice', id: deviceId }], { onDeleted })
}
