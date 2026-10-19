import type { ProjectV2 } from '@/types/projectV2'
import type { CommandInvocation } from '../project'
import type { CommandInputField } from './types'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'

export interface FloorPaletteAction {
  id: string
  labelKey: string
  fields: CommandInputField[]
  invocation: (values: Record<string, string>) => CommandInvocation
}

/** Lifecycle actions for the current building; execution still rechecks command preconditions. */
export function getFloorPaletteActions(
  project: ProjectV2,
  activeFloorId: string | null
): FloorPaletteAction[] {
  const floors = selectProjectBuildingFloors(project)
  const actions: FloorPaletteAction[] = [
    {
      id: 'floor.create',
      labelKey: 'commandPalette.addFloor',
      fields: [{ name: 'name', labelKey: 'commandPalette.fields.name', value: '' }],
      invocation: (values) => ({ id: 'floor.create', input: { name: values.name } }),
    },
  ]
  const activeFloor = floors.find((floor) => floor.id === activeFloorId)
  if (activeFloor && floors.length > 1) {
    actions.push({
      id: 'floor.delete',
      labelKey: 'commandPalette.deleteFloor',
      fields: [],
      invocation: () => ({ id: 'floor.delete', input: { floorId: activeFloor.id } }),
    })
  }
  if (
    activeFloor &&
    (('planAssetId' in activeFloor && activeFloor.planAssetId) ||
      ('processedPlanAssetId' in activeFloor && activeFloor.processedPlanAssetId))
  ) {
    actions.push({
      id: 'plan.detachBackground',
      labelKey: 'commandPalette.removeBackground',
      fields: [],
      invocation: () => ({ id: 'plan.detachBackground', input: { floorId: activeFloor.id } }),
    })
    actions.push({
      id: 'plan.transformBackground',
      labelKey: 'commandPalette.transformBackground',
      fields: [
        {
          name: 'offsetX',
          labelKey: 'commandPalette.fields.offsetX',
          value: String(activeFloor.planImageOffset?.x ?? 0),
          type: 'number',
          step: 'any',
        },
        {
          name: 'offsetY',
          labelKey: 'commandPalette.fields.offsetY',
          value: String(activeFloor.planImageOffset?.y ?? 0),
          type: 'number',
          step: 'any',
        },
        {
          name: 'rotationDeg',
          labelKey: 'commandPalette.fields.rotationDeg',
          value: String(activeFloor.planImageRotationDeg ?? 0),
          type: 'number',
          step: 'any',
        },
        {
          name: 'opacity',
          labelKey: 'commandPalette.fields.opacity',
          value: String(activeFloor.planImageOpacity ?? 100),
          type: 'number',
          min: 0,
          max: 100,
        },
      ],
      invocation: (values) => ({
        id: 'plan.transformBackground',
        input: {
          floorId: activeFloor.id,
          offset: { x: Number(values.offsetX), y: Number(values.offsetY) },
          rotationDeg: Number(values.rotationDeg),
          opacity: Number(values.opacity),
        },
      }),
    })
  }
  return actions
}
