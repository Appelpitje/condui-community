import type { ProjectPaletteAction } from './projectPaletteActions'
import type { ProjectV2 } from '@/types/projectV2'
import type { Selection } from '@/types/ui'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { planPlaceExisting } from '@/lib/commands/project/commands/planPlaceExisting'
import {
  getProjectElectricalPanels,
  selectProjectAuxiliaryElectricalEnclosures,
} from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'
import { getPanelGridModulesInProject } from '@/lib/panel/panelGridModules'
import { panelGridModuleRefKey } from '@/lib/panel/panelGridLayout'
import { propertiesEdit } from '@/lib/commands/project/commands/propertiesEdit'
import { isAuxiliaryEnclosureShownOnPlan } from '@/lib/plan/auxiliaryEnclosurePlanPlacement'
import { getPanelModuleInventory } from '@/lib/panel/panelModuleInventory'
import { findTrunkDeviceInProject } from '@/lib/eendraad/findTrunkDeviceInProject'
import { getJunctionPanelIdentity } from '@/lib/junctionPanel/grid'

/** Palette actions for placing an existing electrical identity on the active plan floor. */
export function getPlacementPanelPaletteActions(
  project: ProjectV2,
  selection: Selection,
  activeFloorId: string | null,
  activePanelId: string | null = null
): ProjectPaletteAction[] {
  const actions: ProjectPaletteAction[] = []
  if (activeFloorId && selection.ids.length === 1) {
    const floor = selectProjectBuildingFloors(project).find(({ id }) => id === activeFloorId)
    const selectedDevice =
      selection.type === 'trunkDevice'
        ? findTrunkDeviceInProject(project, selection.ids[0]!)
        : undefined
    const target =
      selection.type === 'endpoint'
        ? { kind: 'endpoint' as const, id: selection.ids[0]! }
        : selection.type === 'trunkDevice'
          ? selectedDevice &&
            (selectedDevice.type === 'junction_panel' || selectedDevice.symbol === 'junction_panel')
            ? {
                kind: 'junctionPanel' as const,
                identity: getJunctionPanelIdentity(selectedDevice) ?? '',
              }
            : { kind: 'trunkDevice' as const, id: selection.ids[0]! }
          : selection.type === 'ground'
            ? { kind: 'earthing' as const }
            : selection.type === 'panel'
              ? { kind: 'panel' as const, id: selection.ids[0]! }
              : null
    if (floor && target && (target.kind !== 'junctionPanel' || target.identity.length > 0)) {
      const layer = ('layers' in floor ? floor.layers?.[0] : undefined) ?? 'electrical'
      const input = { target, floorId: floor.id, layer, pos: { x: 400, y: 300 } }
      if (planPlaceExisting.check(project, input).ok)
        actions.push({
          id: 'plan.placeExisting',
          labelKey: 'commandPalette.placeExistingOnPlan',
          fields: [
            {
              name: 'x',
              labelKey: 'commandPalette.fields.x',
              value: '400',
              type: 'number',
              step: 'any',
            },
            {
              name: 'y',
              labelKey: 'commandPalette.fields.y',
              value: '300',
              type: 'number',
              step: 'any',
            },
          ],
          invocation: (values) => ({
            id: 'plan.placeExisting',
            input: {
              target,
              floorId: floor.id,
              layer,
              pos: { x: Number(values.x), y: Number(values.y) },
            },
          }),
        })
    }
  }

  const panelId =
    selection.type === 'panel' && selection.ids.length === 1 ? selection.ids[0]! : activePanelId
  if (!panelId) return actions
  const panel = findPanelById(getProjectElectricalPanels(project), panelId)
  if (!panel) return actions
  const visibleRefs = getPanelGridModulesInProject(project, panelId).map(({ ref }) => ref)
  const hiddenKeys = getPanelModuleInventory(project, panelId)
    .filter((module) => !module.visible)
    .map((module) => module.key)
  const visibilityAction = (moduleRefKey: string, visible: boolean) => ({
    kind: 'panelModuleVisibility' as const,
    panelId,
    moduleRefKey,
    visible,
  })
  const hideActions = visibleRefs
    .map((ref) => visibilityAction(panelGridModuleRefKey(ref), false))
    .filter((action) => propertiesEdit.check(project, { edits: [], actions: [action] }).ok)
  const hide = { id: 'properties.edit', input: { edits: [], actions: hideActions } }
  if (hideActions.length)
    actions.push({
      id: 'panel.hideAllModules',
      labelKey: 'commandPalette.hideAllPanelModules',
      fields: [],
      invocation: () => hide,
    })
  const showActions = hiddenKeys
    .map((moduleRefKey) => visibilityAction(moduleRefKey, true))
    .filter((action) => propertiesEdit.check(project, { edits: [], actions: [action] }).ok)
  const show = { id: 'properties.edit', input: { edits: [], actions: showActions } }
  if (showActions.length)
    actions.push({
      id: 'panel.showAllModules',
      labelKey: 'commandPalette.showAllPanelModules',
      fields: [],
      invocation: () => show,
    })

  const ownedEnclosures = selectProjectAuxiliaryElectricalEnclosures(project).filter(
    (enclosure) => enclosure.ownerPanelId === panelId
  )
  for (const visible of [true, false]) {
    const visibilityActions = ownedEnclosures
      .filter((enclosure) => isAuxiliaryEnclosureShownOnPlan(project, enclosure) !== visible)
      .map((enclosure) => ({
        kind: 'auxiliaryPlanVisibility' as const,
        enclosureId: enclosure.id,
        visible,
      }))
      .filter((action) => propertiesEdit.check(project, { edits: [], actions: [action] }).ok)
    if (!visibilityActions.length) continue
    const invocation = {
      id: 'properties.edit',
      input: { edits: [], actions: visibilityActions },
    }
    actions.push({
      id: visible ? 'panel.showAuxiliaryEnclosures' : 'panel.hideAuxiliaryEnclosures',
      labelKey: visible
        ? 'commandPalette.showAuxiliaryEnclosures'
        : 'commandPalette.hideAuxiliaryEnclosures',
      fields: [],
      invocation: () => invocation,
    })
  }
  return actions
}
