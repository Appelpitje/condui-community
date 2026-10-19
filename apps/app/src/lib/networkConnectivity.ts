/** Browser online hint from `navigator.onLine` (may be optimistic). */
export function readNavigatorOnLine(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine
}

const NETWORK_UNAVAILABLE_EVENT = 'condui-network-unavailable'
const NETWORK_STATUS_REFRESH_EVENT = 'condui-network-status-refresh'
const APP_SERVER_REACHABILITY_EVENT = 'eendra-app-server-reachability'
let networkUnavailableUntil = 0
let appServerReachable = true
let databaseUnavailable = false

/** A service outage is independent of the browser's internet connection. */
export function readDatabaseUnavailable(): boolean {
  return databaseUnavailable
}

export function setDatabaseUnavailable(unavailable: boolean): void {
  if (databaseUnavailable === unavailable) return
  databaseUnavailable = unavailable
  if (!unavailable) networkUnavailableUntil = 0
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NETWORK_STATUS_REFRESH_EVENT))
  }
}

export function readOnlineStatus(): boolean {
  return (
    readNavigatorOnLine() &&
    appServerReachable &&
    !databaseUnavailable &&
    !readNetworkUnavailable()
  )
}

export function reportNetworkUnavailable(durationMs = 60_000): void {
  if (typeof window === 'undefined') return
  networkUnavailableUntil = Math.max(networkUnavailableUntil, Date.now() + durationMs)
  window.dispatchEvent(new Event(NETWORK_UNAVAILABLE_EVENT))
}

export function readNetworkUnavailable(): boolean {
  return Date.now() < networkUnavailableUntil
}

/** Clear a stale request-failure cooldown when a suspended page becomes active again. */
export function refreshNetworkStatusAfterResume(): boolean {
  if (typeof window === 'undefined' || !readNavigatorOnLine()) return false
  networkUnavailableUntil = 0
  window.dispatchEvent(new Event(NETWORK_STATUS_REFRESH_EVENT))
  return true
}

/** Avoid slow failed fetches and console noise while offline. */
export function shouldSkipNetworkRequests(): boolean {
  return !readOnlineStatus()
}

const onlineSubscribers = new Set<(isOnline: boolean) => void>()
const onlineEvents = ['online', 'offline', NETWORK_UNAVAILABLE_EVENT,
  NETWORK_STATUS_REFRESH_EVENT, APP_SERVER_REACHABILITY_EVENT] as const
let subscribedWindow: Window | undefined
const notifyOnlineSubscribers = () => {
  const status = readOnlineStatus()
  for (const listener of onlineSubscribers) listener(status)
}

export function subscribeOnlineStatus(listener: (isOnline: boolean) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  // Each mounted symbol subscribes to this status. Share the browser listeners
  // instead of registering five DOM handlers per symbol during every switch.
  const subscriber = (status: boolean) => listener(status)
  onlineSubscribers.add(subscriber)
  if (!subscribedWindow) {
    subscribedWindow = window
    for (const event of onlineEvents) subscribedWindow.addEventListener(event, notifyOnlineSubscribers)
  }
  return () => {
    onlineSubscribers.delete(subscriber)
    if (onlineSubscribers.size === 0 && subscribedWindow) {
      for (const event of onlineEvents) subscribedWindow.removeEventListener(event, notifyOnlineSubscribers)
      subscribedWindow = undefined
    }
  }
}

function setAppServerReachable(reachable: boolean): void {
  if (appServerReachable === reachable) return
  appServerReachable = reachable
  window.dispatchEvent(new Event(APP_SERVER_REACHABILITY_EVENT))
}

/**
 * Check whether the origin serving the editor is reachable.
 * A HEAD request avoids downloading the app shell and is not fulfilled by the
 * development service worker, so a stopped Vite process is detected reliably.
 */
export async function probeAppServerReachability(timeoutMs = 2_000): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return true
  if (!readNavigatorOnLine()) return false

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch('/', {
      method: 'HEAD',
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
    setAppServerReachable(response.ok)
    return response.ok
  } catch {
    setAppServerReachable(false)
    return false
  } finally {
    window.clearTimeout(timeout)
  }
}

/**
 * Detect the local half-running state where the browser is online but the editor
 * development server has stopped.
 */
export function startDevAppServerConnectivityMonitor(intervalMs = 5_000): () => void {
  if (typeof window === 'undefined') return () => {}

  const probe = () => {
    void probeAppServerReachability()
  }
  const onOnline = () => probe()
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') probe()
  }

  const interval = window.setInterval(probe, intervalMs)
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    window.clearInterval(interval)
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
