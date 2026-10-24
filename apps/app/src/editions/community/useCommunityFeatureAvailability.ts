export function useCloudTemplateDescriptionViewer() {
  return { viewerId: null, isLoading: false }
}

export function useEditionFeatureAvailability() {
  return {
    advancedPanelLabels: false,
    inspectionAgencyCatalog: false,
    installationDates: false,
    installationProfileSelection: true,
    installerBranding: false,
    synergridCatalog: false,
  }
}
