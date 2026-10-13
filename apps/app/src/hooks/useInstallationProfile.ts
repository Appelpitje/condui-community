import { resolveInstallationProfile } from '@/lib/installationProfile'
import { getProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import { useProjectStore } from '@/stores/projectStore'

export function useInstallationProfile() {
  return useProjectStore((state) =>
    resolveInstallationProfile(
      state.currentProject ? getProjectElectricalInstallation(state.currentProject) : undefined
    )
  )
}
