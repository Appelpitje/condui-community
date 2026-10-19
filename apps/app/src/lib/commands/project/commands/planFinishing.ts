import { z } from 'zod'
import type { Frame, FrameContentItem, Note } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import { acceptedEstimateLengthM } from '@/lib/cableRouting/acceptedEstimateLength'
import { estimateCableRoutes } from '@/lib/cableRouting/estimateCableRoutes'
import {
  addOneWireFrameInProject,
  addOneWireNoteInProject,
  addSitplanNoteInProject,
} from '@/lib/projectMutations/annotationMutations'
import {
  editPlanWireRouteInProject,
  findEditablePlanWireRoute,
  disconnectManualPlanWiresInProject,
  editablePlanWireRoutes,
} from '@/lib/plan/planFinishingMutations'
import { findPanelById } from '@/lib/panel/panelTree'
import { getPanelGroundTrunkDevices, getGroundElementId } from '@/lib/eendraad/panelGround'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import {
  resolveFrameContentItems,
  syncFrameContentIds,
  type ResolvedFrameItemKind,
} from '@/lib/eendraad/frameContent'
import { selectProjectPlanWireRoutes } from '@/lib/projectV2/planWiring'
import { acceptWireLengthEstimatesInProject } from '@/lib/wires/wireLengthMutations'
import { findWireRunForAnchor, selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { getDomainTranslator } from '@/lib/i18n/domainI18n'
import { CommandError, defineProjectCommand } from '../types'

const id = z.string().min(1)
const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict()
const annotationScope = z.enum(['oneWire', 'sitplan'])

export const annotationCreateNote = defineProjectCommand({
  id: 'annotation.createNote',
  version: 1,
  input: z
    .object({
      scope: annotationScope,
      floorId: id.optional(),
      panelId: id.optional(),
      pos: point,
      text: z.string().max(2000).optional(),
      fontSize: z.number().finite().positive().max(256).default(14),
    })
    .strict()
    .refine(
      (input) => (input.scope === 'sitplan' ? !!input.floorId && !input.panelId : !input.floorId),
      {
        message: 'Situation-plan notes require a floor; one-wire notes cannot target a floor',
      }
    ),
  check(project, input) {
    if (input.floorId && !project.building.floors.some((floor) => floor.id === input.floorId))
      return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    if (input.panelId && !findPanelById(getProjectElectricalPanels(project), input.panelId))
      return { ok: false, code: 'panel_not_found', message: 'Panel not found' }
    return { ok: true }
  },
  apply(draft, input, env) {
    const translate = getDomainTranslator(env.language)
    const note: Note = {
      id: env.newId(),
      text: input.text ?? translate('commandPalette.values.defaultNote'),
      fontSize: input.fontSize,
      pos: input.pos,
      ...(input.floorId ? { floorId: input.floorId } : {}),
      ...(input.panelId ? { panelId: input.panelId } : {}),
    }
    const added =
      input.scope === 'sitplan'
        ? addSitplanNoteInProject(draft, note)
        : addOneWireNoteInProject(draft, note)
    if (!added)
      throw new CommandError('check_failed', 'Note id is already in use', { reason: 'id_conflict' })
    return {
      created: [{ kind: 'note' as const, id: note.id }],
      changed: [],
      removed: [],
      select: [{ kind: 'note', id: note.id }],
    }
  },
})

const frameContentItem = z
  .object({
    id,
    kind: z.enum(['endpoint', 'protection', 'trunkDevice', 'ground']),
  })
  .strict()
const frameTrunkSpan = z
  .object({
    circuitId: id,
    minTrunkPosition: z.number().finite(),
    maxTrunkPosition: z.number().finite(),
  })
  .strict()
  .refine((span) => span.minTrunkPosition <= span.maxTrunkPosition, {
    message: 'Trunk span start must not exceed its end',
  })
const frameFields = z
  .object({
    contentType: z.enum(['endpoint', 'protection', 'trunkDevice', 'ground', 'mixed']),
    contentIds: z
      .array(id)
      .max(500)
      .refine((items) => new Set(items).size === items.length, {
        message: 'Frame content ids must be unique',
      }),
    contentItems: z
      .array(frameContentItem)
      .max(500)
      .refine(
        (items) => new Set(items.map((item) => `${item.kind}:${item.id}`)).size === items.length,
        { message: 'Frame content items must be unique' }
      )
      .optional(),
    trunkSpans: z
      .array(frameTrunkSpan)
      .max(100)
      .refine((items) => new Set(items.map((item) => item.circuitId)).size === items.length, {
        message: 'Frame trunk spans must be unique per circuit',
      })
      .optional(),
  })
  .strict()

function frameMembersBelongToPanel(
  project: ProjectV2,
  panelId: string,
  fields: Pick<Frame, 'contentType' | 'contentIds' | 'contentItems' | 'trunkSpans'>
): boolean {
  const panel = findPanelById(getProjectElectricalPanels(project), panelId)
  if (!panel) return false
  // Frames belong to one panel. Do not treat members nested under a child panel as
  // belonging to the selected parent panel.
  const circuits = [
    ...panel.circuits,
    ...panel.protections.flatMap((protection) => protection.circuits ?? []),
  ]
  const endpoints = new Set(circuits.flatMap((circuit) => circuit.endpoints.map((item) => item.id)))
  const protections = new Set(panel.protections.map((item) => item.id))
  const trunkDevices = new Set(
    circuits.flatMap((circuit) => [
      ...(circuit.trunkDevices ?? []).map((item) => item.id),
      ...(circuit.branches ?? []).flatMap((branch) =>
        (branch.branchDevices ?? []).map((item) => item.id)
      ),
    ])
  )
  const installation = getProjectElectricalInstallation(project)
  if (installation) {
    const topology = installation.feedTopology
    const storedSupplyDevices = queryAllSupplyTrunkDevices(project)
    const storedSupplyIds = new Set(storedSupplyDevices.map((device) => device.id))
    if (panel.isMain === true) {
      for (const device of installation.mainSupply.supplyTrunkDevices ??
        topology?.sharedFeed.trunkDevices ??
        []) {
        if (storedSupplyIds.has(device.id)) trunkDevices.add(device.id)
      }
    }
    for (const feed of topology?.rootFeeds ?? []) {
      if (feed.panelId === panel.id)
        for (const device of feed.trunkDevices ?? []) {
          if (storedSupplyIds.has(device.id)) trunkDevices.add(device.id)
        }
    }
  }
  const groundDevices = getPanelGroundTrunkDevices(panel, installation, panel.isMain === false)
  for (const device of groundDevices) trunkDevices.add(device.id)
  const circuitIds = new Set(circuits.map((circuit) => circuit.id))
  const groundIds = new Set(groundDevices.length > 0 ? [getGroundElementId(panel)] : [])
  if (panel.isMain === false && panel.hasGround === true) groundIds.add(getGroundElementId(panel))
  if (panel.isMain && installation?.hasGround !== false) groundIds.add('ground')
  const allowed: Record<ResolvedFrameItemKind, ReadonlySet<string>> = {
    endpoint: endpoints,
    protection: protections,
    trunkDevice: trunkDevices,
    ground: groundIds,
    panelSymbol: new Set(),
  }
  const content: FrameContentItem[] =
    fields.contentItems ??
    fields.contentIds.map((contentId): FrameContentItem => ({
      id: contentId,
      kind:
        fields.contentType === 'mixed'
          ? 'endpoint'
          : (fields.contentType as FrameContentItem['kind']),
    }))
  if (content.some((item) => !allowed[item.kind].has(item.id))) return false
  if ((fields.trunkSpans ?? []).some((span) => !circuitIds.has(span.circuitId))) return false
  const frame = {
    ...fields,
    id: '__preview__',
    title: '',
    fontSize: 10,
    titlePosition: 'inside' as const,
    panelId,
  }
  const resolvedIds = syncFrameContentIds(frame, project)
  return (
    resolvedIds.length > 0 &&
    resolvedIds.length === fields.contentIds.length &&
    resolvedIds.every((contentId, index) => contentId === fields.contentIds[index]) &&
    resolveFrameContentItems(frame, project).length === resolvedIds.length
  )
}

/** Creates a schematic frame around a typed same-panel selection and its dynamic trunk spans. */
export const eendraadCreateFrame = defineProjectCommand({
  id: 'eendraad.createFrame',
  version: 1,
  input: z
    .object({
      panelId: id,
      fields: frameFields,
      title: z.string().max(120).optional(),
      fontSize: z.number().finite().min(6).max(24).optional(),
      titlePosition: z.enum(['inside', 'outside']).optional(),
    })
    .strict(),
  check(project, input) {
    if (!findPanelById(getProjectElectricalPanels(project), input.panelId))
      return { ok: false, code: 'panel_not_found', message: 'Panel not found' }
    if (!frameMembersBelongToPanel(project, input.panelId, input.fields))
      return {
        ok: false,
        code: 'invalid_frame_members',
        message: 'Frame contents must belong to the selected panel',
      }
    return { ok: true }
  },
  apply(draft, input, env) {
    const translate = getDomainTranslator(env.language)
    const frame: Frame = {
      id: env.newId(),
      title: input.title ?? translate('commandPalette.values.defaultFrame'),
      fontSize: input.fontSize ?? 10,
      titlePosition: input.titlePosition ?? 'inside',
      panelId: input.panelId,
      ...input.fields,
    }
    if (!addOneWireFrameInProject(draft, frame))
      throw new CommandError('check_failed', 'Frame id is already in use', {
        reason: 'id_conflict',
      })
    return {
      created: [{ kind: 'frame', id: frame.id }],
      changed: [],
      removed: [],
      related: [{ kind: 'panel', id: input.panelId }],
      select: [{ kind: 'frame', id: frame.id }],
    }
  },
})

const routeEditInput = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('insertWaypoint'),
      floorId: id,
      routeId: id,
      index: z.number().int().nonnegative(),
      point,
    })
    .strict(),
  z
    .object({
      operation: z.literal('moveWaypoint'),
      floorId: id,
      routeId: id,
      index: z.number().int().nonnegative(),
      point,
    })
    .strict(),
  z
    .object({
      operation: z.literal('removeWaypoint'),
      floorId: id,
      routeId: id,
      index: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({ operation: z.literal('hideSocketRoutes'), floorId: id, sourcePlacementId: id })
    .strict(),
  z.object({ operation: z.literal('moveRiser'), floorId: id, routeId: id, point }).strict(),
  z
    .object({
      operation: z.literal('moveRisers'),
      floorId: id,
      moves: z
        .array(z.object({ routeId: id, point }).strict())
        .min(1)
        .max(100)
        .refine((moves) => new Set(moves.map((move) => move.routeId)).size === moves.length, {
          message: 'Riser route ids must be unique',
        }),
    })
    .strict(),
])

