import type { PanelGridModuleRef } from '@/types/schema'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { walkPanels } from './panelTree'
import { getPanelReadContext, memoizePanelReadContext } from './panelReadContext'

export interface ConverterBackupPanelFeed {
  panelId: string
  sourcePanelId: string
  converterId: string
  protectionId: string
  converterRef: PanelGridModuleRef
  protectionRef: PanelGridModuleRef
}

const backupFeedsContextKey = Symbol('converterBackupPanelFeeds')

function buildBackupFeeds(project: ProjectWithOptionalV2Electrical) {
  const panels = getProjectElectricalPanels(project)
  const byTarget = new Map<string, ConverterBackupPanelFeed>()
  for (const panel of walkPanels(panels)) {
    for (const protection of panel.protections) {
      const panelId = protection.subPanelId
      if (panelId == null || byTarget.has(panelId)) continue
      const circuit = (protection.circuits ?? []).find(
        (candidate) => candidate.supplySource?.kind === 'converter-backup'
      )
      const converterId = circuit?.supplySource?.converterId
      if (!converterId) continue
      byTarget.set(panelId, {
        panelId,
        sourcePanelId: panel.id,
        converterId,
        protectionId: protection.id,
        converterRef: { kind: 'trunkDevice', id: converterId, scope: 'supply' },
        protectionRef: { kind: 'protection', id: protection.id },
      })
    }
  }
  // Source queries historically returned targets in panel-tree order, which can
  // differ from the order of their source protection rows.
  const bySource = new Map<string, ConverterBackupPanelFeed[]>()
  for (const panel of walkPanels(panels)) {
    const feed = byTarget.get(panel.id)
    if (!feed) continue
    const feeds = bySource.get(feed.sourcePanelId) ?? []
    feeds.push(feed)
    bySource.set(feed.sourcePanelId, feeds)
  }
  return { byTarget, bySource }
}

function getBackupFeeds(project: ProjectWithOptionalV2Electrical) {
  const read = getPanelReadContext(project)
  return read
    ? memoizePanelReadContext(read, backupFeedsContextKey, () => buildBackupFeeds(project))
    : buildBackupFeeds(project)
}

/**
 * A standalone converter backup board is a root/sibling panel whose incoming
 * protection is still electrically owned by the converter circuit's source panel.
 * Panel-grid placement may live on the fed board without changing that ownership.
 */
export function findConverterBackupPanelFeed(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): ConverterBackupPanelFeed | null {
  const feed = getBackupFeeds(project).byTarget.get(panelId)
  return feed
    ? { ...feed, converterRef: { ...feed.converterRef }, protectionRef: { ...feed.protectionRef } }
    : null
}

export function findConverterBackupProtectionRefs(
  project: ProjectWithOptionalV2Electrical,
  converterId: string
): PanelGridModuleRef[] {
  const refs: PanelGridModuleRef[] = []
  const walk = (panels: ReturnType<typeof getProjectElectricalPanels>): void => {
    for (const panel of panels) {
      for (const protection of panel.protections) {
        if (
          (protection.circuits ?? []).some(
            (circuit) =>
              circuit.supplySource?.kind === 'converter-backup' &&
              circuit.supplySource.converterId === converterId
          )
        ) {
          refs.push({ kind: 'protection', id: protection.id })
        }
      }
      walk(panel.subPanels ?? [])
    }
  }
  walk(getProjectElectricalPanels(project))
  return refs
}

export function findConverterBackupPanelFeedsFromSource(
  project: ProjectWithOptionalV2Electrical,
  sourcePanelId: string
): ConverterBackupPanelFeed[] {
  return (getBackupFeeds(project).bySource.get(sourcePanelId) ?? []).map((feed) => ({
    ...feed,
    converterRef: { ...feed.converterRef },
    protectionRef: { ...feed.protectionRef },
  }))
}
