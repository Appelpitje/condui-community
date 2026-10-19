import { ensureInstallationFeedTopology, getPanelFeedProjection } from '@/lib/feedTopology'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { Installation, Panel } from '@/types/schema'
import type { OffGridSupplyAssembly } from '@/types/supplyAssembly'
import { isSupplyTransformer } from '@/lib/electrical/supplyTransformer'

export function panelHasMainBusProtection(panel: Panel): boolean {
  return panel.protections.some((protection) => {
    const circuits = protection.circuits ?? []
    return (
      circuits.length === 0 ||
      circuits.some((circuit) => circuit.supplySource?.kind !== 'converter-backup')
    )
  })
}

function panelHasComplexSupplyTopology(
  panel: Panel,
  installation: Installation,
  rootPanels: Panel[]
): boolean {
  const devices = getPanelFeedProjection(installation, rootPanels, panel)?.devices ?? []
  return devices.some(
    (device) =>
      device.symbol === 'source_changeover' ||
      device.type === 'conversion' ||
      device.supplyPath === 'converter-branch' ||
      device.supplyPath === 'backup'
  )
}

function supplyAttachmentTargetsPanel(
  installation: Installation,
  rootPanels: Panel[],
  attachment:
    | OffGridSupplyAssembly['incomingAttachment']
    | OffGridSupplyAssembly['loadHandoffs'][number]['target'],
  panelId: string
): boolean {
  if (
    (attachment.kind === 'panel-input' ||
      attachment.kind === 'panel-bus-input' ||
      attachment.kind === 'circuit-input') &&
    attachment.panelId === panelId
  ) {
    return true
  }
  return (
    attachment.kind === 'root-feed' &&
    ensureInstallationFeedTopology(installation, rootPanels).rootFeeds.some(
      (feed) => feed.id === attachment.rootFeedId && feed.panelId === panelId
    )
  )
}

export type SupplyAssemblyPanelRole = {
  linked: boolean
  ownsAssembly: boolean
  ownsVisualTopology: boolean
}

export function getSupplyAssemblyPanelRole(
  project: ProjectWithOptionalV2Electrical,
  installation: Installation,
  rootPanels: Panel[],
  panelId: string
): SupplyAssemblyPanelRole {
  let linked = false
  let ownsAssembly = false
  let ownsVisualTopology = false
  for (const assembly of selectProjectSupplyAssemblies(project)) {
    const incomingTargetsPanel = supplyAttachmentTargetsPanel(
      installation,
      rootPanels,
      assembly.incomingAttachment,
      panelId
    )
    const handoffTargetsPanel = assembly.loadHandoffs.some((handoff) =>
      supplyAttachmentTargetsPanel(installation, rootPanels, handoff.target, panelId)
    )
    if (!incomingTargetsPanel && !handoffTargetsPanel) continue
    linked = true
    if (!incomingTargetsPanel) continue
    ownsAssembly = true
    if (
      assembly.nodes.some((node) => node.kind !== 'utility-source' && node.kind !== 'panel-handoff')
    ) {
      ownsVisualTopology = true
    }
  }
  return { linked, ownsAssembly, ownsVisualTopology }
}

export function isPanelSupplyFrameDetached(
  project: ProjectWithOptionalV2Electrical,
  panelId: string | undefined
): boolean {
  if (!panelId) return false
  const rootPanels = getProjectElectricalPanels(project)
  const installation = getProjectElectricalInstallation(project)
  const panel = rootPanels.find((candidate) => candidate.id === panelId)
  if (!installation || !panel || panel.isMain !== true) return false

  // An MV source remains outside the board even before its first circuit exists.
  if (getPanelFeedProjection(installation, rootPanels, panel)?.devices.some(isSupplyTransformer))
    return true

  const hasComplexSupply =
    panelHasComplexSupplyTopology(panel, installation, rootPanels) ||
    getSupplyAssemblyPanelRole(project, installation, rootPanels, panelId).ownsVisualTopology
  return hasComplexSupply && (panelHasMainBusProtection(panel) || rootPanels.length > 1)
}

/** Resolve legacy/shared supply devices to the detached panel frame that paints them. */
export function isSupplyDeviceInDetachedFrame(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string,
  panelId: string | undefined
): boolean {
  if (panelId) return isPanelSupplyFrameDetached(project, panelId)

  const rootPanels = getProjectElectricalPanels(project)
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return false
  return rootPanels.some(
    (panel) =>
      isPanelSupplyFrameDetached(project, panel.id) &&
      getPanelFeedProjection(installation, rootPanels, panel)?.devices.some(
        (device) => device.id === deviceId
      ) === true
  )
}
