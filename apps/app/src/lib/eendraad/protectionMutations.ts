import type { ProtectionDevice } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import {
  ensureRcboSensitivityOnProtection,
  maybeApplyAutomaticEendraadNamingForPanel,
} from '@/lib/eendraad/projectElectricalDomain'
import { findPanelById } from '@/lib/panel/panelTree'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'

/** Adds a protection to a panel and refreshes automatic naming. False when the panel is missing. */
export function addProtectionToProject(
  project: ProjectV2,
  panelId: string,
  protection: ProtectionDevice
): boolean {
  const panel = findPanelById(getEditableProjectElectricalPanels(project), panelId)
  if (!panel) return false
  if (!protection.circuits) protection.circuits = []
  ensureRcboSensitivityOnProtection(protection)
  panel.protections.push(protection)
  maybeApplyAutomaticEendraadNamingForPanel(project, panelId)
  return true
}