export const planEditWireRoute = defineProjectCommand({
  id: 'plan.editWireRoute',
  version: 1,
  input: routeEditInput,
  check(project, input) {
    if (!project.building.floors.some((floor) => floor.id === input.floorId))
      return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    const routes = selectProjectPlanWireRoutes(project)
    if (input.operation === 'hideSocketRoutes') {
      const visibleSocketRoutes = editablePlanWireRoutes(project, input.floorId).filter(
        (route) => route.kind === 'sockets'
      )
      const hasRoute = visibleSocketRoutes.some(
        (route) => route.from.placementId === input.sourcePlacementId
      )
      return hasRoute
        ? { ok: true }
        : { ok: false, code: 'route_not_found', message: 'No socket wires start at this placement' }
    }
    if (input.operation === 'moveRisers') {
      if (
        input.moves.some(({ routeId }) => {
          const route = findEditablePlanWireRoute(project, input.floorId, routeId)
          return !route || (!route.riser && !route.riserExit)
        })
      )
        return {
          ok: false,
          code: 'riser_not_found',
          message: 'A selected route has no floor passage',
        }
      return { ok: true }
    }
    const route = findEditablePlanWireRoute(project, input.floorId, input.routeId)
    if (!route) return { ok: false, code: 'route_not_found', message: 'Wire route not found' }
    if (input.operation === 'moveRiser' && !route.riser && !route.riserExit)
      return { ok: false, code: 'riser_not_found', message: 'Wire route has no floor passage' }
    if (
      input.operation === 'removeWaypoint' &&
      !routes.some((candidate) => candidate.id === route.id)
    )
      return { ok: false, code: 'route_not_found', message: 'Wire route is no longer stored' }
    if (input.operation === 'moveWaypoint' || input.operation === 'removeWaypoint') {
      const waypoints =
        routes.find((candidate) => candidate.id === route.id)?.waypoints ?? route.waypoints ?? []
      if (input.index >= waypoints.length)
        return { ok: false, code: 'waypoint_not_found', message: 'Waypoint not found' }
    }
    if (input.operation === 'insertWaypoint') {
      const waypoints =
        routes.find((candidate) => candidate.id === route.id)?.waypoints ?? route.waypoints ?? []
      if (input.index > waypoints.length)
        return {
          ok: false,
          code: 'invalid_waypoint_index',
          message: 'Waypoint index is out of range',
        }
    }
    return { ok: true }
  },
  apply(draft, input) {
    const changed = editPlanWireRouteInProject(draft, input)
    if (!changed) return { created: [], changed: [], removed: [] }
    const routeRefs =
      input.operation === 'moveRisers'
        ? input.moves.map((move) => ({ kind: 'wireRoute' as const, id: move.routeId }))
        : input.operation === 'hideSocketRoutes'
          ? []
          : [{ kind: 'wireRoute' as const, id: input.routeId }]
    return {
      created: [],
      removed: [],
      changed: [{ kind: 'floor' as const, id: input.floorId }, ...routeRefs],
    }
  },
})

