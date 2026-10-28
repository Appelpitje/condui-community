import { Capacitor } from '@capacitor/core'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type PwaInstallTriggerResult = 'accepted' | 'dismissed' | 'ios_instructions' | 'browser_instructions' | 'installed' | 'unavailable'

let deferredPrompt: BeforeInstallPromptEvent | null = null
let installedInSession = false
const listeners = new Set<() => void>()

function notifyListeners(): void {
  for (const listener of listeners) {
    listener()
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    installedInSession = false
    trackGoogleAnalyticsEvent('pwa_install_prompt_available')
    notifyListeners()
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    installedInSession = true
    trackGoogleAnalyticsEvent('pwa_install_appinstalled')
    notifyListeners()
  })
}

export function isPwaStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function isIosInstallableBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isIosDevice =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return isIosDevice && !isPwaStandalone()
}

export function canShowPwaInstallMenuItem(): boolean {
  if (typeof window === 'undefined') return false
  if (Capacitor.isNativePlatform()) return false
  if (!import.meta.env.PROD) return false
  return true
}

export function subscribePwaInstallAvailability(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function triggerPwaInstall(): Promise<PwaInstallTriggerResult> {
  if (Capacitor.isNativePlatform()) return 'unavailable'
  if (isPwaStandalone() || installedInSession) {
    trackGoogleAnalyticsEvent('pwa_install_unavailable', {
      reason: 'standalone',
    })
    return 'installed'
  }

  if (deferredPrompt) {
    const prompt = deferredPrompt
    // A browser install event is single-use, including when the user dismisses it.
    deferredPrompt = null
    trackGoogleAnalyticsEvent('pwa_install_prompt_start', {
      platform: 'browser',
    })
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') installedInSession = true
    notifyListeners()
    trackGoogleAnalyticsEvent('pwa_install_prompt_result', {
      platform: 'browser',
      outcome,
    })
    return outcome
  }

  if (isIosInstallableBrowser()) {
    trackGoogleAnalyticsEvent('pwa_install_ios_instructions')
    return 'ios_instructions'
  }
  trackGoogleAnalyticsEvent('pwa_install_unavailable', {
    reason: 'no_prompt',
  })
  return 'browser_instructions'
}
