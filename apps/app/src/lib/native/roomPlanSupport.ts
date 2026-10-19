import { Capacitor } from '@capacitor/core'
import { create } from 'zustand'
import { RoomPlan } from './roomPlan'

/** Capture availability is device-specific; viewing scan documents has no native dependency. */
export const useRoomPlanSupport = create<{ supported: boolean | null }>(() => ({ supported: null }))
let request: Promise<boolean> | undefined
export function ensureRoomPlanSupport(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
    useRoomPlanSupport.setState({ supported: false })
    return Promise.resolve(false)
  }
  return request ??= RoomPlan.isSupported().then(({ supported }) => {
    useRoomPlanSupport.setState({ supported }); return supported
  }).catch(() => { useRoomPlanSupport.setState({ supported: false }); return false })
}
