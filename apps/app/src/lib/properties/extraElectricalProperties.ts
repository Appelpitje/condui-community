import { isSecondaryBusFeederAnchor } from '@/lib/wires/railWireRuns'
import type { ProjectV2 } from '@/types/projectV2'
import type { CommandCheck, EntityRef } from '@/lib/commands/project/types'
import type { ExtraElectricalPropertyEdit } from './electricalPropertySchemas'
import { findPanelById, walkPanels } from '@/lib/panel/panelTree'
import {
  getProjectElectricalPanels,
  getProjectElectricalInstallation,
  selectProjectAuxiliaryElectricalEnclosures,
  selectProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'
import { findTrunkDeviceInProject } from '@/lib/eendraad/findTrunkDeviceInProject'
import { updatePanelPropertiesInProject } from './electricalPropertyMutations'
import { updatePanelGridInProject } from '@/lib/panel/panelGridMutations'
import {
  updateSharedJunctionPanelGrid,
  updateJunctionPanelTerminal,
  getJunctionPanelTerminal,
  getJunctionPanelGridView,
} from '@/lib/junctionPanel/grid'
import { buildElectricalStructureSnapshot } from '@/lib/electricalStructure/builder'
import { editWireRunAtAnchor, type WireRunChanges } from '@/lib/wires/editWireRun'
import { findWireRunForAnchor, selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { normalizePatch, patchChanges } from './propertyPatch'
import type { CableSpec, Panel, PanelGridConfig } from '@/types/schema'
function endpoint(project: ProjectV2, id: string) {
  for (const panel of walkPanels(getProjectElectricalPanels(project)))
    for (const circuit of [
      ...panel.circuits,
      ...panel.protections.flatMap((p) => p.circuits ?? []),
    ]) {
      const found = circuit.endpoints.find((e) => e.id === id)
      if (found) return found
    }
  return undefined
}
function resolve(
  project: ProjectV2,
  edit: ExtraElectricalPropertyEdit,
  id: string
): object | undefined {
  if (edit.kind === 'panel' || edit.kind === 'panelGrid') {
    const p = findPanelById(getProjectElectricalPanels(project), id)
    return edit.kind === 'panel' ? p : (p?.gridView ?? (p ? {} : undefined))
  }
  if (edit.kind === 'junctionPanelGrid' || edit.kind === 'junctionPanelTerminal') {
    const d = findTrunkDeviceInProject(project, id)
    if (d?.type !== 'junction_panel' && d?.symbol !== 'junction_panel') return undefined
    return edit.kind === 'junctionPanelGrid'
      ? getJunctionPanelGridView(d)
      : getJunctionPanelTerminal(d)
  }
  if (edit.kind === 'auxiliaryEnclosure')
    return selectProjectAuxiliaryElectricalEnclosures(project).find((e) => e.id === id)
  if (edit.kind === 'supplyConnection')
    return selectProjectSupplyAssemblies(project)
      .find((a) => a.id === edit.assemblyId)
      ?.connections.find((c) => c.id === id)
  if (edit.kind === 'rootFeed')
    return getProjectElectricalInstallation(project)?.feedTopology?.rootFeeds.find(
      (f) => f.id === id
    )
  if (edit.kind === 'rootFeedWireSection') {
    const feed = getProjectElectricalInstallation(project)?.feedTopology?.rootFeeds.find(
      (f) => f.id === id
    )
    return feed ? (feed.wireSections?.[edit.sectionKey] ?? { cable: edit.defaultCable }) : undefined
  }
  if (edit.kind === 'domoticaOutputWire') {
    const e = endpoint(project, id)
    const props = e?.domoticaProps
    if (!props) return undefined
    const count =
      edit.outputGroup === 'control'
        ? (props.switchCount ?? 0)
        : Math.max(1, props.endpointCount ?? 1)
    if (edit.outputIndex >= count) return undefined
    return (
      (edit.outputGroup === 'control' ? props.controlOutputWires : props.endpointOutputWires)?.[
        edit.outputIndex
      ] ?? {}
    )
  }
  const edge = buildElectricalStructureSnapshot(project).relationships.find(
    (e) => e.properties?.wireAnchor === id
  )
  if (!edge) return undefined
  const run = findWireRunForAnchor(selectProjectWireRuns(project), id)
  return run
    ? { ...run, lengthM: run.segmentLengths?.[id] }
    : {
        cable:
          (edge.properties?.wire as { cable?: CableSpec } | undefined)?.cable ?? edit.defaultCable,
      }
}
export function checkExtraElectricalPropertyEdit(
  project: ProjectV2,
  edit: ExtraElectricalPropertyEdit
): CommandCheck {
  for (const id of edit.ids) {
    const current = resolve(project, edit, id)
    if (!current)
      return {
        ok: false,
        code: 'stale_target',
        message: 'The electrical property target no longer exists',
      }
    if (edit.kind === 'canonicalWire' && edit.set.medium === 'busbar') {
      const edge = buildElectricalStructureSnapshot(project).relationships.find(
        (e) => e.properties?.wireAnchor === id
      )
      const medium = (edge?.properties?.wire as { medium?: string } | undefined)?.medium
      if (!edge?.properties?.wireBusGroup && medium !== 'busbar' && !isSecondaryBusFeederAnchor(id))
        return { ok: false, code: 'invalid_medium', message: 'This connection cannot be a busbar' }
    }
    const next = {
      ...current,
      ...normalizePatch(current as Record<string, unknown>, edit.set as Record<string, unknown>),
    } as Record<string, unknown>
    const cable =
      edit.kind === 'supplyConnection'
        ? (next.wireProperties as { cable?: CableSpec } | undefined)?.cable
        : (next.cable as CableSpec | undefined)
    if ('phaseAssignment' in edit.set) {
      const phase = next.phaseAssignment as { kind?: string; phases?: string[] } | undefined
      if (phase && (!phase.kind || !Array.isArray(phase.phases)))
        return {
          ok: false,
          code: 'invalid_phase',
          message: 'Phase assignment properties are incomplete',
        }
    }
    if (
      (edit.kind === 'rootFeedWireSection' && !cable) ||
      (cable && (!cable.kind || !cable.conductors || !cable.sectionMm2))
    )
      return { ok: false, code: 'invalid_cable', message: 'Cable properties are incomplete' }
  }
  return { ok: true }
}
export function applyExtraElectricalPropertyEdit(
  project: ProjectV2,
  edit: ExtraElectricalPropertyEdit
): EntityRef[] {
  const changed: EntityRef[] = []
  for (const id of edit.ids) {
    const current = resolve(project, edit, id)
    if (!current) continue
    const patch = normalizePatch(
      current as Record<string, unknown>,
      edit.set as Record<string, unknown>
    )
    if (!patchChanges(current as Record<string, unknown>, patch)) continue
    if (edit.kind === 'panel') {
      updatePanelPropertiesInProject(project, id, patch as Partial<Panel>)
      changed.push({ kind: 'panel', id })
    } else if (edit.kind === 'panelGrid') {
      updatePanelGridInProject(project, id, patch as Partial<PanelGridConfig>)
      changed.push({ kind: 'panel', id })
    } else if (edit.kind === 'junctionPanelGrid') {
      updateSharedJunctionPanelGrid(project, id, patch as Partial<PanelGridConfig>)
      changed.push({ kind: 'trunkDevice', id })
    } else if (edit.kind === 'junctionPanelTerminal') {
      updateJunctionPanelTerminal(project, id, patch)
      changed.push({ kind: 'trunkDevice', id })
    } else if (edit.kind === 'rootFeedWireSection') {
      const feed = getProjectElectricalInstallation(project)!.feedTopology!.rootFeeds.find(
        (f) => f.id === id
      )!
      feed.wireSections ??= {}
      feed.wireSections[edit.sectionKey] = { ...current, ...patch } as never
      changed.push({ kind: 'installation', id })
    } else if (edit.kind === 'domoticaOutputWire') {
      const e = endpoint(project, id)!
      const key = edit.outputGroup === 'control' ? 'controlOutputWires' : 'endpointOutputWires'
      const wires = e.domoticaProps![key] ?? []
      while (wires.length <= edit.outputIndex) wires.push({})
      wires[edit.outputIndex] = { ...wires[edit.outputIndex], ...patch }
      e.domoticaProps![key] = wires
      changed.push({ kind: 'endpoint', id })
    } else if (edit.kind === 'canonicalWire') {
      editWireRunAtAnchor(
        project,
        id,
        (current as { cable: CableSpec }).cable,
        patch as WireRunChanges
      )
      changed.push({ kind: 'element', id })
    } else {
      Object.assign(current, patch)
      changed.push({
        kind: edit.kind === 'auxiliaryEnclosure' ? 'auxiliaryEnclosure' : 'installation',
        id,
      })
    }
  }
  return changed
}

export function electricalPropertyTargetExists(project: ProjectV2, id: string) {
  return !!endpoint(project, id) || !!findTrunkDeviceInProject(project, id)
}
