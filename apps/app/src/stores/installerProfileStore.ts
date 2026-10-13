/**
 * In-memory cache of the installer profile so the eendraad frame (InfoBlock)
 * updates immediately when the user saves in Settings. Persistence stays in
 * The edition-specific profile adapter owns persistence.
 */

import { create } from 'zustand'
import { getInstallerProfile } from '@/lib/installerProfile'
import type { InstallerProfile } from '@/lib/installerProfile'

interface InstallerProfileState {
  profile: InstallerProfile | null
  /**
   * Load the profile into the store once per signed-in user. Every panel frame
   * calls this on mount, so repeat calls reuse the cached profile or the load
   * already in flight instead of reading the profile row again. Pass
   * `force` to re-read it.
   */
  loadProfile: (options?: { force?: boolean }) => Promise<void>
  /** Update store only (call after persisting via setInstallerProfile). */
  setProfile: (profile: InstallerProfile) => void
  /** Drop cached profile when the signed-in user changes. */
  resetProfile: () => void
}

let inFlightLoad: Promise<void> | null = null
// Bumped by resetProfile so a load started for the previous user cannot land.
let loadGeneration = 0
let profileIsFresh = false
let consecutiveFallbacks = 0
let retryAt = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null

function clearProfileRetry(): void {
  if (retryTimer !== null) clearTimeout(retryTimer)
  retryTimer = null
}

export const useInstallerProfileStore = create<InstallerProfileState>()((set, get) => ({
  profile: null,

  loadProfile: (options) => {
    if (!options?.force) {
      if (inFlightLoad) return inFlightLoad
      if (get().profile && (profileIsFresh || Date.now() < retryAt)) return Promise.resolve()
    }
    clearProfileRetry()
    const generation = ++loadGeneration
    let cloudFallback = false
    const load = getInstallerProfile({ onCloudFallback: () => { cloudFallback = true } })
      .then((profile) => {
        if (generation !== loadGeneration) return
        profileIsFresh = !cloudFallback
        set({ profile })
        if (cloudFallback) {
          consecutiveFallbacks += 1
          const delay = Math.min(60_000 * 2 ** Math.min(consecutiveFallbacks - 1, 3), 300_000)
          retryAt = Date.now() + delay
          retryTimer = setTimeout(() => {
            retryTimer = null
            void get().loadProfile()
          }, delay)
        } else {
          consecutiveFallbacks = 0
          retryAt = 0
        }
      })
      .finally(() => {
        if (inFlightLoad === load) inFlightLoad = null
      })
    inFlightLoad = load
    return load
  },

  setProfile: (profile) => {
    loadGeneration += 1
    inFlightLoad = null
    clearProfileRetry()
    profileIsFresh = true
    consecutiveFallbacks = 0
    retryAt = 0
    set({ profile })
  },

  resetProfile: () => {
    loadGeneration += 1
    inFlightLoad = null
    clearProfileRetry()
    profileIsFresh = false
    consecutiveFallbacks = 0
    retryAt = 0
    set({ profile: null })
  },
}))

/** Profile for read-only uses (author labels); shares the store's single load. */
export async function loadCachedInstallerProfile(): Promise<InstallerProfile | null> {
  await useInstallerProfileStore.getState().loadProfile()
  return useInstallerProfileStore.getState().profile
}
