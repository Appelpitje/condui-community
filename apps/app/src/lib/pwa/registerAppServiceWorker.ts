import { Capacitor } from '@capacitor/core'
import { registerSW } from 'virtual:pwa-register'
import { notifyAppServiceWorkerUpdateAvailable } from '@/lib/pwa/appUpdateEvents'
import { setAppServiceWorkerRegistration } from '@/lib/pwa/serviceWorkerUpdateReload'
export {
  forceAppHardReload,
  requestAppServiceWorkerUpdateAndReload,
} from '@/lib/pwa/serviceWorkerUpdateReload'

const OFFLINE_SHELL_READY_SESSION_KEY = 'eendra.pwa.offlineShellReady'
const DEV_SERVICE_WORKER_CLEANUP_KEY = 'eendra.pwa.devServiceWorkerCleanupDone'

export function isPwaOfflineShellReady(): boolean {
  if (typeof sessionStorage === 'undefined') return false
  return sessionStorage.getItem(OFFLINE_SHELL_READY_SESSION_KEY) === '1'
}

export function registerAppServiceWorker(): void {
  if (Capacitor.isNativePlatform()) return
  if (!import.meta.env.PROD) {
    cleanupDevServiceWorker()
    return
  }
  if (import.meta.env.VITE_E2E === '1') return

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      setAppServiceWorkerRegistration(registration ?? null)
      void registration?.update().catch(() => {
        // Best-effort only.
      })
    },
    onNeedRefresh() {
      notifyAppServiceWorkerUpdateAvailable()
    },
    onOfflineReady() {
      try {
        sessionStorage.setItem(OFFLINE_SHELL_READY_SESSION_KEY, '1')
      } catch {
        // Best-effort only.
      }
    },
  })
}

function cleanupDevServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
    const hadController = Boolean(navigator.serviceWorker.controller)
    const hadRegistrations = registrations.length > 0
    if (!hadController && !hadRegistrations) return

    await Promise.all(registrations.map((registration) => registration.unregister()))
    if (typeof caches !== 'undefined') {
      const cacheNames = await caches.keys()
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
    }

    if (!hadController) return

    try {
      if (sessionStorage.getItem(DEV_SERVICE_WORKER_CLEANUP_KEY) === '1') return
      sessionStorage.setItem(DEV_SERVICE_WORKER_CLEANUP_KEY, '1')
    } catch {
      // If session storage is unavailable, avoid forcing a reload loop.
      return
    }

    window.location.reload()
  })
}
