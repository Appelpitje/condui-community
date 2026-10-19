import { logger } from '@/lib/logger'
/**
 * When a new production deploy is live, `version.json` updates while this tab may still run an old bundle.
 * Polls occasionally and on tab focus; offers a one-click hard refresh.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { APP_BUILD_COMMIT } from '@/lib/appBuildInfo'
import { isStaleDeploy } from '@/lib/deployVersionCheck'
import {
  isDeployRefreshCooldownActive,
  markDeployRefreshRequested,
} from '@/lib/deployRefreshCooldown'
import { onAppServiceWorkerUpdateAvailable } from '@/lib/pwa/appUpdateEvents'
import {
  forceAppHardReload,
  requestAppServiceWorkerUpdateAndReload,
} from '@/lib/pwa/serviceWorkerUpdateReload'

const POLL_MS = 5 * 60 * 1000

type DeployRefreshSource = 'version-check' | 'service-worker'

export function DeployRefreshBanner() {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const checking = useRef(false)

  const showBanner = useCallback((source: DeployRefreshSource) => {
    if (isDeployRefreshCooldownActive()) {
      logger.info('[deploy-refresh] update prompt suppressed during refresh cooldown', { source })
      return
    }
    logger.info('[deploy-refresh] update prompt shown', { source })
    setVisible(true)
  }, [])

  const runCheck = useCallback(async () => {
    if (Capacitor.isNativePlatform()) return
    if (!import.meta.env.PROD) return
    if (import.meta.env.VITE_E2E === '1') return
    if (!APP_BUILD_COMMIT) return
    if (checking.current) return
    checking.current = true
    try {
      if (await isStaleDeploy()) showBanner('version-check')
    } finally {
      checking.current = false
    }
  }, [showBanner])

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return
    if (!import.meta.env.PROD) return
    if (import.meta.env.VITE_E2E === '1') return
    if (!APP_BUILD_COMMIT) return

    void runCheck()
    const id = window.setInterval(() => void runCheck(), POLL_MS)

    const onVisible = () => {
      if (document.visibilityState === 'visible') void runCheck()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [runCheck])

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return
    if (!import.meta.env.PROD) return
    if (import.meta.env.VITE_E2E === '1') return
    return onAppServiceWorkerUpdateAvailable(() => {
      showBanner('service-worker')
    })
  }, [showBanner])

  if (!visible) return null

  const handleRefresh = () => {
    if (refreshing) return
    setRefreshing(true)
    markDeployRefreshRequested()
    window.setTimeout(() => {
      void requestAppServiceWorkerUpdateAndReload()
        .then((handledByServiceWorker) => {
          if (handledByServiceWorker) {
            logger.info('[deploy-refresh] requested service worker cleanup and hard reload')
            return
          }
          logger.info('[deploy-refresh] no waiting service worker update; forcing hard reload')
          return forceAppHardReload()
        })
        .catch((error: unknown) => {
          logger.warn('[deploy-refresh] service worker update failed; forcing hard reload', error)
          void forceAppHardReload()
        })
    }, 0)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-[100] flex max-w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-md border border-sky-200 bg-white px-4 py-3 text-sm text-sky-900 shadow-lg dark:border-sky-700 dark:bg-gray-900 dark:text-sky-100"
    >
      <span className="flex-1 leading-snug">{t('appUpdate.banner')}</span>
      <button
        type="button"
        onClick={handleRefresh}
        disabled={refreshing}
        aria-busy={refreshing}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-75 dark:focus:ring-offset-gray-900"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
        {t('appUpdate.refresh')}
      </button>
    </div>
  )
}
