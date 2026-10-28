import { useCallback, useSyncExternalStore } from 'react'
import {
  canShowPwaInstallMenuItem,
  subscribePwaInstallAvailability,
  triggerPwaInstall,
  type PwaInstallTriggerResult,
} from '@/lib/pwa/pwaInstall'

export function usePwaInstallMenu() {
  const canShow = useSyncExternalStore(
    subscribePwaInstallAvailability,
    canShowPwaInstallMenuItem,
    () => false,
  )

  const triggerInstall = useCallback(async (): Promise<PwaInstallTriggerResult> => {
    return triggerPwaInstall()
  }, [])

  return { canShow, triggerInstall }
}
