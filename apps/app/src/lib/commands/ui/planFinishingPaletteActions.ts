import type { ProjectV2 } from '@/types/projectV2'
import i18n from '@/i18n'
import type { Selection } from '@/types/ui'
import type { CommandInvocation } from '../project'
import type { CommandInputField } from './types'
import type { ProjectPaletteAction } from './projectPaletteActions'
import { projectCommands } from '../project'
import { deriveAutoPlanWireRoutes, mergePlanWireRoutes } from '@/lib/plan/planWiring'
import { selectProjectPlanWireRoutes } from '@/lib/projectV2/planWiring'
import { resolvePlanPlacement } from '@/lib/plan/placementMutations'
import { estimateCableRoutes } from '@/lib/cableRouting/estimateCableRoutes'
import { acceptedEstimateLengthM } from '@/lib/cableRouting/acceptedEstimateLength'
import { findWireRunForAnchor, selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { walkPanels } from '@/lib/panel/panelTree'
import { getAllEndpoints } from '@/lib/eendraad/projectElectricalDomain'

function valid(project: ProjectV2, invocation: CommandInvocation): boolean {
  try {
    const parsed = projectCommands.parseOne(invocation)
    return parsed.command.check(project, parsed.input).ok
  } catch {
    return false
  }
}

const textField = (name: string, value: string): CommandInputField => ({
  name,
  labelKey: `commandPalette.fields.${name}`,
  value,
  type: 'text',
})

const numberField = (
  name: string,
  value: number,
  min: number,
  max: number,
  step: number | 'any' = 1
): CommandInputField => ({
  name,
  labelKey: `commandPalette.fields.${name}`,
  value: String(value),
  type: 'number',
  min,
  max,
  step,
})

function action(
  id: string,
  labelKey: string,
  fields: CommandInputField[],
  commandId: string,
  input: (values: Record<string, string>) => Record<string, unknown>
): ProjectPaletteAction {
  return { id, labelKey, fields, invocation: (values) => ({ id: commandId, input: input(values) }) }
}

/** Read-only palette actions for plan annotations, schematic frames and wire finishing. */
export function getPlanFinishingPaletteActions(
  project: ProjectV2,
  selection: Selection,
  activePanelId: string | null,
  activeFloorId: string | null
): ProjectPaletteAction[] {
  const actions: ProjectPaletteAction[] = []
  const panels = [...walkPanels(getProjectElectricalPanels(project))]
  const notePanelId = panels.find((panel) => panel.id === activePanelId)?.id ?? panels[0]?.id
  const keepValid = (candidate: ProjectPaletteAction) => {
    const probe = candidate.invocation(
      Object.fromEntries(candidate.fields.map((field) => [field.name, field.value]))
    )
    if (valid(project, probe)) actions.push(candidate)
  }

  if (activeFloorId) {
    const note = action(
      'plan.addNote',
      'commandPalette.planAddNote',
      [
        numberField('x', 0, -100000, 100000, 'any'),
        numberField('y', 0, -100000, 100000, 'any'),
        textField('text', ''),
      ],
      'annotation.createNote',
      (values) => ({
        scope: 'sitplan',
        floorId: activeFloorId,
        pos: { x: Number(values.x), y: Number(values.y) },
        text: values.text || undefined,
      })
    )
    keepValid(note)
  }
  if (notePanelId) {
    keepValid(
      action(
        'eendraad.addNote',
        'commandPalette.eendraadAddNote',
        [
          numberField('x', 0, -100000, 100000, 'any'),
          numberField('y', 0, -100000, 100000, 'any'),
          textField('text', ''),
        ],
        'annotation.createNote',
        (values) => ({
          scope: 'oneWire',
          panelId: notePanelId,
          pos: { x: Number(values.x), y: Number(values.y) },
          text: values.text || undefined,
        })
      )
    )
  }

  const selectedMembers =
    selection.type === 'endpoint'
      ? selection.ids.map((id) => ({ id, kind: 'endpoint' }))
      : selection.type === 'protection'
        ? selection.ids.map((id) => ({ id, kind: 'protection' }))
        : selection.type === 'trunkDevice'
          ? selection.ids.map((id) => ({ id, kind: 'trunkDevice' }))
          : selection.type === 'ground'
            ? selection.ids.map((id) => ({ id, kind: 'ground' }))
            : []
  if (selectedMembers.length) {
    const kinds = new Set(selectedMembers.map((item) => item.kind))
    const fields = {
      contentType:
        kinds.size === 1
          ? (selectedMembers[0]!.kind as 'endpoint' | 'protection' | 'trunkDevice' | 'ground')
          : ('mixed' as const),
      contentIds: selectedMembers.map((item) => item.id),
      contentItems: selectedMembers,
    }
    const framePanelId = [...panels]
      .sort((a, b) => Number(b.id === activePanelId) - Number(a.id === activePanelId))
      .find((panel) =>
        valid(project, { id: 'eendraad.createFrame', input: { panelId: panel.id, fields } })
      )?.id
    const candidate = action(
      'eendraad.createFrame',
      'commandPalette.eendraadCreateFrame',
      [
        textField('title', ''),
        numberField('fontSize', 10, 6, 24),
        {
          name: 'titlePosition',
          labelKey: 'commandPalette.fields.titlePosition',
          value: 'inside',
          options: [
            { value: 'inside', labelKey: 'commandPalette.values.inside' },
            { value: 'outside', labelKey: 'commandPalette.values.outside' },
          ],
        },
      ],
      'eendraad.createFrame',
      (values) => ({
        panelId: framePanelId,
        fields,
        title: values.title || undefined,
        fontSize: Number(values.fontSize),
        titlePosition: values.titlePosition,
      })
    )
    keepValid(candidate)
  }

  if (activeFloorId) {
    const visibleRoutes = mergePlanWireRoutes(
      deriveAutoPlanWireRoutes(project, activeFloorId, ['lighting-control', 'sockets', 'other']),
      selectProjectPlanWireRoutes(project).filter((route) => route.floorId === activeFloorId)
    )
    const endpointLabels = new Map(
      [...walkPanels(getProjectElectricalPanels(project))]
        .flatMap((panel) => getAllEndpoints(panel))
        .map((endpoint) => [endpoint.id, endpoint.label] as const)
    )
    const routeLabel = (routeId: string) => {
      const route = visibleRoutes.find((item) => item.id === routeId)
      if (!route) return ''
      const from = endpointLabels.get(route.from.endpointId)
      const to = endpointLabels.get(route.to.endpointId)
      const labels = [from, to].filter((value): value is string => !!value)
      return labels.length === 2
        ? `${labels[0]} → ${labels[1]}`
        : `${i18n.t('commandPalette.fields.route')} ${visibleRoutes.indexOf(route) + 1}`
    }
    const routeOptions = visibleRoutes.map((route) => ({
      value: route.id,
      label: routeLabel(route.id),
    }))
    const routeField = (routes = routeOptions): CommandInputField => ({
      name: 'routeId',
      labelKey: 'commandPalette.fields.route',
      value: routes[0]?.value ?? '',
      options: routes,
    })
    const selectedRouteId =
      selection.type === 'wire' ? selection.wireMetadata?.find((item) => item.id)?.id : undefined
    const chooseRoute = (routes = routeOptions) =>
      routes.find((route) => route.value === selectedRouteId)?.value ?? routes[0]?.value ?? ''
    const routeEdit = (
      id: string,
      labelKey: string,
      operation: 'insertWaypoint' | 'moveWaypoint' | 'removeWaypoint' | 'moveRiser',
      routes = routeOptions
    ) => {
      if (!routes.length) return
      const fields = [
        routeField(routes),
        ...(operation === 'insertWaypoint' ||
        operation === 'moveWaypoint' ||
        operation === 'removeWaypoint'
          ? [numberField('index', 0, 0, 100, 1)]
          : []),
        ...(operation === 'removeWaypoint'
          ? []
          : [
              numberField('x', 0, -100000, 100000, 'any'),
              numberField('y', 0, -100000, 100000, 'any'),
            ]),
      ]
      const candidate = action(id, labelKey, fields, 'plan.editWireRoute', (values) => ({
        operation,
        floorId: activeFloorId,
        routeId: values.routeId,
        ...(operation === 'insertWaypoint' || operation === 'moveWaypoint'
          ? { index: Number(values.index), point: { x: Number(values.x), y: Number(values.y) } }
          : {}),
        ...(operation === 'removeWaypoint' ? { index: Number(values.index) } : {}),
        ...(operation === 'moveRiser'
          ? { point: { x: Number(values.x), y: Number(values.y) } }
          : {}),
      }))
      const baseValues = Object.fromEntries(fields.map((field) => [field.name, field.value]))
      const applicableRoutes = routes.filter((route) =>
        valid(project, candidate.invocation({ ...baseValues, routeId: route.value }))
      )
      if (!applicableRoutes.length) return
      fields[0]!.options = applicableRoutes
      fields[0]!.value = chooseRoute(applicableRoutes)
      keepValid(candidate)
    }
    routeEdit('plan.insertWireWaypoint', 'commandPalette.planInsertWireWaypoint', 'insertWaypoint')
    routeEdit('plan.moveWireWaypoint', 'commandPalette.planMoveWireWaypoint', 'moveWaypoint')
    routeEdit('plan.removeWireWaypoint', 'commandPalette.planRemoveWireWaypoint', 'removeWaypoint')
    routeEdit(
      'plan.moveWireRiser',
      'commandPalette.planMoveWireRiser',
      'moveRiser',
      visibleRoutes
        .filter((route) => route.riser || route.riserExit)
        .map((route) => ({ value: route.id, label: routeLabel(route.id) }))
    )

    const placementIds =
      selection.type === 'placement'
        ? selection.ids
        : selection.type === 'endpoint'
          ? selection.ids.flatMap((endpointId) => {
              const found: string[] = []
              for (const route of visibleRoutes) {
                if (route.from.endpointId === endpointId && route.from.placementId)
                  found.push(route.from.placementId)
              }
              return found
            })
          : []
    const uniquePlacements = [...new Set(placementIds)].filter(
      (placementId) => resolvePlanPlacement(project, placementId) !== null
    )
    if (uniquePlacements.length) {
      const fields = [
        {
          name: 'placement',
          labelKey: 'commandPalette.fields.placement',
          value: uniquePlacements[0]!,
          options: uniquePlacements.map((value) => ({ value, label: value })),
        },
      ]
      keepValid(
        action(
          'plan.disconnectOutgoingWires',
          'commandPalette.planDisconnectOutgoingWires',
          fields,
          'plan.disconnectWires',
          (values) => ({ floorId: activeFloorId, sourcePlacementId: values.placement })
        )
      )
    }
  }

  const estimates = estimateCableRoutes(project).routes.filter((route) => {
    if (!route.cable || route.scaleCalibrated === false || route.highM <= 0) return false
    const existing = findWireRunForAnchor(selectProjectWireRuns(project), route.anchor)
    return (
      !(
        existing?.segmentLengths?.[route.anchor] === acceptedEstimateLengthM(route.highM) &&
        existing.segmentLengthSources?.[route.anchor] === 'estimated'
      ) && route.enteredLengthM == null
    )
  })
  if (estimates.length > 0 && estimates.length <= 1000) {
    keepValid(
      action(
        'cable.acceptAllLengthEstimates',
        'commandPalette.cableAcceptLengthEstimates',
        [],
        'cable.acceptLengthEstimates',
        () => ({ anchors: estimates.map((route) => route.anchor) })
      )
    )
  }
  return actions
}