export const planDisconnectWires = defineProjectCommand({
  id: 'plan.disconnectWires',
  version: 1,
  input: z.object({ floorId: id, sourcePlacementId: id }).strict(),
  check(project, input) {
    if (!project.building.floors.some((floor) => floor.id === input.floorId))
      return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    const matched = selectProjectPlanWireRoutes(project).some(
      (route) =>
        route.source === 'manual' &&
        route.kind === 'other' &&
        route.floorId === input.floorId &&
        route.from.placementId === input.sourcePlacementId
    )
    return matched
      ? { ok: true }
      : { ok: false, code: 'route_not_found', message: 'No manual wires start at this placement' }
  },
  apply(draft, input) {
    const removedIds = disconnectManualPlanWiresInProject(
      draft,
      input.floorId,
      input.sourcePlacementId
    )
    return {
      created: [],
      changed: [],
      removed: removedIds.map((id) => ({ kind: 'wireRoute' as const, id })),
    }
  },
})

export const cableAcceptLengthEstimates = defineProjectCommand({
  id: 'cable.acceptLengthEstimates',
  version: 1,
  input: z
    .object({
      anchors: z
        .array(id)
        .min(1)
        .max(1000)
        .refine((anchors) => new Set(anchors).size === anchors.length, {
          message: 'Cable anchors must be unique',
        }),
    })
    .strict(),
  check(project, input) {
    const estimates = estimateCableRoutes(project).routes
    for (const anchor of input.anchors) {
      const estimate = estimates.find((route) => route.anchor === anchor)
      if (!estimate || estimate.scaleCalibrated === false || estimate.highM <= 0 || !estimate.cable)
        return {
          ok: false,
          code: 'estimate_unavailable',
          message: 'A selected cable no longer has an unaccepted calibrated estimate',
        }
      const accepted = acceptedEstimateLengthM(estimate.highM)
      const existing = findWireRunForAnchor(selectProjectWireRuns(project), anchor)
      const isAlreadyAccepted =
        existing?.segmentLengths?.[anchor] === accepted &&
        existing.segmentLengthSources?.[anchor] === 'estimated'
      if (isAlreadyAccepted) continue
      if (estimate.enteredLengthM != null)
        return {
          ok: false,
          code: 'estimate_unavailable',
          message: 'A selected cable already has an entered length',
        }
    }
    return { ok: true }
  },
  apply(draft, input, env) {
    const previousRunIds = new Set(selectProjectWireRuns(draft).map((run) => run.id))
    const estimates = estimateCableRoutes(draft).routes
    const byAnchor = new Map(estimates.map((route) => [route.anchor, route]))
    const entries = input.anchors.flatMap((anchor) => {
      const estimate = byAnchor.get(anchor)
      return estimate?.cable && estimate.highM > 0 && estimate.scaleCalibrated !== false
        ? [{ anchor, cable: estimate.cable, lengthM: acceptedEstimateLengthM(estimate.highM) }]
        : []
    })
    const changed = acceptWireLengthEstimatesInProject(draft, entries, env.newId)
    if (!changed) return { created: [], changed: [], removed: [] }
    const changedRuns = new Set(
      entries
        .map((entry) => findWireRunForAnchor(selectProjectWireRuns(draft), entry.anchor)?.id)
        .filter((value): value is string => !!value)
    )
    return {
      created: [...changedRuns]
        .filter((runId) => !previousRunIds.has(runId))
        .map((id) => ({ kind: 'wireRun' as const, id })),
      removed: [],
      changed: [...changedRuns]
        .filter((runId) => previousRunIds.has(runId))
        .map((id) => ({ kind: 'wireRun' as const, id })),
      related: [
        ...new Set(
          entries
            .map((entry) => byAnchor.get(entry.anchor)?.circuitId)
            .filter((value): value is string => !!value)
        ),
      ].map((circuitId) => ({ kind: 'circuit' as const, id: circuitId })),
    }
  },
})
