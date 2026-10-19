import { createElement } from 'react'
import { Capacitor } from '@capacitor/core'
import i18n from '@/i18n'
import { ensureRoomPlanSupport, useRoomPlanSupport } from '@/lib/native/roomPlanSupport'
import { useProjectDocumentsStore } from '@/stores/projectDocumentsStore'
import RoomPlanScanDialog from '@/components/plan/RoomPlanScanDialog'
import {
  convertRoomPlanScan,
  roomPlanImportScale,
  roomPlanScanSchema,
  suggestRoomPlanImportOrigin,
  type RoomPlanGeometryPreview,
  type RoomPlanScanResult,
  type RoomPlanQuarterTurns,
} from '@/lib/plan/roomPlanImport'
import type { Point2 } from '@/types/schema'
import { selectProjectFloorPlan } from '@/lib/projectV2/buildingFloors'
import { CommandError, type CommandInvocation } from '@/lib/commands/project'
import { revealCanvas } from '@/lib/ui/revealCanvas'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { useDialogStore } from '@/stores/dialogStore'
import { liveProjectSession } from '@/stores/liveProjectCommandSession'

export type RoomPlanImportPreview = RoomPlanGeometryPreview & {
  invocation: CommandInvocation
  revision: string
  floorName: string
  floorId: string
  origin: Point2
  quarterTurns: RoomPlanQuarterTurns
  roomName?: string
  panelId?: string
  roomNames?: Record<string, string>
}

// Resolve hardware support even when the palette opens before the Plan rail mounts.
void ensureRoomPlanSupport()

export function canOpenRoomPlanScan(): boolean {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return false
  if (useRoomPlanSupport.getState().supported !== true) return false
  const project = useProjectStore.getState().currentProject
  const floorId = useUIStore.getState().activeFloorId
  return !!project?.building.floors.some((floor) => floor.id === floorId)
}

export function openRoomPlanScan(source = 'room-scan'): boolean {
  if (!canOpenRoomPlanScan()) return false
  const project = useProjectStore.getState().currentProject!
  const floorId = useUIStore.getState().activeFloorId!
  const { openDialog, closeDialog } = useDialogStore.getState()
  openDialog({
    id: 'room-plan-scan', type: 'custom', size: 'xl',
    title: i18n.t('nativeRoomScan.title'),
    content: createElement(RoomPlanScanDialog, {
      floorId, projectId: project.project.id, source, onClose: closeDialog,
    }),
  })
  return true
}

/** Prepare the same domain geometry that acceptance will create, without changing the project. */
export function prepareRoomPlanImport(scan: RoomPlanScanResult, floorId: string, projectId: string, quarterTurns: RoomPlanQuarterTurns = 0, details?: { roomName?: string; panelId?: string; roomNames?: Record<string, string> }): RoomPlanImportPreview {
  const project = useProjectStore.getState().currentProject
  const floor = project?.building.floors.find((candidate) => candidate.id === floorId)
  if (!project || !floor || project.project.id !== projectId)
    throw new CommandError('check_failed', 'The target floor is no longer available', { reason: 'floor_not_found' })
  const validatedScan = roomPlanScanSchema.parse(scan)
  const origin = suggestRoomPlanImportOrigin(project, floorId)
  const invocation = { id: 'plan.importRoomScan', input: { floorId, origin, scan: validatedScan, quarterTurns, ...details } }
  const prepared = liveProjectSession.preview(invocation)
  if (!prepared.check.ok)
    throw new CommandError('check_failed', prepared.check.message, { reason: prepared.check.code })
  let id = 0
  const geometry = convertRoomPlanScan(validatedScan, {
    floorId, origin, quarterTurns, pxPerMeter: roomPlanImportScale(project),
    symbolSizeCm: floor.sitplanSymbolSizeCm,
    masterWallThickness: selectProjectFloorPlan(project, floorId)?.masterWallThickness,
    newId: () => `scan-preview-${id++}`,
  })
  if (geometry.floorPlan.walls.length === 0)
    throw new CommandError('check_failed', 'No usable walls in scan', { reason: 'no_walls' })
  return {
    ...geometry,
    invocation, revision: prepared.revision, floorName: floor.name, floorId, origin, quarterTurns, ...details,
  }
}

/** Preview-only rotation retains the captured revision, placement and calibration. */
export function rotateRoomPlanImportPreview(preview: RoomPlanImportPreview, scan: RoomPlanScanResult, direction: -1 | 1): RoomPlanImportPreview {
  const quarterTurns = ((preview.quarterTurns + direction + 4) % 4) as RoomPlanQuarterTurns
  let id = 0
  return {
    ...preview,
    ...convertRoomPlanScan(scan, {
      floorId: preview.floorId, origin: preview.origin, quarterTurns,
      symbolSizeCm: preview.symbolSizePx * 100 / preview.pxPerMeter,
      pxPerMeter: preview.pxPerMeter, masterWallThickness: preview.floorPlan.masterWallThickness,
      newId: () => `scan-preview-${id++}`,
    }),
    quarterTurns,
    invocation: { id: 'plan.importRoomScan', input: { floorId: preview.floorId, origin: preview.origin, scan, quarterTurns, roomName: preview.roomName, roomNames: preview.roomNames, panelId: preview.panelId } },
  }
}

export function applyRoomPlanImport(preview: RoomPlanImportPreview, source = 'room-scan'): void {
  liveProjectSession.execute([preview.invocation], {
    expectedRevision: preview.revision,
    label: 'plan.importRoomScan', source,
  })
  const ui = useUIStore.getState()
  ui.setActiveFloor(preview.floorId)
  ui.clearSelection()
  const asset = useProjectStore.getState().currentProject?.assets.slice().reverse().find((asset) =>
    asset.document?.roomScan?.floorId === preview.floorId && asset.document.roomScan.kind === 'placements')
  if (preview.placements.length && asset) {
    ui.setLayoutPreset('sideBySide')
    useUIStore.getState().setPanelCanvas(0, 'plan')
    useUIStore.getState().setPanelCanvas(1, 'documents')
    const documents = useProjectDocumentsStore.getState()
    documents.bindProject(useProjectStore.getState().currentProject!.project.id)
    documents.openDocument(asset.id)
  } else revealCanvas('plan')
  ui.requestFitToView(['plan'])
}
