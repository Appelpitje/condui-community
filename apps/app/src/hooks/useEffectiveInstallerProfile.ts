import { useEffect } from 'react'
import { useInstallerProfileStore } from '@/stores/installerProfileStore'
import type { InstallerProfile } from '@/lib/installerProfile'
import { useEditionFeatureAvailability } from '@/hooks/useEditionFeatureAvailability'

type InstallerOverride = {
  name: string
  address: InstallerProfile['address']
  companyNumber?: string
  email?: string
  mobile?: string
  phone?: string
  signatureDataUrl?: string | null
  logoDataUrl?: string | null
}

type ProjectWithInstallerOverride = {
  project: {
    id: string
    installerOverride?: InstallerOverride
  }
}

function normalizeInstallerProfile(
  profile: InstallerProfile | InstallerOverride
): InstallerProfile {
  return {
    name: profile.name,
    address: profile.address,
    companyNumber: profile.companyNumber ?? '',
    email: profile.email ?? '',
    mobile: profile.mobile ?? '',
    phone: profile.phone ?? '',
    signatureDataUrl: profile.signatureDataUrl ?? null,
    logoDataUrl: profile.logoDataUrl ?? null,
  }
}

/**
 * Returns the effective installer profile for the current project:
 * project.project.installerOverride if set, otherwise the global installer profile.
 * Subscribes to the installer profile store so the frame updates when the user saves in Settings.
 */
export function useEffectiveInstallerProfile(project: ProjectWithInstallerOverride | null): {
  profile: InstallerProfile | null
  globalProfile: InstallerProfile | null
  isLoading: boolean
} {
  const globalProfile = useInstallerProfileStore((s) => s.profile)
  const loadProfile = useInstallerProfileStore((s) => s.loadProfile)
  const { installerBranding } = useEditionFeatureAvailability(project?.project.id)

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const rawProfile: InstallerProfile | null = project?.project?.installerOverride
    ? normalizeInstallerProfile(project.project.installerOverride)
    : globalProfile
      ? normalizeInstallerProfile(globalProfile)
      : null
  const profile: InstallerProfile | null =
    installerBranding || !rawProfile
      ? rawProfile
      : {
          ...rawProfile,
          companyNumber: rawProfile.companyNumber ?? '',
          email: rawProfile.email ?? '',
          mobile: rawProfile.mobile ?? '',
          phone: rawProfile.phone ?? '',
          logoDataUrl: null,
          signatureDataUrl: null,
        }

  return {
    profile,
    globalProfile,
    isLoading: globalProfile === null && !project?.project?.installerOverride,
  }
}
