import type { ProjectV2 } from '@/types/projectV2'
import type { Selection } from '@/types/ui'
import { selectProjectFloorPlan } from '@/lib/projectV2/buildingFloors'
import { PLAN_GRAPHIC_ELEMENT_ASSETS } from '@/lib/plan/graphicElements'
import type { CommandInvocation } from '../project'
import { projectCommands } from '../project'
import type { CommandInputField } from './types'
import type { ProjectPaletteAction } from './projectPaletteActions'

const numeric = (
  name: string,
  value: number,
  min: number,
  max: number,
  step: number | 'any' = 1
): CommandInputField => ({
  name,
  labelKey: `commandPalette.fields.${name === 'width' ? 'planWidth' : name}`,
  value: String(value),
  type: 'number',
  min,
  max,
  step,
})

function available(project: ProjectV2, invocation: CommandInvocation): boolean {
  try {
    const { command, input } = projectCommands.parseOne(invocation)
    return command.check(project, input).ok
  } catch {
    return false
  }
}

/** Practical coordinate-based palette entry points to the same geometry commands used by the canvas. */
export function getBuildingPaletteActions(
  project: ProjectV2,
  selection: Selection,
  activeFloorId: string | null
): ProjectPaletteAction[] {
  if (!activeFloorId || !project.building.floors.some((floor) => floor.id === activeFloorId))
    return []
  const actions: ProjectPaletteAction[] = []
  const wallInput = (values: Record<string, string>) => ({
    kind: 'wall',
    floorId: activeFloorId,
    points: [
      { x: Number(values.startX), y: Number(values.startY) },
      { x: Number(values.endX), y: Number(values.endY) },
    ],
    thickness: Number(values.thickness),
  })
  const wallDefaults = [
    numeric('startX', 0, -1_000_000, 1_000_000),
    numeric('startY', 0, -1_000_000, 1_000_000),
    numeric('endX', 300, -1_000_000, 1_000_000),
    numeric('endY', 0, -1_000_000, 1_000_000),
    numeric('thickness', 20, 1, 500),
  ]
  if (
    available(project, {
      id: 'plan.createBuildingGeometry',
      input: wallInput({ startX: '0', startY: '0', endX: '300', endY: '0', thickness: '20' }),
    })
  )
    actions.push({
      id: 'plan.addWall',
      labelKey: 'commandPalette.addPlanWall',
      fields: wallDefaults,
      invocation: (values) => ({ id: 'plan.createBuildingGeometry', input: wallInput(values) }),
    })

  const plan = selectProjectFloorPlan(project, activeFloorId)
  const selectedWall =
    selection.type === 'wall' && selection.ids.length === 1
      ? plan?.walls.find((wall) => wall.id === selection.ids[0] && !wall.curve)
      : undefined
  if (selectedWall) {
    const input = (values: Record<string, string>) => ({
      floorId: activeFloorId,
      wallId: selectedWall.id,
      segmentIndex: Number(values.segment) - 1,
      t: Number(values.position),
    })
    actions.push({
      id: 'plan.splitWall',
      labelKey: 'commandPalette.splitWall',
      fields: [
        numeric('segment', 1, 1, selectedWall.points.length - 1),
        numeric('position', 0.5, 0.001, 0.999, 'any'),
      ],
      invocation: (values) => ({ id: 'plan.splitWall', input: input(values) }),
    })
  }
  if (plan) {
    const wallOptions = plan.walls
      .filter((wall) => !wall.curve)
      .map((wall, index) => {
        const first = wall.points[0]!
        const last = wall.points.at(-1)!
        return {
          value: wall.id,
          label: `${index + 1} · (${first.x}, ${first.y})–(${last.x}, ${last.y})`,
        }
      })
    for (const kind of ['door', 'window'] as const) {
      const input = (values: Record<string, string>) => ({
        kind,
        floorId: activeFloorId,
        wallId: values.wall,
        position: Number(values.position),
        width: Number(values.width),
      })
      const possible = wallOptions.filter((wall) =>
        available(project, {
          id: 'plan.createBuildingGeometry',
          input: input({
            wall: wall.value,
            position: '0.5',
            width: kind === 'door' ? '83' : '100',
          }),
        })
      )
      if (!possible.length) continue
      actions.push({
        id: kind === 'door' ? 'plan.addDoor' : 'plan.addWindow',
        labelKey: kind === 'door' ? 'commandPalette.addPlanDoor' : 'commandPalette.addPlanWindow',
        fields: [
          {
            name: 'wall',
            labelKey: 'commandPalette.fields.wall',
            value: possible[0]!.value,
            options: possible,
          },
          numeric('position', 0.5, 0, 1, 'any'),
          numeric('width', kind === 'door' ? 83 : 100, 1, 100_000),
        ],
        invocation: (values) => ({ id: 'plan.createBuildingGeometry', input: input(values) }),
      })
    }
  }

  const stairInput = (values: Record<string, string>) => ({
    kind: 'stair',
    floorId: activeFloorId,
    points: [
      { x: Number(values.startX), y: Number(values.startY) },
      { x: Number(values.endX), y: Number(values.endY) },
    ],
    width: Number(values.width),
    stepDepth: Number(values.stepDepth),
    cornerStyle: 'round',
    cornerMode: 'turn',
    showUpArrow: false,
    invertUpArrow: true,
  })
  const stairDefaults = {
    startX: '0',
    startY: '0',
    endX: '0',
    endY: '300',
    width: '90',
    stepDepth: '25',
  }
  if (available(project, { id: 'plan.createBuildingGeometry', input: stairInput(stairDefaults) }))
    actions.push({
      id: 'plan.addStair',
      labelKey: 'commandPalette.addPlanStair',
      fields: [
        numeric('startX', 0, -1_000_000, 1_000_000),
        numeric('startY', 0, -1_000_000, 1_000_000),
        numeric('endX', 0, -1_000_000, 1_000_000),
        numeric('endY', 300, -1_000_000, 1_000_000),
        numeric('width', 90, 1, 100_000),
        numeric('stepDepth', 25, 1, 100_000),
      ],
      invocation: (values) => ({ id: 'plan.createBuildingGeometry', input: stairInput(values) }),
    })

  const graphicInput = (values: Record<string, string>) => {
    const asset = PLAN_GRAPHIC_ELEMENT_ASSETS.find((candidate) => candidate.id === values.asset)
    return {
      kind: 'graphicElement',
      floorId: activeFloorId,
      elementKind: asset?.kind,
      assetId: asset?.id,
      pos: { x: Number(values.x), y: Number(values.y) },
      width: Number(values.width),
      height: Number(values.height),
      rotationDeg: 0,
      layer: 'floor-plan-graphics',
    }
  }
  const graphicOptions = PLAN_GRAPHIC_ELEMENT_ASSETS.map((asset) => ({
    value: asset.id,
    labelKey: asset.labelKey,
  }))
  const defaultGraphic = PLAN_GRAPHIC_ELEMENT_ASSETS[0]
  if (
    defaultGraphic &&
    available(project, {
      id: 'plan.createBuildingGeometry',
      input: graphicInput({ asset: defaultGraphic.id, x: '0', y: '0', width: '160', height: '80' }),
    })
  )
    actions.push({
      id: 'plan.addGraphicElement',
      labelKey: 'commandPalette.addPlanGraphic',
      fields: [
        {
          name: 'asset',
          labelKey: 'commandPalette.fields.asset',
          value: defaultGraphic.id,
          options: graphicOptions,
        },
        numeric('x', 0, -1_000_000, 1_000_000),
        numeric('y', 0, -1_000_000, 1_000_000),
        numeric('width', 160, 1, 100_000),
        numeric('height', 80, 1, 100_000),
      ],
      invocation: (values) => ({ id: 'plan.createBuildingGeometry', input: graphicInput(values) }),
    })

  return actions
}
