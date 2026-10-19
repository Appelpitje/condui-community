import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { findPanelById } from '@/lib/panel/panelTree'
import { getPanelFeedOrganization } from '@/lib/panel/panelFeedOrganization'
import type { TrunkDevice } from '@/types/schema'
import {
  getConverterInputTapBlocker,
  getRequestedChangeoverGridSource,
  resolveEffectiveChangeoverGridSource,
  type ChangeoverGridSource,
  type ChangeoverGridSourceUnavailableReason,
} from './changeoverGridSource'
import {
  reconcileChangeoverSupplyAssembly,
  reconcileSupplyAssemblyBranchProtections,
} from './editorIntegration'

export interface ChangeoverGridSourceAvailability {
  /** True when `converter-input` can be selected and becomes effective. */
  available: boolean
  /** Why `converter-input` cannot be effective. */
  reason?: ChangeoverGridSourceUnavailableReason
  changeoverId?: string
  converterId?: string
  /** Persisted choice; missing on the device means `grid`. */
  requested: ChangeoverGridSource
  /** What the supply graph uses after the availability rules. */
  effective: ChangeoverGridSource
}

function findPanelChangeoverDevices(
  devices: readonly TrunkDevice[]
): { changeover?: TrunkDevice; converter?: TrunkDevice } {
  const changeovers = devices.filter((device) => device.symbol === 'source_changeover')
  const converters = devices.filter(
    (device) => device.supplyPath === 'backup' && device.type === 'conversion'
  )
  return {
    changeover: changeovers.length === 1 ? changeovers[0] : undefined,
    converter: converters.length === 1 ? converters[0] : undefined,
  }
}

/**
 * Read-only: whether a main panel's changeover grid input can be fed from its backup
 * converter's grid-input leg. Never normalizes the stored feed topology.
 */
export function getChangeoverGridSourceAvailability(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): ChangeoverGridSourceAvailability {
  const installation = getProjectElectricalInstallation(project)
  const panel = findPanelById(getProjectElectricalPanels(project), panelId)
  const devices = (installation?.feedTopology?.rootFeeds ?? [])
    .filter((feed) => feed.panelId === panelId)
    .flatMap((feed) => feed.trunkDevices ?? [])
  const { changeover, converter } = findPanelChangeoverDevices(devices)
  const requested = getRequestedChangeoverGridSource(changeover)
  let reason = getConverterInputTapBlocker({ changeover, converter, panel })
  if (!reason && (!panel || getPanelFeedOrganization(project, panel) !== 'split-switchable')) {
    reason = 'not-split-switchable'
  }
  return {
    available: !reason,
    ...(reason ? { reason } : {}),
    ...(changeover ? { changeoverId: changeover.id } : {}),
    ...(converter ? { converterId: converter.id } : {}),
    requested,
    effective: reason
      ? 'grid'
      : resolveEffectiveChangeoverGridSource({ changeover, converter, panel }),
  }
}

/**
 * Mutates one project draft: switches where the panel changeover's grid input is tapped and
 * rebuilds the supply graph. Device placements are never changed, so switching back and forth
 * is lossless: with the converter tap, `input-leg` devices are shared below the tap and
 * `converter-leg` devices feed only the converter; with the grid tap all of them stay on the
 * converter leg. Returns false when nothing changed or the request is unavailable.
 */
export function setChangeoverGridSourceInProject(
  project: ProjectWithOptionalV2Electrical,
  panelId: string,
  source: ChangeoverGridSource
): boolean {
  const availability = getChangeoverGridSourceAvailability(project, panelId)
  if (!availability.changeoverId) return false
  if (source === 'converter-input' && !availability.available) return false
  if (availability.requested === source) return false
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return false
  const changeover = ensureInstallationFeedTopology(installation, getProjectElectricalPanels(project))
    .rootFeeds.filter((feed) => feed.panelId === panelId)
    .flatMap((feed) => feed.trunkDevices ?? [])
    .find((device) => device.id === availability.changeoverId)
  if (!changeover) return false
  if (source === 'converter-input') changeover.changeoverGridSource = 'converter-input'
  else delete changeover.changeoverGridSource
  reconcileSupplyAssemblyBranchProtections(project, panelId)
  reconcileChangeoverSupplyAssembly(project, changeover)
  return true
}

/**
 * Hover preview: the project as it would be after switching, without touching the input.
 * Returns null when the switch would not change anything or is unavailable.
 */
export function simulateChangeoverGridSourceOnProject<T extends ProjectWithOptionalV2Electrical>(
  project: T,
  panelId: string,
  source: ChangeoverGridSource
): T | null {
  const cloned = JSON.parse(JSON.stringify(project)) as T
  return setChangeoverGridSourceInProject(cloned, panelId, source) ? cloned : null
}

export interface ChangeoverGridSourceControlState {
  changeoverId: string
  /** The option shown as selected: what the supply graph uses. */
  selected: ChangeoverGridSource
  /** Set when `converter-input` cannot be chosen; the control stays visible. */
  converterInputBlocker?: 'converter-grid-input-disconnected'
}

/**
 * Read-only: whether the sidebar shows the port-1 source choice for a panel. It applies to
 * split-switchable panels with exactly one changeover and one backup converter; a
 * disconnected inverter grid input keeps the choice visible with the inverter option blocked.
 */
export function getChangeoverGridSourceControlState(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): ChangeoverGridSourceControlState | null {
  const availability = getChangeoverGridSourceAvailability(project, panelId)
  if (!availability.changeoverId || !availability.converterId) return null
  const panel = findPanelById(getProjectElectricalPanels(project), panelId)
  if (!panel || getPanelFeedOrganization(project, panel) !== 'split-switchable') return null
  if (availability.reason && availability.reason !== 'converter-grid-input-disconnected') return null
  return {
    changeoverId: availability.changeoverId,
    selected: availability.effective,
    ...(availability.reason ? { converterInputBlocker: availability.reason } : {}),
  }
}
