import { useCallback, useEffect, useState } from 'react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'

const BANNER_DISMISSED_SESSION_KEY = 'eendra.offlineConnectivity.bannerDismissed'
export const OFFLINE_BANNER_DISMISSED_EVENT = 'eendra-offline-banner-dismissed'

function readBannerDismissed(): boolean {
  if (typeof sessionStorage === 'undefined') return false
  return sessionStorage.getItem(BANNER_DISMISSED_SESSION_KEY) === '1'
}

export function useOfflineConnectivityUi(options?: { allowDismiss?: boolean }) {
  const allowDismiss = options?.allowDismiss ?? false
  const { isOffline } = useOnlineStatus()
  const [bannerDismissed, setBannerDismissed] = useState(() => isOffline && readBannerDismissed())
  const [connectionSource, setConnectionSource] = useState(isOffline)
  if (connectionSource !== isOffline) {
    setConnectionSource(isOffline)
    if (!isOffline) setBannerDismissed(false)
  }

  useEffect(() => {
    const syncDismissed = () => setBannerDismissed(readBannerDismissed())
    window.addEventListener(OFFLINE_BANNER_DISMISSED_EVENT, syncDismissed)
    return () => window.removeEventListener(OFFLINE_BANNER_DISMISSED_EVENT, syncDismissed)
  }, [])

  useEffect(() => {
    if (!isOffline) {
      sessionStorage.removeItem(BANNER_DISMISSED_SESSION_KEY)
    }
  }, [isOffline])

  const dismissBanner = useCallback(() => {
    sessionStorage.setItem(BANNER_DISMISSED_SESSION_KEY, '1')
    setBannerDismissed(true)
    window.dispatchEvent(new Event(OFFLINE_BANNER_DISMISSED_EVENT))
  }, [])

  const showBanner = isOffline && (!allowDismiss || !bannerDismissed)
  const showIndicator = isOffline && allowDismiss && bannerDismissed

  return {
    isOffline,
    showBanner,
    showIndicator,
    dismissBanner,
  }
}
