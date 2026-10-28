import type { Circuit, Panel, ProtectionDevice } from '@/types/schema'
import {
  getProjectElectricalInstallation,
  getEditableProjectElectricalInstallation,
  getEditableProjectElectricalPanels,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { isTerminalPanelFeederCircuit, resolvePanelSupplyLinksForSourcePanel } from '@/lib/eendraad/panelSupplyLink'

export type PreviewProject = ProjectWithOptionalV2Electrical

export interface EendraadPreviewChangeSet {
  project: PreviewProject
  /** Panels whose layout is affected by this simulated drop. */
  affectedPanelIds: string[]
  /** Circuits that were created or structurally changed (endpoints/branches/trunkDevices). */
  affectedCircuitIds: string[]
  /** Endpoints that were created by this drop. */
  createdEndpointIds: string[]
  /** Protections that were created (e.g. new MCB for nested circuit). */
  createdProtectionIds: string[]
  /** Trunk devices that were created on a circuit or supply. */
  createdTrunkDeviceIds: string[]
  /** Existing circuit trunk devices repositioned in this preview (same id). */
  movedTrunkDeviceIds: string[]
  /** Supply trunk devices created on installation.mainSupply.supplyTrunkDevices. */
  createdSupplyTrunkDeviceIds: string[]
  /** Ground trunk devices created on installation.groundTrunkDevices. */
  createdGroundTrunkDeviceIds: string[]
}

export function projectPanels(project: PreviewProject): Panel[] {
  return getProjectElectricalPanels(project)
}

export function mutableProjectPanels(project: PreviewProject): Panel[] {
  return getEditableProjectElectricalPanels(project)
}

export function projectInstallation(project: PreviewProject) {
  return getProjectElectricalInstallation(project)
}

export function mutableProjectInstallation(project: PreviewProject) {
  return getEditableProjectElectricalInstallation(project)
}

export function findPanelForCircuit(project: PreviewProject, circuitId: string): Panel | null {
  const stack = [...projectPanels(project)]
  while (stack.length) {
    const p = stack.pop()!
    if (p.circuits.some((c) => c.id === circuitId)) return p
    if (p.protections) {
      for (const prot of p.protections) {
        if (prot.circuits?.some((c) => c.id === circuitId)) return p
      }
    }
    if (p.subPanels?.length) stack.push(...p.subPanels)
  }
  return null
}

export function findCircuitInProject(project: PreviewProject, circuitId: string): Circuit | null {
  const panels: Panel[] = []
  const stack = [...projectPanels(project)]
  while (stack.length) {
    const p = stack.pop()!
    panels.push(p)
    if (p.subPanels?.length) stack.push(...p.subPanels)
  }
  for (const panel of panels) {
    const direct = panel.circuits.find((c) => c.id === circuitId)
    if (direct) return direct
    if (panel.protections) {
      for (const prot of panel.protections) {
        const fromProt = prot.circuits?.find((c) => c.id === circuitId)
        if (fromProt) return fromProt
      }
    }
  }
  return null
}

export function findProtectionByIdInProject(
  project: PreviewProject,
  protectionId: string
): ProtectionDevice | null {
  const stack = [...projectPanels(project)]
  while (stack.length) {
    const panel = stack.pop()!
    const protection = panel.protections?.find((p) => p.id === protectionId) ?? null
    if (protection) return protection
    if (panel.subPanels?.length) stack.push(...panel.subPanels)
  }
  return null
}

export function findProtectionByCircuitIdInProject(
  project: PreviewProject,
  circuitId: string
): ProtectionDevice | null {
  const stack = [...projectPanels(project)]
  while (stack.length) {
    const panel = stack.pop()!
    for (const protection of panel.protections ?? []) {
      if (protection.circuits?.some((c) => c.id === circuitId)) {
        return protection
      }
    }
    if (panel.subPanels?.length) stack.push(...panel.subPanels)
  }
  return null
}

export function countPanelsSim(panels: Panel[]): number {
  let count = 0
  const stack = [...panels]
  while (stack.length) {
    const panel = stack.pop()!
    count++
    if (panel.subPanels?.length) stack.push(...panel.subPanels)
  }
  return count
}

/**
 * Dedicated board feeders are terminal; mixed circuits retain their consumer drop previews.
 */
export function circuitIsTerminalPanelFeederSim(project: PreviewProject, circuitId: string): boolean {
  const stack: Panel[] = [...projectPanels(project)]
  while (stack.length) {
    const p = stack.pop()!
    for (const link of resolvePanelSupplyLinksForSourcePanel(project, p)) {
      if (link.feederCircuit?.id === circuitId && isTerminalPanelFeederCircuit(link.protection, link.feederCircuit)) return true
    }
    if (p.subPanels?.length) stack.push(...p.subPanels)
  }
  return false
}
