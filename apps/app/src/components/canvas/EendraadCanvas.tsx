import { resolveLiveProtectionBusPreview } from '@/lib/layout/liveProtectionBusPreview'
import { LiveProtectionBusPreview } from './eendraad/LiveProtectionBusPreview'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'
import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import { useIsActiveViewport, useViewportUIStore as useCanvasUIStore, useViewportUIApi } from '@/components/viewport/ViewportUIStore'
import { deleteProjectEntities, resolveSelectionDeleteRefs, deleteEndpointByCommand as deleteEndpoint, deleteProtectionByCommand as deleteProtection, deletePanelByCommand as deletePanel, deleteTrunkDeviceByCommand as deleteTrunkDevice, deleteGroundTrunkDeviceByCommand as deleteGroundTrunkDevice } from '@/handlers/commands/deleteEntities'
import { resolveSupplyDropMounting } from '@/lib/layout/resolveSupplyDropMounting'
import { createUiDropBehaviorHooks } from '@/handlers/eendraad/uiDropBehaviorHooks'
import { placeElectricalSymbol } from '@/handlers/eendraad/placeElectricalSymbol'
import { normalizeElectricalDropTarget } from '@/lib/eendraad/electricalSymbolDrop'
import { memo, useCallback, useRef, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useJunctionEditorMenu } from '@/components/junctionEditor/junctionEditorHostedFeatures'
import { Circle, Group, Line, Rect } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type Konva from 'konva'
import { useTranslation } from 'react-i18next'
import { CalendarDays, CornerDownLeft, RotateCcw, Trash2 } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { useDialogStore } from '@/stores/dialogStore'
import { useCanvasRegistryStore } from '@/stores/canvasRegistryStore'
import { generateId } from '@/utils'
import { isDemoProjectId } from '@/lib/demoProject'
import { ensurePanelPlacement, getPanelEndpoint } from '@/utils/panelPlacement'
import type { CanvasDropMeta, CanvasSize, Point, Selection } from '@/types/ui'
import type { Endpoint, Circuit, Panel, ProtectionDevice, Placement, TrunkDevice, Frame, WireSegment } from '@/types/schema'
import BaseCanvas, { type BaseCanvasHandle } from './BaseCanvas'
import ViewNavigationToolbar from './ViewNavigationToolbar'
import CanvasFloatingControlRail from './CanvasFloatingControlRail'
import { FloatingControl } from './FloatingControls'
import { CanvasOverlayScaleProvider } from '@/contexts/CanvasOverlayScaleContext'
import { EendraadWireSegmentsContext } from '@/contexts/EendraadWireSegmentsContext'
import { WireSegments } from './WireSegment'
import { logger } from '@/lib/logger'
import { trackSymbolPlace } from '@/lib/analytics/editorEventAnalytics'
import { isVirtualOneWireOnlySymbol } from '@/lib/plan/situationPlanSymbolEligibility'
import { DragCursorSymbol, DragPreview, DropZoneHintsOverlay, HitZoneDebugOverlay, OffscreenPreviewIndicator, TrunkLayoutDebugOverlay } from './eendraad'
import { FrameComponent } from './eendraad/FrameComponent'
import RenderNode from './eendraad/RenderNode'
import InstallDateOverlay from './eendraad/InstallDateOverlay'
import { NoteSymbol } from './eendraad/NoteSymbol'
/* @vision-scan-strip-start */
import { OneWireReferencePages } from './eendraad/OneWireReferencePages'
import { isElectricalVisionScanEnabled } from '@/lib/vision/availability'
import {
  placeDocumentOnOneWire,
  removeOneWireReferenceItems,
} from '@/handlers/documents/oneWireReferences'
import { parseOneWireReferenceItemId } from '@/lib/documents/oneWireReferences'
/* @vision-scan-strip-end */
import {
  SYMBOL_SIZE,
  DRAG_PREVIEW_WIRE_WIDTH,
  DRAG_PREVIEW_BUS_WIDTH,
  DRAG_PREVIEW_HIGHLIGHT_WIDTH,
  DRAG_PREVIEW_DASH,
} from './eendraad/canvasSymbols'
import { CanvasPanOrClickProvider } from './eendraad/CanvasPanOrClickProvider'
import { ConverterResizeViewportContext } from './eendraad/ConverterResizeViewportContext'
import { MetadataCalloutDragContext } from './eendraad/MetadataCalloutDragContext'
import { getStoredMetadataCalloutOffset, setMetadataCalloutOffset, type MetadataCalloutOwnerRef } from '@/handlers/eendraad/metadataCalloutOffset'
import { linkedSubPanelDisplayNamesForProtectionIds } from '@/lib/panel/linkedSubPanelDeleteWarning'
import { createLinkedProtectionDeleteDialog } from '@/lib/panel/linkedProtectionDeleteDialog'
import { panelHasModularChangeover } from '@/lib/panel/panelFeedOrganization'
import { canCreateSupplyTopologyFromDrop } from '@/lib/supplyTopologyFeature'
import { panelHasContent, isLastMainPanel } from '@/utils/eendraad'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'
import { supportsSupplyDeviceMultiplier } from '@/lib/supplyAssembly/inverterMultipliers'
import { findSameSymbolAddMoreLayoutTargets, incrementSameSymbolAddMoreTargetWithUndo, isConflictingOnSymbolDrop, positionHitsMultiplierBadge, endpointMergeSettingsMatchEndpoints, type SameSymbolAddMoreTarget } from '@/lib/eendraad/sameSymbolAddMore'
import { collectBranchDropTargets, resolveBranchDropIntent, resolveBranchDropFallback, resolveBranchStemFallback, type BranchDropTargets } from '@/lib/layout/branchDropInteraction'
import { BranchDropHints } from './eendraad/BranchDropHints'
import { SameSymbolAddMorePreview } from './eendraad/SameSymbolAddMorePreview'
import { validateEendraadPreview } from '@/hooks/eendraad/validateEendraadPreview'
import { BranchInsertionPreview } from './eendraad/BranchInsertionPreview'
import { InsertionPreviewChunk } from './eendraad/InsertionPreviewChunk'
import { createSyncEndpointMultiplierDeps, syncEndpointMultiplierCount } from '@/lib/eendraad/syncEndpointMultiplierCount'
import { createSyncSupplyInverterMultiplierDeps, syncSupplyDeviceMultiplierCount } from '@/lib/eendraad/syncSupplyInverterMultiplier'
import { openAddMoreDialogForEndpoint, openSupplyDeviceAddMoreDialog } from '@/components/endpoints/AddMoreCountDialog'
import { useEendraadLayout, useEendraadWireSegments, useDropTargetDetection, useEendraadDragPreview, useLayoutTree, useEendraadCircuitLetterHotkeys, useChangeoverGridSourcePreview } from '@/hooks/eendraad'
import { ChangeoverGridSourcePreviewArtwork } from './eendraad/ChangeoverGridSourcePreviewArtwork'
import { computeEendraadCircuitFocusBounds } from '@/lib/eendraad/focusCircuit'
import { pickRepresentativeCircuitIdForMainBusMove } from '@/lib/eendraad/mainBusOrder'
import { resolveSecondaryBusEjectSelection } from '@/lib/eendraad/secondaryBusEjectEligibility'
import { getEendraadPreviewIntentKey, useEendraadPreviewGraph } from '@/hooks/eendraad/useEendraadPreviewGraph'
import { resolveOffscreenSupplyPreviewDirection } from '@/lib/layout/offscreenSupplyPreviewIndicator'
import type { LayoutNode, LayoutTree } from '@/lib/layout/layoutTree'
import { findClosestLayoutNodeAnchor, getPanPreservingWorldAnchor } from '@/lib/canvas/viewportAnchor'
import { resizeConverterDcConnections } from '@/handlers/eendraad/resizeConverterDcConnections'
import { getEendraadRenderProjectRevision } from '@/lib/layout/eendraadDerivedLayout'
import type { DropZoneHintRelocation } from '@/lib/layout/collectDropZoneHints'
import { findDomoticaOutputDropTarget, findDropTarget, findDropTargetWithDebug, ensureCircuitTrunkWireSegmentOnDropTarget, getHitZoneBounds, type DropTarget, type FindDropTargetOptions } from '@/lib/layout/findDropTarget'
import { circuitTrunkBranchSlotDropTarget, findCircuitTrunkBranchSlot } from '@/lib/layout/circuitTrunkBranchSlots'
import { getBranchDragGroupEndpointIds } from '@/lib/eendraad/downstreamSelection'
import { TrunkBranchSlotPreview } from '@/components/canvas/eendraad/TrunkBranchSlotPreview'
import { createFindElementsInRectangleHandler } from '@/handlers/eendraad'
import { canDropSymbolOnEmptyCanvas } from '@/lib/eendraad/dropBehaviors'
import { isSupplyDropTarget } from '@/lib/eendraad/supplyDropTargets'
import { PROTECTION_SYMBOL_IDS, protectionTypeToSymbolKey } from '@/lib/protectionKind'
import {
  ENCLOSURE_SEPARATOR_HALF_LENGTH,
  getEnclosureSeparatorGeometry,
} from '@/lib/layout/enclosureSeparatorGeometry'
import { describeEnclosureKey } from '@/lib/panel/enclosureNames'
import { getSymbolById, type SymbolMetadata } from '@/lib/symbols'
import AddElementPicker from '@/components/eendraad/AddElementPicker'
import { endpointIdsForPlacementSelection } from '@/lib/ui/crossCanvasSelection'
import { OPEN_EENDRAAD_NAMING_GUIDANCE_EVENT } from '@/lib/ui/eendraadNamingGuidance'
import { buildFrameFieldsFromClassifiedSelection, resolveEendraadFramePanelIdForSelection } from '@/lib/eendraad/frameContent'
import { logTrunkDnD, trunkDnDCommitLogEnabled, logTrunkDnDCommit, serializeTrunkDevices, summarizeDropTarget, summarizeHitDebugPath, trunkDnDVerboseLogEnabled } from '@/lib/eendraad/trunkDeviceDnDLog'
import type { ContextMenuItem } from '@/components/common/ContextMenu'
import { getContextMenuIcon } from '@/components/common/ContextMenuIcons'
import FloorSelectionDialog from '@/components/plan/FloorSelectionDialog'
import { buildAutoSitplanPlacement, getViewportCenterPlanSpaceIfApplicable } from '@/lib/plan/autoSitplanPlacement'
import { resolveSitplanTargetFloorId } from '@/lib/plan/sitplanTargetFloor'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { ensureEarthingSitplanPlacement } from '@/lib/plan/ensureEarthingSitplanPlacement'
import { isMainPanelDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import { confirmDeleteEarthing } from '@/lib/installation/deleteEarthing'
import { findGroundTrunkDeviceOwner, isGroundElementId } from '@/lib/eendraad/panelGround'
import { confirmDeleteSupplyTrunkDevice } from '@/lib/supplyAssembly/deleteSupplyTrunkDevice'
import { getProjectElectricalInstallation, getProjectElectricalPanels, getEditableProjectElectricalPanels, selectProjectSupplyAssemblies } from '@/lib/projectV2/electrical'
import { canDuplicateEendraadSelection, doEendraadDuplicate } from '@/lib/eendraad/contextMenuActions'
import { hasEendraadAnnotationDeleteTarget, resolveEendraadAnnotationDeleteTarget } from '@/lib/eendraad/deleteSelection'
import { isEendraadDeleteKey } from '@/lib/eendraad/deleteKeyboardKey'
import { isPanelAttachmentDropTargetTerminal, movePanelAttachmentOnRcdBus, movePanelAttachmentOnSecondaryBus, movePanelAttachmentToMainBus } from '@/lib/eendraad/panelAttachmentMove'
import { resolveProtectionDropTargetForPosition, runEendraadEndpointAltDragDuplicate } from '@/lib/eendraad/eendraadAltDragDuplicate'
import { commitEndpointMove as moveEndpointSelection } from '@/handlers/eendraad/moveEndpointSelection'
import { duplicateProtection } from '@/handlers/eendraad/duplicateProtection'
import { moveSupplyTrunkDevice } from '@/handlers/eendraad/moveSupplyTrunkDevice'
import { moveCircuitTrunkDevice } from '@/handlers/eendraad/moveCircuitTrunkDevice'
import { moveCircuitTrunkDevices } from '@/handlers/eendraad/moveCircuitTrunkDevices'
import { runEendraadBusMove } from '@/handlers/eendraad/moveBusItems'
import { classifyEendraadMoveSelection, resolveEendraadMultiMoveKind } from '@/lib/eendraad/multiSelectionMove'
import { isSupplyTrunkDeviceDropTarget } from '@/lib/eendraad/supplyTrunkDeviceMove'
import { resolvePlacementForFloorMove } from '@/lib/eendraad/floorMoveFromEendraad'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { getPanelCanvasZoomMinimum } from '@/lib/panel/panelCanvasZoom'
import { getPanelDiagramId, type BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import { getAddedPreviewWireSegments, getChangedPreviewWireSegments, getPreviewCircuitTranslation, getPreviewPanelTranslation } from '@/lib/layout/eendraadPreviewWires'
import { resolvePanelAttachmentPreviewGeometry } from '@/lib/layout/panelAttachmentPreview'
import { getProtectionPreviewBusSegments, isSecondaryBusPreviewTarget, resolveProtectionNestPreviewCircuitId, usesStructuralDropPreview } from '@/lib/layout/eendraadPreviewTarget'
import { DOMOTICA_BRANCH_LEAD, DOMOTICA_MAX_ENDPOINT_OUTPUTS, DOMOTICA_OUTPUT_SPACING } from '@/lib/domoticaLayout'

import { automaticMainBusNamingWouldChangeProject, projectHasManualEendraadLabelOverrides, resolveAutomaticNamingOptsFromInstallation } from '@/lib/eendraad/automaticMainBusNaming'
import { installationHideFeederLetters } from '@/lib/eendraad/eendraadNamingInstall'
import { getMainBusOrder, getMainBusItemsWithIndices } from '@/lib/eendraad/mainBusOrder'
import type { EditorCapabilities } from '@/lib/viewerMode'
import { BoundedCanvasPreview } from './shared/BoundedCanvasPreview'
import { ViewportMountedDiagram } from './eendraad/ViewportMountedDiagram'
import { indexDiagramSceneMounting } from '@/lib/eendraad/diagramSceneMounting'
import { buildDiagramOverview } from '@/lib/eendraad/diagramOverview'
import { DiagramOverview } from './eendraad/DiagramOverview'

import { useEditionFeatureAvailability } from '@/hooks/useEditionFeatureAvailability'
import {
  LabelStyleSelect,
  applyLabelScheme,
  openLabelSchemeDialog,
} from '@/components/canvas/eendraad/LabelSchemeSettings'
import { labelSchemeUsesPanelPart, resolveLabelScheme } from '@/lib/eendraad/labelScheme'
import { useSettingsStore } from '@/stores/settingsStore'
import { getExplicitInstallationDate, getExplicitInstallYear, getInstallYearColorKey, installationDateFromYear, installYearColor, normalizeInstallationDate, normalizeInstallYear, pickInstallYearColor } from '@/lib/installDates'
import { buildCircuitInstallDateTargets, buildInstallDateInheritanceIndex, buildPanelInstallDateTargets, buildProtectionInstallDateTargets, getInstallDateTargetInheritedYear, protectionHasInstallDateChildren, type InstallDatePropagationMode, type InstallDateTarget } from '@/lib/installDatePropagation'
import { queryOneWireNotes } from '@/lib/projectV2/annotations'
import { clamp } from '@/lib/geometry'
import { resolveCircuitWireSegmentByMetadata, resolveSupplyWireSegmentByMetadata } from '@/lib/eendraad/wireSelectionIdentity'
import { isKeyboardOwnedByFloatingEditor } from '@/utils/keyboardOwner'

function findProtectionDragTarget(tree: LayoutTree, position: Point): { target: DropTarget } {
  return {
    target: findDropTarget(tree, position, {
      preferMainBusOverGroundWire: true,
      preferMainBusOverSupplyWire: false,
      preferSecondaryBusForNestedProtection: true,
    }),
  }
}

type ViewportHitBounds = { left: number; top: number; right: number; bottom: number }

const VIEWPORT_HIT_CULLABLE_SELECTOR = '.eendraad-hit-cullable'
const VIEWPORT_HIT_BOUNDS_ATTRIBUTE = 'eendraadViewportHitBounds'
// Keep a generous screen-space gutter interactive while the camera is moving.
const VIEWPORT_HIT_OVERSCAN_PX = 160

function boundsIntersect(left: ViewportHitBounds, right: ViewportHitBounds): boolean {
  return !(
    left.right < right.left ||
    left.left > right.right ||
    left.bottom < right.top ||
    left.top > right.bottom
  )
}

const EMPTY_PANELS: Panel[] = []

type KonvaPointerEventLike = {
  target?: {
    getStage?: () => {
      getPointerPosition?: () => Point | null
    } | null
  }
}

function isKonvaPointerEventLike(value: unknown): value is KonvaPointerEventLike {
  if (!value || typeof value !== 'object') return false
  const target = (value as { target?: unknown }).target
  return !!target && typeof target === 'object' && 'getStage' in target
}

type PanelLayoutWithElements = BottomUpPanelLayout & {
  elements?: Array<{ type?: string; trunkDeviceId?: string }>
}

type EendraadLongPressDuplicateDrag = {
  elementTypes: Selection['type'][]
  onStart: (params: {
    elementId: string
    elementType: Selection['type']
    clientX: number
    clientY: number
  }) => void
}

/** Apply plan-consistent floor moves for one or more endpoints (one-wire context menu). */
function applyEendraadEndpointsToFloor(endpointIds: string[], floorId: string): void {
  const state = useProjectStore.getState()
  const actFloor = useUIStore.getState().activeFloorId
  for (const endpointId of endpointIds) {
    const latest = state.getEndpointById(endpointId)
    if (!latest) continue
    const placement = resolvePlacementForFloorMove(latest, actFloor)
    if (placement) {
      state.updatePlacement(placement.id, { floorId })
    } else {
      const project = state.currentProject
      if (!project) continue
      if (isVirtualOneWireOnlySymbol(latest.symbol)) continue
      const circuitInfo = state.findCircuitForEndpoint(latest.id)
      if (!circuitInfo) continue
      const placementId = generateId()
      const uiSnap = useUIStore.getState()
      const preferredPlanPos =
        getViewportCenterPlanSpaceIfApplicable(
          uiSnap.viewportLayout,
          uiSnap.planCanvasViewportPx,
          uiSnap.activeFloorId,
          floorId,
          uiSnap.planView
        ) ?? undefined
      const built = buildAutoSitplanPlacement(project, {
        circuitId: circuitInfo.circuit.id,
        floorId,
        placementId,
        ...(preferredPlanPos ? { preferredPlanPos } : {}),
      })
      if (built) state.addPlacement(latest.id, built)
    }
  }
}

interface EendraadCanvasProps {
  onMultiFingerSwipe?: (
    direction: 'left' | 'right' | 'up' | 'down',
    fingerCount: number,
    startClientX: number
  ) => void
  capabilities?: EditorCapabilities
}

function findEndpointRenderTarget(
  panelNodes: LayoutNode[],
  endpointId: string
): { node: LayoutNode; panelNode: LayoutNode } | null {
  const findInNode = (node: LayoutNode): LayoutNode | null => {
    if (node.type === 'endpoint' && node.domainId === endpointId) return node
    for (const child of node.children) {
      const found = findInNode(child)
      if (found) return found
    }
    return null
  }
  for (const panelNode of panelNodes) {
    const node = findInNode(panelNode)
    if (node) return { node, panelNode }
  }
  return null
}

function EendraadCanvasInner({ onMultiFingerSwipe, capabilities }: EendraadCanvasProps = {}) {
  const isActiveViewport = useIsActiveViewport()
  const window = useCanvasWindow()
  const viewportUI = useViewportUIApi()
  const { t, i18n } = useTranslation()
  const withJunctionEditorItem = useJunctionEditorMenu()
  const eendraadView = useCanvasUIStore((s) => s.eendraadView)
  const requestFitToView = useCanvasUIStore((s) => s.requestFitToView)
  const activePanelId = useCanvasUIStore((s) => s.activePanelId)
  const eendraadViewRef = useRef(eendraadView)
  eendraadViewRef.current = eendraadView
  const setEendraadView = useCanvasUIStore((s) => s.setEendraadView)
  const setSelection = useCanvasUIStore((s) => s.setSelection)
  const currentProject = useProjectStore((s: ProjectState) =>
    s.currentProject ? getEendraadRenderProjectRevision(s.currentProject) : null
  )
  const getEjectPlanPlacement = useCallback(() => {
    if (!currentProject) return undefined
    const ui = viewportUI.getState()
    const floorId = resolveSitplanTargetFloorId(currentProject, ui.activeFloorId)
    if (!floorId) return undefined
    const floor = selectProjectBuildingFloors(currentProject).find((candidate) => candidate.id === floorId)
    if (!floor) return undefined
    return {
      floorId,
      layer: 'layers' in floor && Array.isArray(floor.layers) ? floor.layers[0] ?? 'electrical' : 'electrical',
      pos:
        getViewportCenterPlanSpaceIfApplicable(
          ui.viewportLayout,
          ui.planCanvasViewportPx,
          ui.activeFloorId,
          floorId,
          ui.planView
        ) ?? { x: 400, y: 300 },
    }
  }, [currentProject, viewportUI])
  const eendraadNotes = useMemo(
    () => (currentProject ? queryOneWireNotes(currentProject) : []),
    [currentProject]
  )
  const currentProjectStorageMode = useProjectStore(
    (s: ProjectState) => s.currentProjectStorageMode
  )
  const selection = useCanvasUIStore((s) => s.selection)
  const eendraadDateMarkingMode = useCanvasUIStore((s) => s.eendraadDateMarkingMode)
  const setEendraadDateMarkingMode = useCanvasUIStore((s) => s.setEendraadDateMarkingMode)
  const eendraadDateMarkingVisibility = useCanvasUIStore((s) => s.eendraadDateMarkingVisibility)
  const setEendraadDateMarkingVisibility = useCanvasUIStore((s) => s.setEendraadDateMarkingVisibility)
  
  const canEditProject = capabilities?.canEditProject ?? true
  const canPlaceSymbols = capabilities?.canPlaceSymbols ?? true
  const canDragItems = capabilities?.canDragItems ?? true
  const canDeleteItems = capabilities?.canDeleteItems ?? true
  const addCircuit = useProjectStore((s: ProjectState) => s.addCircuit)
  const addEndpoint = useProjectStore((s: ProjectState) => s.addEndpoint)
  const addPlacement = useProjectStore((s: ProjectState) => s.addPlacement)
  const addTrunkDevice = useProjectStore((s: ProjectState) => s.addTrunkDevice)
  const updateTrunkDevice = useProjectStore((s: ProjectState) => s.updateTrunkDevice)
  const addSupplyTrunkDevice = useProjectStore((s: ProjectState) => s.addSupplyTrunkDevice)
  const updateSupplyTrunkDevice = useProjectStore((s: ProjectState) => s.updateSupplyTrunkDevice)
  const addGroundTrunkDevice = useProjectStore((s: ProjectState) => s.addGroundTrunkDevice)
  const updateGroundTrunkDevice = useProjectStore((s: ProjectState) => s.updateGroundTrunkDevice)
  const insertProtectionAfter = useProjectStore((s: ProjectState) => s.insertProtectionAfter)
  const getProtectionById = useProjectStore((s: ProjectState) => s.getProtectionById)
  const getPanelById = useProjectStore((s: ProjectState) => s.getPanelById)
  const getFloorById = useProjectStore((s: ProjectState) => s.getFloorById)
  const getCircuitById = useProjectStore((s: ProjectState) => s.getCircuitById)
  const getEndpointById = useProjectStore((s: ProjectState) => s.getEndpointById)
  const getTrunkDeviceById = useProjectStore((s: ProjectState) => s.getTrunkDeviceById)
  const updateCircuit = useProjectStore((s: ProjectState) => s.updateCircuit)
  const updatePanel = useProjectStore((s: ProjectState) => s.updatePanel)
  const updateProtection = useProjectStore((s: ProjectState) => s.updateProtection)
  const updateEndpoint = useProjectStore((s: ProjectState) => s.updateEndpoint)
  const updateProject = useProjectStore((s: ProjectState) => s.updateProject)
  const moveCircuitOnMainBus = useCallback(
    (panelId: string, circuitId: string, direction: 'left' | 'right') =>
      runEendraadBusMove({ kind: 'mainBusDirection', panelId, circuitId, direction }),
    []
  )
  const moveCircuitToSecondaryBus = useCallback(
    (panelId: string, parentCircuitId: string, circuitId: string, insertIndex: number) =>
      runEendraadBusMove({ kind: 'secondaryBus', panelId, parentCircuitId, circuitId, insertIndex }),
    []
  )
  const withSingleUndoEntry = useProjectStore((s: ProjectState) => s.withSingleUndoEntry)
  const updateInstallation = useProjectStore((s: ProjectState) => s.updateInstallation)
  const applyAutomaticEendraadNamingAllPanels = useProjectStore(
    (s: ProjectState) => s.applyAutomaticEendraadNamingAllPanels
  )
  const resetAllEendraadLabelOverrides = useProjectStore(
    (s: ProjectState) => s.resetAllEendraadLabelOverrides
  )
  const updateEendraadNote = useProjectStore((s: ProjectState) => s.updateEendraadNote)
  const getFramesByPanel = useProjectStore((s: ProjectState) => s.getFramesByPanel)
  const openDialog = useDialogStore((s) => s.openDialog)
  const canvasRef = useRef<BaseCanvasHandle>(null)
  const minZoom = useProjectStore((state) => getPanelCanvasZoomMinimum(state.currentProject))
  const pendingConverterResizeAnchorRef = useRef<{
    deviceId: string
    previousAnchor: Point
    previousView: { pan: Point; zoom: number }
  } | null>(null)
  const viewportHitRefreshTimerRef = useRef<number | null>(null)
  const viewportHitNeedsRemeasureRef = useRef(false)
  const viewportHitViewRef = useRef({
    pan: eendraadView.pan,
    zoom: eendraadView.zoom,
    viewport: { width: 0, height: 0 } as CanvasSize,
  })
  const beginInteractiveOverlayPan = useCallback((clientX: number, clientY: number) => {
    canvasRef.current?.beginDeferredMousePan(clientX, clientY)
  }, [])
  const containerRef = useRef<HTMLDivElement>(null)
  const pointerOverEendraadRef = useRef(false)
  const contextMenuItemsResolverRef = useRef<
    ((position: Point, elementId: string | null) => ContextMenuItem[]) | null
  >(null)
  /** First trunk drag-move per gesture logs [TrunkDeviceDnD] canvas:drag-start; cleared on drag end. */
  const trunkDnDLoggedStartRef = useRef(false)
  /** Set on drag start from Alt/Option; cleared when drag ends. */
  const elementDragModeRef = useRef<'move' | 'duplicate'>('move')
  /** Alt-duplicate uses window pointer events; Konva drag-end must be ignored. */
  const suppressKonvaDragEndRef = useRef(false)
  const altDuplicatePointerCleanupRef = useRef<(() => void) | null>(null)
  const draggingProtectionIdRef = useRef<string | null>(null)
  const movingPanelAttachmentIdRef = useRef<string | null>(null)
  const internalDragElementIdRef = useRef<string | null>(null)
  const endpointDragStartSelectionIdsRef = useRef<string[] | null>(null)
  const [internalDragPlacement, setInternalDragPlacement] = useState<
    (DropZoneHintRelocation & { symbol: SymbolMetadata }) | null
  >(null)
  const [altDuplicatePointerDragActive, setAltDuplicatePointerDragActive] = useState(false)
  const [addElementDropPosition, setAddElementDropPosition] = useState<Point | null>(null)
  const [openEendraadMenu, setOpenEendraadMenu] = useState<'naming' | null>(null)
  const [namingGuidanceHighlighted, setNamingGuidanceHighlighted] = useState(false)
  const currentInstallation = currentProject
    ? getProjectElectricalInstallation(currentProject)
    : undefined
  const currentPanels = currentProject ? getProjectElectricalPanels(currentProject) : EMPTY_PANELS
  const eendraadAutoNaming = !!currentInstallation?.eendraadAutomaticNaming
  const eendraadLabelScheme = resolveLabelScheme(currentInstallation?.labelScheme)
  const savedLabelStyles = useSettingsStore((s) => s.labelStyles)
  const hasCustomEendraadLabels = useMemo(
    () => !!currentProject && projectHasManualEendraadLabelOverrides(currentProject),
    [currentProject]
  )

  useEffect(() => {
    let highlightTimeout: number | undefined
    const openNamingGuidance = () => {
      setOpenEendraadMenu('naming')
      setNamingGuidanceHighlighted(true)
      window.clearTimeout(highlightTimeout)
      highlightTimeout = window.setTimeout(() => setNamingGuidanceHighlighted(false), 1800)
    }
    window.addEventListener(OPEN_EENDRAAD_NAMING_GUIDANCE_EVENT, openNamingGuidance)
    return () => {
      window.removeEventListener(OPEN_EENDRAAD_NAMING_GUIDANCE_EVENT, openNamingGuidance)
      window.clearTimeout(highlightTimeout)
    }
  }, [window])
  
  const eendraadHideFeederLetters = installationHideFeederLetters(currentInstallation)
  const { advancedPanelLabels, installationDates } = useEditionFeatureAvailability(
    currentProject?.project.id,
    {
      storageMode: currentProjectStorageMode,
    }
  )
  const isDemoProject = isDemoProjectId(currentProject?.project.id)
  const canUseInstallDates = canEditProject && (isDemoProject || installationDates)
  const installDatesVisible =
    canUseInstallDates &&
    (eendraadDateMarkingMode || eendraadDateMarkingVisibility.installDatesVisible)
  const [dateToolYear, setDateToolYear] = useState('')
  const [dateToolMonth, setDateToolMonth] = useState(1)
  const [dateToolDay, setDateToolDay] = useState(1)
  const [dateToolCalendarOpen, setDateToolCalendarOpen] = useState(false)
  const [viewportPixelSize, setViewportPixelSize] = useState<CanvasSize>({ width: 0, height: 0 })
  viewportHitViewRef.current = {
    pan: eendraadView.pan,
    zoom: eendraadView.zoom,
    viewport: viewportPixelSize,
  }
  const [closedDateToolSelectionKey, setClosedDateToolSelectionKey] = useState<string | null>(null)
  const [dateToolFrameSelection, setDateToolFrameSelection] = useState<{
    year: number
    bounds: { x: number; y: number; width: number; height: number }
    selectionKey: string
  } | null>(null)
  const dateToolInputRef = useRef<HTMLInputElement>(null)
  const suppressDateFrameSelectionRef = useRef(false)
  const clearDateFrameSelectionSuppressionRef = useRef<number | null>(null)

  const exitDateMarkingMode = useCallback(() => {
    setEendraadDateMarkingMode(false)
    setDateToolCalendarOpen(false)
    setDateToolFrameSelection(null)
    setClosedDateToolSelectionKey(null)
  }, [setEendraadDateMarkingMode])

  useEffect(() => {
    if (!eendraadDateMarkingMode) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      exitDateMarkingMode()
    }

    window.addEventListener('keydown', handleEscape, true)
    return () => window.removeEventListener('keydown', handleEscape, true)
  }, [eendraadDateMarkingMode, exitDateMarkingMode, window])

  const handleViewportPanStateChange = useCallback((isPanning: boolean) => {
    if (clearDateFrameSelectionSuppressionRef.current != null) {
      window.clearTimeout(clearDateFrameSelectionSuppressionRef.current)
      clearDateFrameSelectionSuppressionRef.current = null
    }
    if (isPanning) {
      suppressDateFrameSelectionRef.current = true
      return
    }
    // Konva can emit click after mouseup. Keep suppression through that event turn.
    clearDateFrameSelectionSuppressionRef.current = window.setTimeout(() => {
      suppressDateFrameSelectionRef.current = false
      clearDateFrameSelectionSuppressionRef.current = null
    }, 0)
  }, [window])

  useEffect(
    () => () => {
      if (clearDateFrameSelectionSuppressionRef.current != null) {
        window.clearTimeout(clearDateFrameSelectionSuppressionRef.current)
      }
    },
    [window]
  )

  const setEendraadClipboard = useCanvasUIStore((s) => s.setEendraadClipboard)
  const libraryDragSymbol = useCanvasUIStore((s) => s.libraryDragSymbol)

  // Register canvas for export
  const registerEendraad = useCanvasRegistryStore((s) => s.registerEendraad)
  useEffect(() => {
    return registerEendraad(
      () => canvasRef.current?.getStage() ?? null,
      () => canvasRef.current?.fitToView()
    )
  }, [registerEendraad])

  // Calculate layout and wire segments
  const layout = useEendraadLayout()
  const layoutTree = useLayoutTree() // Tree-based rendering and operations
  const wireSegments = useEendraadWireSegments() // Tree-based wire generation
  // Sidebar hover/focus preview of the alternative changeover port-1 feed (UI state only).
  const changeoverGridSourcePreviewScene = useChangeoverGridSourcePreview(
    wireSegments,
    layoutTree,
    layout?.infoBlockLogo === true
  )

  const resizeConverterWithViewportAnchor = useCallback(
    (deviceId: string, connectionCount: number, previousAnchor: Point): boolean => {
      const previousView = viewportUI.getState().eendraadView
      pendingConverterResizeAnchorRef.current = {
        deviceId,
        previousAnchor,
        previousView: { pan: { ...previousView.pan }, zoom: previousView.zoom },
      }
      const resized = resizeConverterDcConnections(deviceId, connectionCount)
      if (!resized) pendingConverterResizeAnchorRef.current = null
      return resized
    },
    [viewportUI]
  )

  useLayoutEffect(() => {
    const pending = pendingConverterResizeAnchorRef.current
    if (!pending || !layoutTree) return
    const nextAnchor = findClosestLayoutNodeAnchor(
      layoutTree.panels,
      pending.deviceId,
      pending.previousAnchor
    )
    pendingConverterResizeAnchorRef.current = null
    if (!nextAnchor) return
    setEendraadView({
      zoom: pending.previousView.zoom,
      pan: getPanPreservingWorldAnchor(
        pending.previousView.pan,
        pending.previousView.zoom,
        pending.previousAnchor,
        nextAnchor
      ),
    })
  }, [layoutTree, setEendraadView])

  const refreshViewportHitGraph = useCallback((remeasure: boolean) => {
    const stage = canvasRef.current?.getStage()
    const contentGroup = stage?.findOne('.canvas-content')
    if (!stage || !contentGroup) return

    const { pan, zoom, viewport } = viewportHitViewRef.current
    if (viewport.width <= 0 || viewport.height <= 0 || !Number.isFinite(zoom) || zoom <= 0) {
      return
    }

    const overscan = VIEWPORT_HIT_OVERSCAN_PX / zoom
    const visibleBounds: ViewportHitBounds = {
      left: -pan.x / zoom - overscan,
      top: -pan.y / zoom - overscan,
      right: (viewport.width - pan.x) / zoom + overscan,
      bottom: (viewport.height - pan.y) / zoom + overscan,
    }
    let changed = false

    stage.find(VIEWPORT_HIT_CULLABLE_SELECTOR).forEach((node) => {
      let hitBounds = remeasure
        ? undefined
        : (node.getAttr(VIEWPORT_HIT_BOUNDS_ATTRIBUTE) as ViewportHitBounds | undefined)
      if (!hitBounds) {
        const rect = node.getClientRect({ relativeTo: contentGroup as Konva.Container })
        if (
          !Number.isFinite(rect.x) ||
          !Number.isFinite(rect.y) ||
          !Number.isFinite(rect.width) ||
          !Number.isFinite(rect.height)
        ) {
          return
        }
        hitBounds = {
          left: rect.x,
          top: rect.y,
          right: rect.x + rect.width,
          bottom: rect.y + rect.height,
        }
        node.setAttr(VIEWPORT_HIT_BOUNDS_ATTRIBUTE, hitBounds)
      }

      const shouldListen = boundsIntersect(hitBounds, visibleBounds)
      if (node.listening() === shouldListen) return
      node.listening(shouldListen)
      changed = true
    })

    // Only the pixel hit canvas changed; avoid repainting the visible scene.
    if (changed) contentGroup.getLayer()?.drawHit()
  }, [])

  const scheduleViewportHitGraphRefresh = useCallback(
    (remeasure: boolean) => {
      viewportHitNeedsRemeasureRef.current ||= remeasure
      if (viewportHitRefreshTimerRef.current != null) {
        window.clearTimeout(viewportHitRefreshTimerRef.current)
      }
      viewportHitRefreshTimerRef.current = window.setTimeout(() => {
        viewportHitRefreshTimerRef.current = null
        const needsRemeasure = viewportHitNeedsRemeasureRef.current
        viewportHitNeedsRemeasureRef.current = false
        refreshViewportHitGraph(needsRemeasure)
      }, 100)
    },
    [refreshViewportHitGraph, window]
  )

  useEffect(() => {
    scheduleViewportHitGraphRefresh(true)
  }, [layoutTree, scheduleViewportHitGraphRefresh, wireSegments])

  useEffect(() => {
    scheduleViewportHitGraphRefresh(false)
  }, [
    eendraadView.pan.x,
    eendraadView.pan.y,
    eendraadView.zoom,
    scheduleViewportHitGraphRefresh,
    viewportPixelSize.height,
    viewportPixelSize.width,
  ])

  useEffect(
    () => () => {
      if (viewportHitRefreshTimerRef.current != null) {
        window.clearTimeout(viewportHitRefreshTimerRef.current)
      }
    },
    [window]
  )

  // Ensure the main panel is visible on first render when no saved view exists.
  // This runs from layout data alone — no Konva dependency — so it fires
  // immediately without waiting for the canvas scene graph to populate.
  const hasSetInitialView = useRef(false)
  useEffect(() => {
    if (hasSetInitialView.current || !layout || layout.panels.length === 0) return
    const view = viewportUI.getState().eendraadView
    if (view.pan.x !== 0 || view.pan.y !== 0) {
      hasSetInitialView.current = true
      return
    }
    hasSetInitialView.current = true
    const frame = layout.panels[0]!.frame
    const contentCenterX = frame.x + frame.width / 2
    const contentCenterY = frame.y + frame.height / 2
    const el = canvasRef.current?.getStage()?.container()
    const rect = el?.getBoundingClientRect()
    const vpW = rect?.width ?? 800
    const vpH = rect?.height ?? 600
    const padding = Math.min(vpW, vpH) * 0.1
    const fitZoom = Math.min(
      (vpW - padding * 2) / frame.width,
      (vpH - padding * 2) / frame.height,
      2
    )
    const zoom = Math.max(0.1, fitZoom)
    setEendraadView({
      zoom,
      pan: {
        x: vpW / 2 - contentCenterX * zoom,
        y: vpH / 2 - contentCenterY * zoom,
      },
    })
  }, [layout, setEendraadView, viewportUI])

  useEendraadCircuitLetterHotkeys(currentProject, pointerOverEendraadRef)

  // Convert pointer position from a Konva drag event to canvas/layout coordinates (for correct drop target).
  // Uses cursor position so drop target matches where the user released, not where the dragged symbol is.
  const getCanvasPositionFromEvent = useCallback((e: unknown) => {
    if (!isKonvaPointerEventLike(e)) return null
    const stage = e.target?.getStage?.()
    const pointer = stage?.getPointerPosition?.()
    if (!pointer) return null
    const view = canvasRef.current?.getLiveViewTransform() ?? eendraadViewRef.current
    return {
      x: (pointer.x - view.pan.x) / view.zoom,
      y: (pointer.y - view.pan.y) / view.zoom,
    }
  }, [])

  /** Match handleDrop / endpoint drag: resolve vertical trunk wire domain from segments under the cursor. */
  const augmentCircuitVerticalWireDomain = useCallback(
    (rawTarget: DropTarget, position: Point): DropTarget => {
      let dropTarget = rawTarget
      if (
        rawTarget.type === 'circuit' &&
        rawTarget.circuitId &&
        rawTarget.panelId &&
        typeof rawTarget.circuitTrunkSegmentIndex !== 'number'
      ) {
        const panelWires = wireSegments.filter(
          (ws) => ws.panelId === rawTarget.panelId && ws.circuitId === rawTarget.circuitId
        )
        const verticalCandidates = panelWires.filter(
          (ws) => ws.type === 'vertical' && ws.startPoint.x === ws.endPoint.x
        )
        const hitVertical = verticalCandidates.find((ws) => {
          const x = ws.startPoint.x
          const minY = Math.min(ws.startPoint.y, ws.endPoint.y)
          const maxY = Math.max(ws.startPoint.y, ws.endPoint.y)
          const withinX = Math.abs(position.x - x) <= 15
          const withinY = position.y >= minY - 10 && position.y <= maxY + 10
          return withinX && withinY
        })
        if (hitVertical) {
          dropTarget = { ...rawTarget, wireDomain: hitVertical.domain as DropTarget['wireDomain'] }
        }
      }
      return dropTarget
    },
    [wireSegments]
  )

  /** Circuit trunk device drag: ignore other trunk device symbols; resolve segment from wire geometry. */
  const resolveTrunkRelocateDropTarget = useCallback(
    (position: Point): DropTarget | null => {
      if (!layoutTree) return null
      const { target: rawTarget } = findDropTargetWithDebug(layoutTree, position, {
        ignoreCircuitTrunkDeviceSymbolHits: true,
      })
      const augmented = augmentCircuitVerticalWireDomain(rawTarget, position)
      return ensureCircuitTrunkWireSegmentOnDropTarget(layoutTree, position, augmented)
    },
    [augmentCircuitVerticalWireDomain, layoutTree]
  )

  // When wire segments are regenerated or a selection arrives from another surface (such as
  // validation), re-sync it so the same logical wire uses this canvas instance's generated ID.
  useEffect(() => {
    if (selection.type !== 'wire' || selection.ids.length === 0 || !selection.wireMetadata?.length)
      return
    const resolveByMetadata = (metadata: NonNullable<typeof selection.wireMetadata>[number]) => {
      if (metadata.wireAnchor) return wireSegments.find(wire => wire.wireAnchor === metadata.wireAnchor) ?? null
      let matched = null as (typeof wireSegments)[number] | null
      if (
        metadata.supplySectionKey ||
        (metadata.supplyAssemblyId && metadata.supplyConnectionId) ||
        metadata.isSupply
      ) {
        matched = resolveSupplyWireSegmentByMetadata(wireSegments, metadata)
      } else if (
        metadata.domoticaOutputGroup &&
        typeof metadata.domoticaOutputIndex === 'number' &&
        metadata.circuitId
      ) {
        matched =
          wireSegments.find(
            (ws) =>
              ws.type === 'branch' &&
              ws.circuitId === metadata.circuitId &&
              ws.panelId === metadata.panelId &&
              ws.domoticaOutputGroup === metadata.domoticaOutputGroup &&
              ws.domoticaOutputIndex === metadata.domoticaOutputIndex
          ) ?? null
      } else if (metadata.isGround) {
        matched =
          wireSegments.find(
            (ws) =>
              ws.type === 'vertical' &&
              ws.fromElementType === 'ground' &&
              ws.panelId === metadata.panelId
          ) ?? null
      } else if (metadata.circuitId) {
        matched = resolveCircuitWireSegmentByMetadata(wireSegments, metadata)
      }
      return matched
    }
    const updatedIds: string[] = []
    const updatedMetadata: NonNullable<typeof selection.wireMetadata> = []
    for (const selectedId of selection.ids) {
      if (wireSegments.some((ws) => ws.id === selectedId)) {
        const metadata = selection.wireMetadata.find((m) => m.id === selectedId)
        updatedIds.push(selectedId)
        if (metadata) updatedMetadata.push(metadata)
        continue
      }
      const metadata = selection.wireMetadata.find((m) => m.id === selectedId)
      if (!metadata) continue
      const matched = resolveByMetadata(metadata)
      logger.info('[Wire Selection Debug][canvas rematch]', {
        requestedId: selectedId,
        metadata,
        matched: matched
          ? {
              id: matched.id,
              type: matched.type,
              domain: matched.domain,
              circuitId: matched.circuitId,
              panelId: matched.panelId,
              fromElementType: matched.fromElementType,
              fromElementId: matched.fromElementId,
              toElementType: matched.toElementType,
              toElementId: matched.toElementId,
              startPoint: matched.startPoint,
              endPoint: matched.endPoint,
            }
          : null,
      })
      if (!matched) continue
      updatedIds.push(matched.id)
      updatedMetadata.push({ ...metadata, id: matched.id })
    }
    const sameIds =
      updatedIds.length === selection.ids.length &&
      updatedIds.every((id, idx) => id === selection.ids[idx])
    if (sameIds) return
    if (updatedIds.length > 0) {
      setSelection({
        ...selection,
        ids: Array.from(new Set(updatedIds)),
        wireMetadata: updatedMetadata,
      })
    }
  }, [selection, wireSegments, setSelection])

  // Drop target detection
  const detectDropTargetCallback = useDropTargetDetection() // Tree-based hit testing

  const branchTargetCache = useRef<{
    layout: typeof layout; key: string; targets: BranchDropTargets; previousId: string | null
  } | null>(null)
  const branchMovingIds = useCallback(() => {
    const id = internalDragElementIdRef.current
    if (!id || elementDragModeRef.current === 'duplicate') return []
    if (!useProjectStore.getState().getEndpointById(id)) return []
    return endpointDragStartSelectionIdsRef.current ?? [id]
  }, [])
  const getBranchTargets = useCallback((symbol: SymbolMetadata, movingIds = branchMovingIds()) => {
    const zoom = canvasRef.current?.getLiveViewTransform().zoom ?? eendraadViewRef.current.zoom
    const key = JSON.stringify([symbol.id, zoom, movingIds])
    if (!branchTargetCache.current || branchTargetCache.current.layout !== layout || branchTargetCache.current.key !== key) {
      branchTargetCache.current = {
        layout, key, previousId: null,
        targets: layout && layoutTree ? collectBranchDropTargets(layout, layoutTree, symbol, zoom, movingIds)
          : { intents: [], regions: [], endpointNodeIds: new Set(), circuitIds: new Set() },
      }
    }
    return { ...branchTargetCache.current, zoom }
  }, [layout, layoutTree, branchMovingIds])
  const resolveBranchDrop = useCallback((position: Point, symbol: SymbolMetadata, movingIds?: string[]) => {
    const internalId = internalDragElementIdRef.current
    if (internalId && (elementDragModeRef.current === 'duplicate' ||
      !useProjectStore.getState().getEndpointById(internalId))) return { handled: false, intent: null }
    const ids = movingIds ?? branchMovingIds()
    if (ids.some((id) => !useProjectStore.getState().getEndpointById(id))) return { handled: false, intent: null }
    const { targets, zoom, previousId } = getBranchTargets(symbol, ids)
    let resolved = resolveBranchDropIntent(targets, position, zoom, previousId)
    if (!resolved.handled && targets.intents.length && layoutTree) {
      const target = findDropTarget(layoutTree, position, { preferMainBusOverGroundWire: true })
      const circuit = target.circuitId ? useProjectStore.getState().getCircuitById(target.circuitId) : null
      const intent = resolveBranchStemFallback(targets, layoutTree, position)
        ?? (circuit ? resolveBranchDropFallback(targets, target, circuit, symbol) : null)
      if (intent) resolved = { handled: true, intent }
    }
    branchTargetCache.current!.previousId = resolved.intent?.id ?? null
    return resolved
  }, [getBranchTargets, branchMovingIds, layoutTree])

  // Drag preview state and handler
  const { dragPreview: pendingDragPreview, setDragPreview, handleDragOver } = useEendraadDragPreview(
    detectDropTargetCallback,
    {
      resolveBranchDrop,
      clearBranchDrop: () => { if (branchTargetCache.current) branchTargetCache.current.previousId = null },
      draggingProtectionIdRef,
      getProtectionById: (id) => getProtectionById(id),
      movingPanelAttachmentIdRef,
      isPanelAttachmentDropAllowed: (panelId, target) =>
        currentProject
          ? isPanelAttachmentDropTargetTerminal(
              getProjectElectricalPanels(currentProject),
              panelId,
              target
            )
          : false,
      resolveSameSymbolAddMore: (position, symbol) => {
        if (!layoutTree) return null
        const target = findSameSymbolAddMoreLayoutTargets(symbol.id, layoutTree, position)[0]
        if (!target) return null
        const internalId = internalDragElementIdRef.current
        if (internalId) {
          const source = getEndpointById(internalId)
          const endpoint = target.target.endpoint
          if (!source || !endpoint) return null
          if (elementDragModeRef.current === 'duplicate' && source.id === endpoint.id) return target
          if (!source.domoticaChildProps || !endpoint.domoticaChildProps ||
            (endpointDragStartSelectionIdsRef.current?.length ?? 1) !== 1 ||
            !endpointMergeSettingsMatchEndpoints(source, endpoint) ||
            findDropTarget(layoutTree, position).domoticaChildDropIntent !== 'replace') return null
          return source.id === endpoint.id ? null : target
        }
        const targetId = target.target.endpoint?.id ?? target.target.trunkDevice?.id
        return targetId === internalDragElementIdRef.current ? null : target
      },
      isBlockedDropPosition: (position) =>
        layoutTree ? positionHitsMultiplierBadge(layoutTree, position) : false,
    }
  )
  const dragPreview = validateEendraadPreview(currentProject, pendingDragPreview,
    createUiDropBehaviorHooks(window.document).getSitplanTarget(),
    elementDragModeRef.current === 'duplicate' && internalDragPlacement ? {
      id: internalDragPlacement.elementId,
      kind: getEndpointById(internalDragPlacement.elementId) ? 'endpoint'
        : getProtectionById(internalDragPlacement.elementId) ? 'protection' : 'trunkDevice',
    } : undefined)
  const trunkBranchSlotMarkerRef = useRef<Konva.Circle | null>(null)

  // Keep an internally dragged symbol active independently from the currently
  // hovered target. Relocation may clear dragPreview while the pointer is
  // between wires, but the legal drop-zone hints should remain visible.
  const activePlacementSymbol =
    dragPreview?.symbolData ?? internalDragPlacement?.symbol ?? libraryDragSymbol
  const activePlacementSymbolId = activePlacementSymbol?.id
  const useBranchInteraction = !internalDragElementIdRef.current ||
    (elementDragModeRef.current !== 'duplicate' && !!getEndpointById(internalDragElementIdRef.current) &&
      branchMovingIds().every((id) => !!getEndpointById(id)))
  const branchDropTargets = canPlaceSymbols && activePlacementSymbol && useBranchInteraction
    ? getBranchTargets(activePlacementSymbol).targets : null

  const activeDropTargetNodeId = useMemo(() => {
    if (!layoutTree || !dragPreview?.dropTarget || dragPreview.position.x === -Infinity) {
      return null
    }
    const hitTestOptions: FindDropTargetOptions = {
      ...(dragPreview.relocatingTrunkDevice ? { ignoreCircuitTrunkDeviceSymbolHits: true } : {}),
      ...(activePlacementSymbolId !== 'earthing_separator'
        ? { preferMainBusOverGroundWire: true }
        : {}),
      ...(activePlacementSymbolId &&
      PROTECTION_SYMBOL_IDS.includes(
        activePlacementSymbolId as (typeof PROTECTION_SYMBOL_IDS)[number]
      )
        ? { preferSecondaryBusForNestedProtection: true }
        : {}),
    }
    const { debug } = findDropTargetWithDebug(layoutTree, dragPreview.position, hitTestOptions)
    const matched = debug.path.find((step) => step.matched && step.nodeId)
    return matched?.nodeId ?? null
  }, [activePlacementSymbolId, layoutTree, dragPreview])

  // A validated library protection on a drawn rail needs only the committed rail geometry.
  const liveProtectionBusPreview = !internalDragPlacement && dragPreview &&
    !dragPreview.movingProtection && !dragPreview.relocatingTrunkDevice &&
    !dragPreview.relocatingSupplyTrunkDevice && !dragPreview.movingEndpointSelection &&
    !dragPreview.movingPanelAttachment && !dragPreview.branchIntent && !dragPreview.sameSymbolAddMore
      ? resolveLiveProtectionBusPreview(dragPreview.symbolData?.id, dragPreview.dropTarget, dragPreview.position, wireSegments)
      : null

  // Layout + wires preview graph based on simulated drop
  const previewGraph = useEendraadPreviewGraph(
    liveProtectionBusPreview || dragPreview?.sameSymbolAddMore || dragPreview?.branchIntent ? null : dragPreview,
    layout
  )

  useEffect(() => {
    if (!import.meta.env.VITE_E2E) return
    ;(
      window as Window & {
        __eendraNestedPreviewDebug?: {
          dropTarget: DropTarget | null
          createdProtectionIds: string[]
          affectedPanelIds: string[]
          liveBusPreview: boolean
        }
      }
    ).__eendraNestedPreviewDebug = {
      dropTarget: dragPreview?.dropTarget ?? null,
      createdProtectionIds: previewGraph?.createdProtectionIds ?? [],
      affectedPanelIds: previewGraph?.affectedPanelIds ?? [],
      liveBusPreview: liveProtectionBusPreview != null,
    }
  }, [dragPreview?.dropTarget, previewGraph, liveProtectionBusPreview, window])

  useEffect(() => {
    if (!import.meta.env.VITE_E2E || !layoutTree) return

    const showNestedProtectionPreview = (event: Event) => {
      const {
        circuitId,
        mainBusPanelId,
        mainBusFraction = 0.5,
        symbolId = 'mcb',
        secondaryBusInsertIndex,
        secondaryBusItemCount,
        targetRegion = 'tip-upper',
      } = (
        event as CustomEvent<{
          circuitId?: string
          mainBusPanelId?: string
          mainBusFraction?: number
          symbolId?: string
          secondaryBusInsertIndex?: number
          secondaryBusItemCount?: number
          targetRegion?:
            | 'tip-upper'
            | 'tip-center'
            | 'tip-outer'
            | 'body-center'
            | 'body-outer'
            | 'feeder-center'
        }>
      ).detail ?? { circuitId: undefined }
      if (mainBusPanelId) {
        const panel = layout?.panels.find((item) => item.panel.id === mainBusPanelId && item.frameRole !== 'supply')
        const symbol = getSymbolById(symbolId)
        if (panel && symbol) handleDragOver({
          x: panel.mainBus.x + panel.mainBus.width * mainBusFraction,
          y: panel.mainBus.y,
        }, symbol)
        return
      }
      if (!circuitId) return

      let nestNode: LayoutNode | null = null
      let protectionNode: LayoutNode | null = null
      let feederNode: LayoutNode | null = null
      const visit = (node: LayoutNode) => {
        if (node.id === `circuit-nest-${circuitId}`) {
          nestNode = node
        }
        if (node.type === 'mcb' && node.circuitIdForWires === circuitId) protectionNode = node
        if (!feederNode && node.id?.startsWith(`circuit-trunk-${circuitId}-segment-`)) {
          feederNode = node
        }
        node.children?.forEach(visit)
      }
      layoutTree.panels.forEach(visit)
      const targetNode = targetRegion.startsWith('body')
        ? protectionNode
        : targetRegion === 'feeder-center'
          ? feederNode
          : nestNode
      if (!targetNode) return

      const symbol = getSymbolById(symbolId)
      if (!symbol) return
      if (typeof secondaryBusInsertIndex === 'number') {
        const findNodeById = (node: LayoutNode, id: string): LayoutNode | undefined => {
          if (node.id === id) return node
          for (const child of node.children) {
            const match = findNodeById(child, id)
            if (match) return match
          }
          return undefined
        }
        const secondaryBusNode = layoutTree.panels
          .map((panel) => findNodeById(panel, `secondary-bus-${circuitId}`))
          .find((node): node is LayoutNode => !!node)
        if (!secondaryBusNode) return

        const childXs = [...(secondaryBusNode.nestedChildXs ?? [])].sort((a, b) => a - b)
        const slotX =
          secondaryBusInsertIndex <= 0
            ? secondaryBusNode.bounds.x + 1
            : secondaryBusInsertIndex >= childXs.length
              ? secondaryBusNode.bounds.x + secondaryBusNode.bounds.width - 1
              : ((childXs[secondaryBusInsertIndex - 1] ?? secondaryBusNode.bounds.x) +
                  (childXs[secondaryBusInsertIndex] ??
                    secondaryBusNode.bounds.x + secondaryBusNode.bounds.width)) /
                2
        const panelNode = layoutTree.panels.find((panel) =>
          Boolean(findNodeById(panel, secondaryBusNode.id))
        )
        if (!panelNode?.domainId) return

        setDragPreview({
          position: {
            x: slotX,
            y: secondaryBusNode.bounds.y + secondaryBusNode.bounds.height / 2,
          },
          symbolData: symbol,
          dropTarget: {
            type: 'circuit',
            panelId: panelNode.domainId,
            circuitId,
            secondaryBusInsertIndex,
            secondaryBusItemCount: secondaryBusItemCount ?? childXs.length,
          },
        })
        return
      }
      const bounds = getHitZoneBounds(targetNode, 'core')
      const paddedBounds = getHitZoneBounds(targetNode, 'padded')
      handleDragOver(
        targetRegion === 'tip-outer' || targetRegion === 'body-outer'
          ? {
              x: bounds.right + Math.min(5, (paddedBounds.right - bounds.right) / 2),
              y: (bounds.top + bounds.bottom) / 2,
            }
          : {
              x: (bounds.left + bounds.right) / 2,
              y: targetRegion === 'tip-upper' ? bounds.top + 8 : (bounds.top + bounds.bottom) / 2,
            },
        symbol
      )
    }

    window.addEventListener(
      'eendra:e2e-show-nested-protection-preview',
      showNestedProtectionPreview
    )
    return () =>
      window.removeEventListener(
        'eendra:e2e-show-nested-protection-preview',
        showNestedProtectionPreview
      )
  }, [handleDragOver, layout, layoutTree, setDragPreview, window])

  const preferLegacyDragPreview = false
  const isEmptyDomoticaOutputPreview =
    !!dragPreview?.dropTarget?.domoticaOutput &&
    !!dragPreview.dropTarget.panelId &&
    !!dragPreview.dropTarget.circuitId &&
    !!dragPreview.dropTarget.endpointId &&
    wireSegments.some(
      (ws) =>
        ws.panelId === dragPreview.dropTarget?.panelId &&
        ws.circuitId === dragPreview.dropTarget?.circuitId &&
        ws.type === 'branch' &&
        ws.fromElementId === dragPreview.dropTarget?.endpointId &&
        ws.domoticaOutputGroup === dragPreview.dropTarget?.domoticaOutput?.group &&
        ws.domoticaOutputIndex === dragPreview.dropTarget?.domoticaOutput?.index &&
        !ws.toElementId
    )
  const hasSimulatedPreviewVisuals =
    !!previewGraph &&
    !isEmptyDomoticaOutputPreview &&
    previewGraph.layout != null &&
    previewGraph.layoutTree != null &&
    previewGraph.affectedPanelIds.length > 0 &&
    (previewGraph.wireSegments.length > 0 ||
      previewGraph.createdEndpointIds.length > 0 ||
      previewGraph.createdProtectionIds.length > 0 ||
      previewGraph.createdTrunkDeviceIds.length > 0)
  // A trunk reorder draws its own slot preview; the generic fallback would show an
  // append-at-the-top preview for the same circuit target.
  const showLegacyDragPreview =
    !!dragPreview &&
    !liveProtectionBusPreview &&
    !dragPreview.branchIntent &&
    !dragPreview.trunkBranchSlot &&
    !isSupplyDropTarget(dragPreview.dropTarget) &&
    activePlacementSymbolId !== 'dc_bus' &&
    (preferLegacyDragPreview || !hasSimulatedPreviewVisuals)
  const showSimulatedDragPreview = hasSimulatedPreviewVisuals && !preferLegacyDragPreview
  const offscreenSupplyPreviewDirection = useMemo(() => {
    if (!layout || !previewGraph || !showSimulatedDragPreview) return null
    return resolveOffscreenSupplyPreviewDirection({
      currentLayout: layout,
      previewLayout: previewGraph.layout,
      pan: eendraadView.pan,
      zoom: eendraadView.zoom,
      viewport: viewportPixelSize,
    })
  }, [
    eendraadView.pan,
    eendraadView.zoom,
    layout,
    previewGraph,
    showSimulatedDragPreview,
    viewportPixelSize,
  ])

  const handleZoomChange = useCallback(
    (zoom: number) => {
      setEendraadView({ zoom })
    },
    [setEendraadView]
  )

  const handlePanChange = useCallback(
    (pan: { x: number; y: number }) => {
      setEendraadView({ pan })
    },
    [setEendraadView]
  )

  const handleViewTransformCommit = useCallback(
    (patch: { pan?: Point; zoom?: number }) => {
      setEendraadView(patch)
    },
    [setEendraadView]
  )

  // Selection bounds in 1‑wire view (used by BaseCanvas fit-to-selection)
  const handleGetSelectionBounds = useCallback(
    (selectionOverride?: Selection) => {
      const selection = selectionOverride ?? viewportUI.getState().selection
      if (!selection.type || !selection.ids || selection.ids.length === 0) {
        return null
      }

      if (selection.type === 'circuit' && selection.ids.length > 0) {
        const rootId = selection.ids[0]
        if (!rootId) return null
        const st = useProjectStore.getState()
        if (!st.currentProject) return null
        return computeEendraadCircuitFocusBounds({
          rootCircuitId: rootId,
          wireSegments,
          layoutTree,
          getCircuitById: st.getCircuitById,
          getProtectionForCircuit: st.getProtectionForCircuit,
          findPanelForCircuit: st.findPanelForCircuit,
        })
      }

      // Wires: use generated wireSegments (more precise than generic node bounds)
      if (selection.type === 'wire' || (selection.type === 'structuralConnection' && selection.wireAnchor)) {
        const selectedIds = new Set(selection.ids)
        const selectedAnchors = new Set(selection.wireMetadata?.flatMap(meta => meta.wireAnchors ?? (meta.wireAnchor ? [meta.wireAnchor] : [])) ?? [])
        if (selection.wireAnchor) selectedAnchors.add(selection.wireAnchor)
        let selectedSegments = wireSegments.filter((ws) => selectedIds.has(ws.id) || ws.wireAnchors?.some(anchor => selectedAnchors.has(anchor)))
        if (selectedSegments.length === 0 && selectedAnchors.size === 0 && selection.wireMetadata?.length) {
          const resolved = new Map<string, (typeof wireSegments)[number]>()
          for (const metadata of selection.wireMetadata) {
            let matched = null as (typeof wireSegments)[number] | null
            if (
              metadata.domoticaOutputGroup &&
              typeof metadata.domoticaOutputIndex === 'number' &&
              metadata.circuitId
            ) {
              matched =
                wireSegments.find(
                  (ws) =>
                    ws.type === 'branch' &&
                    ws.circuitId === metadata.circuitId &&
                    ws.panelId === metadata.panelId &&
                    ws.domoticaOutputGroup === metadata.domoticaOutputGroup &&
                    ws.domoticaOutputIndex === metadata.domoticaOutputIndex
                ) ?? null
            } else if (metadata.isGround) {
              matched =
                wireSegments.find(
                  (ws) =>
                    ws.type === 'vertical' &&
                    ws.fromElementType === 'ground' &&
                    ws.panelId === metadata.panelId
                ) ?? null
            } else if (
              metadata.supplySectionKey ||
              (metadata.supplyAssemblyId && metadata.supplyConnectionId) ||
              metadata.isSupply
            ) {
              matched = resolveSupplyWireSegmentByMetadata(wireSegments, metadata)
            } else if (metadata.circuitId) {
              if (metadata.fromElementId !== undefined || metadata.toElementId !== undefined) {
                matched =
                  wireSegments.find(
                    (ws) =>
                      ws.type === 'vertical' &&
                      ws.circuitId === metadata.circuitId &&
                      ws.panelId === metadata.panelId &&
                      (metadata.fromElementId === undefined ||
                        ws.fromElementId === metadata.fromElementId) &&
                      (metadata.toElementId === undefined ||
                        ws.toElementId === metadata.toElementId)
                  ) ?? null
              }
              if (!matched) {
                matched =
                  wireSegments.find(
                    (ws) =>
                      ws.type === 'vertical' &&
                      ws.circuitId === metadata.circuitId &&
                      ws.panelId === metadata.panelId
                  ) ?? null
              }
            }
            if (matched) resolved.set(matched.id, matched)
          }
          selectedSegments = Array.from(resolved.values())
        }
        if (selectedSegments.length === 0) return null

        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        let found = false

        for (const ws of selectedSegments) {
          const pts = [ws.startPoint, ws.endPoint]
          for (const p of pts) {
            if (!p) continue
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
            minX = Math.min(minX, p.x)
            minY = Math.min(minY, p.y)
            maxX = Math.max(maxX, p.x)
            maxY = Math.max(maxY, p.y)
            found = true
          }
        }

        if (
          !found ||
          !Number.isFinite(minX) ||
          !Number.isFinite(minY) ||
          !Number.isFinite(maxX) ||
          !Number.isFinite(maxY)
        ) {
          return null
        }

        const padding = 10
        return {
          x: minX - padding,
          y: minY - padding,
          width: maxX - minX + padding * 2,
          height: maxY - minY + padding * 2,
        }
      }

      // Other 1‑wire selections (endpoint, protection, trunkDevice, supply, panel)
      // Use layoutTree as the single source of truth for element bounds.
      if (!layoutTree) return null

      type LayoutNode = import('@/lib/layout/layoutTree').LayoutNode

      let selectedIds = new Set(selection.ids)
      const acceptableTypes: Array<import('@/lib/layout/layoutTree').LayoutNodeType> = []

      if (selection.type === 'endpoint') {
        acceptableTypes.push('endpoint')
      } else if (selection.type === 'placement') {
        acceptableTypes.push('endpoint')
        selectedIds = endpointIdsForPlacementSelection(
          () => useProjectStore.getState().getAllEndpoints(),
          selection.ids
        )
        if (selectedIds.size === 0) return null
      } else if (selection.type === 'protection') {
        acceptableTypes.push('mcb', 'rcd')
      } else if (selection.type === 'trunkDevice') {
        acceptableTypes.push('trunkDevice')
      } else if (selection.type === 'supply') {
        acceptableTypes.push('supply')
      } else if (selection.type === 'panel') {
        acceptableTypes.push('panel')
      }

      if (acceptableTypes.length === 0) return null

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let found = false

      const visitNode = (node: LayoutNode) => {
        if (
          node.domainId &&
          selectedIds.has(node.domainId) &&
          acceptableTypes.includes(node.type)
        ) {
          const { x, y, width, height } = node.bounds
          if (
            Number.isFinite(x) &&
            Number.isFinite(y) &&
            Number.isFinite(width) &&
            Number.isFinite(height) &&
            width > 0 &&
            height > 0
          ) {
            minX = Math.min(minX, x)
            minY = Math.min(minY, y)
            maxX = Math.max(maxX, x + width)
            maxY = Math.max(maxY, y + height)
            found = true
          }
        }
        if (node.children && node.children.length > 0) {
          for (const child of node.children) {
            visitNode(child)
          }
        }
      }

      for (const panelNode of layoutTree.panels) {
        visitNode(panelNode)
      }

      if (
        !found ||
        !Number.isFinite(minX) ||
        !Number.isFinite(minY) ||
        !Number.isFinite(maxX) ||
        !Number.isFinite(maxY)
      ) {
        return null
      }

      const padding = 10
      return {
        x: minX - padding,
        y: minY - padding,
        width: maxX - minX + padding * 2,
        height: maxY - minY + padding * 2,
      }
    },
    [wireSegments, layoutTree, viewportUI]
  )

  const handleFitToView = useCallback(() => {
    const viewportLayout = viewportUI.getState().viewportLayout
    const canvasesToFit =
      viewportLayout.panels.length === 1
        ? ['eendraad' as const]
        : Array.from(new Set(viewportLayout.panels.map((panel) => panel.canvas)))
    requestFitToView(canvasesToFit)
  }, [requestFitToView, viewportUI])

  const selectedDateToolTargets = useMemo(() => {
    if (!currentProject) return []
    const targets: Array<{
      id: string
      type: 'panel' | 'protection' | 'circuit' | 'endpoint' | 'trunkDevice'
      entity:
        | NonNullable<ReturnType<typeof getPanelById>>
        | NonNullable<ReturnType<typeof getProtectionById>>
        | NonNullable<ReturnType<typeof getCircuitById>>
        | NonNullable<ReturnType<typeof getEndpointById>>
        | TrunkDevice
    }> = []
    for (const id of selection.ids) {
      const panel = getPanelById(id)
      if (panel) {
        targets.push({ id, type: 'panel', entity: panel })
        continue
      }
      const protection = getProtectionById(id)
      if (protection) {
        targets.push({ id, type: 'protection', entity: protection })
        continue
      }
      const circuit = getCircuitById(id)
      if (circuit) {
        targets.push({ id, type: 'circuit', entity: circuit })
        continue
      }
      const trunkResult = getTrunkDeviceById(id)
      const trunkDevice = trunkResult?.device
      if (trunkDevice) {
        if (trunkResult?.isSupplyDevice && trunkResult.supplyFeedScope === 'shared') continue
        targets.push({ id, type: 'trunkDevice', entity: trunkDevice })
        continue
      }
      const endpoint = getEndpointById(id)
      if (endpoint) {
        if (endpoint.symbol === 'panel_distribution' && endpoint.panelId) {
          const linkedPanel = getPanelById(endpoint.panelId)
          if (linkedPanel) {
            targets.push({ id: linkedPanel.id, type: 'panel', entity: linkedPanel })
            continue
          }
        }
        targets.push({ id, type: 'endpoint', entity: endpoint })
      }
    }
    return targets
  }, [
    currentProject,
    getCircuitById,
    getEndpointById,
    getPanelById,
    getProtectionById,
    getTrunkDeviceById,
    selection.ids,
  ])
  const dateToolAnchorSelection = useMemo(() => {
    if (!layout || selectedDateToolTargets.length !== 1) return selection
    const target = selectedDateToolTargets[0]
    if (target?.type !== 'panel') return selection
    for (const panelLayout of layout.panels) {
      for (const element of panelLayout.elements) {
        if (element.type !== 'endpoint' || !element.endpointId) continue
        const endpoint = getEndpointById(element.endpointId)
        if (endpoint?.symbol === 'panel_distribution' && endpoint.panelId === target.id) {
          return { type: 'endpoint' as const, ids: [endpoint.id] }
        }
      }
    }
    return selection
  }, [getEndpointById, layout, selectedDateToolTargets, selection])

  const selectedDateToolYear = useMemo(() => {
    const selectedTarget = selectedDateToolTargets[0]
    if (!currentProject || !selectedTarget) return new Date().getFullYear()
    return (
      getExplicitInstallYear(selectedTarget.entity) ??
      getInstallDateTargetInheritedYear(currentProject, selectedTarget)
    )
  }, [currentProject, selectedDateToolTargets])

  const selectedDateToolDate = useMemo(() => {
    const selectedTarget = selectedDateToolTargets[0]
    return (
      getExplicitInstallationDate(selectedTarget?.entity) ??
      installationDateFromYear(selectedDateToolYear)
    )
  }, [selectedDateToolTargets, selectedDateToolYear])

  const dateToolHasExplicitDate = useMemo(
    () => selectedDateToolTargets.some((target) => getExplicitInstallYear(target.entity) != null),
    [selectedDateToolTargets]
  )

  const dateToolSelectionKey =
    eendraadDateMarkingMode && selectedDateToolTargets.length > 0
      ? selectedDateToolTargets.map((target) => `${target.type}:${target.id}`).join('|')
      : null

  const applyInstallYearTargets = useCallback(
    (targets: InstallDateTarget[], date: string | undefined) => {
      const year = date ? Number(date.slice(0, 4)) : undefined
      const getTargetEntity = (target: InstallDateTarget) => {
        const suppliedEntity = (
          target as InstallDateTarget & {
            entity?: TrunkDevice | Panel | ProtectionDevice | Circuit | Endpoint
          }
        ).entity
        if (suppliedEntity) return suppliedEntity
        if (target.type === 'panel') return getPanelById(target.id)
        if (target.type === 'protection') return getProtectionById(target.id)
        if (target.type === 'circuit') return getCircuitById(target.id)
        if (target.type === 'endpoint') return getEndpointById(target.id)
        return getTrunkDeviceById(target.id)?.device
      }
      withSingleUndoEntry(() => {
        const inheritance = currentProject
          ? buildInstallDateInheritanceIndex(currentProject)
          : undefined
        if (currentProject) {
          let nextColors = currentProject.project.installDateColors ?? {}
          let changedColors = false
          for (const target of targets) {
            const inheritedYear = getInstallDateTargetInheritedYear(
              currentProject,
              target,
              inheritance
            )
            const requestedYear = target.preserveYear ?? year
            if (
              target.clearOverride ||
              requestedYear == null ||
              (!target.forceOverride && requestedYear === inheritedYear)
            )
              continue
            const key = getInstallYearColorKey(requestedYear)
            if (nextColors[key]) continue
            nextColors = {
              ...nextColors,
              [key]: pickInstallYearColor(nextColors),
            }
            changedColors = true
          }
          if (changedColors) {
            updateProject({ installDateColors: nextColors })
          }
        }
        for (const target of targets) {
          const inheritedYear = currentProject
            ? getInstallDateTargetInheritedYear(currentProject, target, inheritance)
            : undefined
          const requestedYear = target.preserveYear ?? year
          const existingDate = getExplicitInstallationDate(getTargetEntity(target))
          const targetDate =
            target.clearOverride ||
            target.explicitlyUnmark ||
            requestedYear == null ||
            (!target.forceOverride && requestedYear === inheritedYear)
              ? undefined
              : target.preserveYear != null && existingDate?.startsWith(`${requestedYear}-`)
                ? existingDate
                : target.preserveYear != null
                  ? installationDateFromYear(requestedYear)
                  : date
          const targetYear =
            target.clearOverride ||
            target.explicitlyUnmark ||
            (!target.forceOverride && requestedYear === inheritedYear)
              ? undefined
              : requestedYear
          const installationDateSuppressed = target.explicitlyUnmark ? true : undefined
          logger.info('[install-date apply target]', {
            type: target.type,
            id: target.id,
            requestedYear,
            inheritedYear,
            clearOverride: target.clearOverride === true,
            forceOverride: target.forceOverride === true,
            preserveYear: target.preserveYear,
            targetYear,
            targetDate,
          })
          if (target.type === 'panel') {
            updatePanel(target.id, {
              installationDate: targetDate,
              installationDateSuppressed,
              rulesetDateOverride: undefined,
            })
          } else if (target.type === 'protection') {
            updateProtection(target.id, {
              installationDate: targetDate,
              installationDateSuppressed,
              rulesetDateOverride: undefined,
            })
          } else if (target.type === 'circuit') {
            updateCircuit(target.id, {
              installationDate: targetDate,
              installationDateSuppressed,
              rulesetDateOverride: undefined,
            })
          } else if (target.type === 'endpoint') {
            updateEndpoint(target.id, {
              installationDate: targetDate,
              installationDateSuppressed,
              rulesetDateOverride: undefined,
            })
          } else if (target.type === 'trunkDevice') {
            const result = getTrunkDeviceById(target.id)
            if (result?.isSupplyDevice) {
              if (result.supplyFeedScope === 'shared') continue
              updateSupplyTrunkDevice(target.id, {
                installationDate: targetDate,
                installationDateSuppressed,
                rulesetDateOverride: undefined,
              })
            } else if (result?.isGroundDevice) {
              updateGroundTrunkDevice(target.id, {
                installationDate: targetDate,
                installationDateSuppressed,
                rulesetDateOverride: undefined,
              })
            } else if (result?.circuit) {
              updateTrunkDevice(result.circuit.id, target.id, {
                installationDate: targetDate,
                installationDateSuppressed,
                rulesetDateOverride: undefined,
              })
            }
          }
        }
        const projectAfter = useProjectStore.getState().currentProject
        if (projectAfter) {
          logger.debug(
            '[install-date post-apply inherited years]',
            targets.map((target) => ({
              type: target.type,
              id: target.id,
              inheritedAfter: getInstallDateTargetInheritedYear(projectAfter, target),
            }))
          )
        }
        return true
      })
    },
    [
      currentProject,
      getCircuitById,
      getEndpointById,
      getPanelById,
      getProtectionById,
      getTrunkDeviceById,
      updateCircuit,
      updateEndpoint,
      updateGroundTrunkDevice,
      updatePanel,
      updateProtection,
      updateProject,
      updateSupplyTrunkDevice,
      updateTrunkDevice,
      withSingleUndoEntry,
    ]
  )

  const commitInstallYearToSelection = useCallback(
    (rawDate: string) => {
      const currentYear = new Date().getFullYear()
      const date = normalizeInstallationDate(rawDate)
      const parsed = date ? Number(date.slice(0, 4)) : undefined
      const year = parsed == null ? undefined : clamp(parsed, 1900, currentYear)
      if (!canUseInstallDates || year == null || selectedDateToolTargets.length === 0) return

      const selectedTarget =
        selectedDateToolTargets.length === 1 ? selectedDateToolTargets[0] : null
      const applyMode = (mode: InstallDatePropagationMode) => {
        logger.info('[install-date commit]', {
          source: 'canvas-date-tool',
          mode,
          year,
          selectedTarget: selectedTarget
            ? {
                id: selectedTarget.id,
                type: selectedTarget.type,
                hasEntity: !!selectedTarget.entity,
                entityKeys: selectedTarget.entity ? Object.keys(selectedTarget.entity) : [],
              }
            : null,
          selectionTargets: selectedDateToolTargets.map((target) => ({
            id: target.id,
            type: target.type,
            hasEntity: !!target.entity,
          })),
        })
        if (!currentProject || !selectedTarget) {
          applyInstallYearTargets(selectedDateToolTargets, date)
        } else if (selectedTarget.type === 'panel') {
          applyInstallYearTargets(
            buildPanelInstallDateTargets(currentProject, selectedTarget.id, mode),
            date
          )
        } else if (
          selectedTarget.type === 'circuit' &&
          selectedTarget.entity &&
          'endpoints' in selectedTarget.entity
        ) {
          const targets = buildCircuitInstallDateTargets(
            currentProject,
            selectedTarget.entity,
            mode
          )
          logger.info('[install-date commit targets]', {
            source: 'canvas-date-tool',
            selectedType: 'circuit',
            mode,
            year,
            targets,
          })
          applyInstallYearTargets(targets, date)
        } else if (selectedTarget.type === 'protection') {
          const targets = buildProtectionInstallDateTargets(currentProject, selectedTarget.id, mode)
          logger.info('[install-date commit targets]', {
            source: 'canvas-date-tool',
            selectedType: 'protection',
            mode,
            year,
            targets,
          })
          applyInstallYearTargets(targets, date)
        } else {
          applyInstallYearTargets(selectedDateToolTargets, date)
        }
        setClosedDateToolSelectionKey(dateToolSelectionKey)
      }

      if (selectedTarget?.type === 'panel') {
        openDialog({
          type: 'custom',
          title: t('installDates.propagatePanelTitle', 'Change all child devices too?'),
          content: (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t(
                'installDates.propagatePanelMessage',
                'Choose whether this install date should feed down from the panel.'
              )}
            </p>
          ),
          buttons: [
            { label: t('common.no', 'No'), onClick: () => applyMode('self'), variant: 'secondary' },
            {
              label: t('installDates.propagateProtections', 'Yes - only protections'),
              onClick: () => applyMode('protections'),
              variant: 'secondary',
            },
            {
              label: t('installDates.propagateAll', 'Yes - all'),
              onClick: () => applyMode('all'),
              variant: 'primary',
              autoFocus: true,
            },
          ],
        })
        return
      }

      if (selectedTarget?.type === 'circuit') {
        openDialog({
          type: 'custom',
          title: t('installDates.propagateCircuitTitle', 'Change child devices too?'),
          content: (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t(
                'installDates.propagateCircuitMessage',
                'Choose whether this install date should feed down to the circuit consumers.'
              )}
            </p>
          ),
          buttons: [
            { label: t('common.no', 'No'), onClick: () => applyMode('self'), variant: 'secondary' },
            {
              label: t('installDates.propagateConsumers', 'Yes - consumers too'),
              onClick: () => applyMode('all'),
              variant: 'primary',
              autoFocus: true,
            },
          ],
        })
        return
      }

      if (
        selectedTarget?.type === 'protection' &&
        selectedTarget.entity &&
        'type' in selectedTarget.entity &&
        protectionHasInstallDateChildren(selectedTarget.entity as ProtectionDevice)
      ) {
        openDialog({
          type: 'custom',
          title: t('installDates.propagateCircuitTitle', 'Change child devices too?'),
          content: (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t(
                'installDates.propagateCircuitMessage',
                'Choose whether this install date should feed down to the circuit consumers.'
              )}
            </p>
          ),
          buttons: [
            { label: t('common.no', 'No'), onClick: () => applyMode('self'), variant: 'secondary' },
            {
              label: t('installDates.propagateConsumers', 'Yes - consumers too'),
              onClick: () => applyMode('all'),
              variant: 'primary',
              autoFocus: true,
            },
          ],
        })
        return
      }

      applyMode('self')
      setClosedDateToolSelectionKey(dateToolSelectionKey)
    },
    [
      applyInstallYearTargets,
      canUseInstallDates,
      currentProject,
      dateToolSelectionKey,
      openDialog,
      selectedDateToolTargets,
      t,
    ]
  )

  const clearSelectedInstallDates = useCallback(() => {
    if (!canUseInstallDates) return
    const explicitTargets = selectedDateToolTargets
      .filter((target) => getExplicitInstallYear(target.entity) != null)
      .map((target) => ({
        id: target.id,
        type: target.type,
        clearOverride: true,
        explicitlyUnmark: true,
      }))
    if (explicitTargets.length === 0) return
    applyInstallYearTargets(explicitTargets, undefined)
    setClosedDateToolSelectionKey(dateToolSelectionKey)
  }, [applyInstallYearTargets, canUseInstallDates, dateToolSelectionKey, selectedDateToolTargets])

  const updateInstallDateColor = useCallback(
    (year: number, color: string) => {
      if (!currentProject || !canUseInstallDates) return
      updateProject({
        installDateColors: {
          ...(currentProject.project.installDateColors ?? {}),
          [String(year)]: color,
        },
      })
    },
    [canUseInstallDates, currentProject, updateProject]
  )

  useEffect(() => {
    if (!dateToolSelectionKey || closedDateToolSelectionKey === dateToolSelectionKey) return
    const initialDate = dateToolFrameSelection
      ? installationDateFromYear(dateToolFrameSelection.year)
      : selectedDateToolDate
    setDateToolYear(initialDate.slice(0, 4))
    setDateToolMonth(Number(initialDate.slice(5, 7)))
    setDateToolDay(Number(initialDate.slice(8, 10)))
    setDateToolCalendarOpen(false)
    requestAnimationFrame(() => {
      dateToolInputRef.current?.focus()
      dateToolInputRef.current?.select()
    })
  }, [
    closedDateToolSelectionKey,
    dateToolFrameSelection,
    dateToolSelectionKey,
    selectedDateToolDate,
  ])

  useEffect(() => {
    setClosedDateToolSelectionKey(null)
    // A frame click sets the selection and the frame context together; keep that
    // context while the selection still matches the clicked frame.
    const selectionKey = selection.ids.join('|')
    setDateToolFrameSelection((previous) =>
      previous?.selectionKey === selectionKey ? previous : null
    )
  }, [selection.ids, selection.type])

  const dateToolSelectionBounds = useMemo(() => {
    if (!eendraadDateMarkingMode || !canUseInstallDates) return null
    if (!dateToolSelectionKey || closedDateToolSelectionKey === dateToolSelectionKey) return null
    if (dateToolFrameSelection) return dateToolFrameSelection.bounds
    if (!dateToolAnchorSelection.type || dateToolAnchorSelection.ids.length === 0) return null
    return handleGetSelectionBounds(dateToolAnchorSelection)
  }, [
    canUseInstallDates,
    closedDateToolSelectionKey,
    dateToolAnchorSelection,
    dateToolFrameSelection,
    dateToolSelectionKey,
    eendraadDateMarkingMode,
    handleGetSelectionBounds,
  ])

  const dateToolHelperStyle = useMemo(() => {
    if (!dateToolSelectionBounds) return null
    const container = containerRef.current
    const helperWidth = Math.min(296, Math.max(0, (container?.clientWidth ?? 312) - 16))
    const helperHeight = dateToolCalendarOpen ? 326 : 82
    const rawLeft =
      eendraadView.pan.x +
      (dateToolSelectionBounds.x + dateToolSelectionBounds.width) * eendraadView.zoom +
      14
    const rawTop = eendraadView.pan.y + dateToolSelectionBounds.y * eendraadView.zoom
    const maxLeft = Math.max(8, (container?.clientWidth ?? 0) - helperWidth - 8)
    const maxTop = Math.max(8, (container?.clientHeight ?? 0) - helperHeight - 8)
    return {
      left: clamp(rawLeft, 8, maxLeft),
      top: clamp(rawTop, 8, maxTop),
      width: helperWidth,
    }
  }, [
    dateToolCalendarOpen,
    dateToolSelectionBounds,
    eendraadView.pan.x,
    eendraadView.pan.y,
    eendraadView.zoom,
  ])

  const currentInstallYear = new Date().getFullYear()
  const dateToolDraftYear = normalizeInstallYear(dateToolYear) ?? selectedDateToolYear
  const dateToolStoredColor = currentProject
    ? installYearColor(dateToolDraftYear, false, currentProject.project.installDateColors)
    : '#4b5563'
  const dateToolDaysInMonth = new Date(Date.UTC(dateToolDraftYear, dateToolMonth, 0)).getUTCDate()
  const dateToolMonthLabels = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) =>
        new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
          month: 'short',
          timeZone: 'UTC',
        }).format(new Date(Date.UTC(2024, index, 1)))
      ),
    [i18n.language, i18n.resolvedLanguage]
  )
  const dateToolSafeDay = Math.min(dateToolDay, dateToolDaysInMonth)
  const dateToolDraftDate = `${String(dateToolDraftYear).padStart(4, '0')}-${String(dateToolMonth).padStart(2, '0')}-${String(dateToolSafeDay).padStart(2, '0')}`
  const commitDateToolDraft = useCallback(() => {
    const parsed = normalizeInstallYear(dateToolYear)
    const clamped = parsed == null ? selectedDateToolYear : clamp(parsed, 1900, currentInstallYear)
    setDateToolYear(String(clamped))
    const safeDay = Math.min(
      dateToolDay,
      new Date(Date.UTC(clamped, dateToolMonth, 0)).getUTCDate()
    )
    setDateToolDay(safeDay)
    commitInstallYearToSelection(
      `${String(clamped).padStart(4, '0')}-${String(dateToolMonth).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`
    )
  }, [
    commitInstallYearToSelection,
    currentInstallYear,
    dateToolDay,
    dateToolMonth,
    dateToolYear,
    selectedDateToolYear,
  ])

  const fitTrigger = useCanvasUIStore((s) => s.fitToViewTrigger.eendraad)
  useEffect(() => {
    if (fitTrigger === 0) return
    let canceled = false
    let raf = 0
    const attempt = (remaining: number) => {
      raf = requestAnimationFrame(() => {
        if (canceled) return
        const ok = canvasRef.current?.fitToView()
        if (!ok && remaining > 0) {
          attempt(remaining - 1)
        }
      })
    }
    // First rAF lets react-konva reconcile the scene graph; up to 4 retries
    // cover cases where the Konva stage is still empty right after mount.
    raf = requestAnimationFrame(() => {
      if (canceled) return
      attempt(4)
    })
    return () => {
      canceled = true
      cancelAnimationFrame(raf)
    }
  }, [fitTrigger])

  // Find elements that intersect with selection rectangle
  const handleFindElementsInRectangle = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) =>
      createFindElementsInRectangleHandler(layoutTree)(rect),
    [layoutTree]
  )

  const handleDrop = useCallback(
    async (position: Point, symbolData: unknown, _meta?: CanvasDropMeta) => {
      // Clear preview immediately when drop happens
      setDragPreview(null)

      if (!currentProject || !symbolData) return

      const symbol = symbolData as SymbolMetadata
      const protectionIds = [...PROTECTION_SYMBOL_IDS]
      const isProtectionPlacement = protectionIds.includes(
        symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number]
      )

      // Use debug version to get tree walk information
      if (!layoutTree) {
        logger.warn('No layout tree available for drop target detection')
        return
      }

      const branchDrop = resolveBranchDrop(position, symbol, [])
      if (branchDrop.handled && !branchDrop.intent) return
      if (!branchDrop.handled && positionHitsMultiplierBadge(layoutTree, position)) return
      const directSameSymbolTarget = branchDrop.handled ? branchDrop.intent?.sameSymbolTarget : findSameSymbolAddMoreLayoutTargets(
        symbol.id,
        layoutTree,
        position
      )[0]

      const { target: rawTarget } = branchDrop.intent ? { target: branchDrop.intent.target } : findDropTargetWithDebug(
        layoutTree,
        position,
        symbol.id === 'earthing_separator'
          ? undefined
          : {
              preferMainBusOverGroundWire: true,
              preferMainBusOverSupplyWire: Boolean(symbol.busFeedKind) || isProtectionPlacement,
              preferSecondaryBusForNestedProtection: isProtectionPlacement,
              preferDomoticaEndpointOutput: symbol.id === 'panel_distribution',
              ...(symbol.id === 'dc_bus' ? { preferCircuitTrunkWire: true } : {}),
              ...(symbol.id === 'source_changeover'
                ? { normalizeDirectConverterChangeoverDrop: true }
                : {}),
            }
      )

      // A Domotica child's central hit zone means replace. If the incoming
      // symbol belongs to the same device family but has different settings,
      // refuse the drop instead of silently replacing the configured child.
      // A same-symbol add-more target takes precedence: it keeps the child.
      if (
        !directSameSymbolTarget &&
        rawTarget.domoticaChildDropIntent === 'replace' &&
        rawTarget.endpointId
      ) {
        let existingEndpoint: Endpoint | undefined
        const findEndpoint = (node: LayoutNode) => {
          if (node.type === 'endpoint' && node.domainId === rawTarget.endpointId) {
            existingEndpoint = node.domainRef as Endpoint | undefined
            return
          }
          for (const child of node.children) {
            findEndpoint(child)
            if (existingEndpoint) return
          }
        }
        layoutTree.panels.forEach(findEndpoint)
        if (existingEndpoint && isConflictingOnSymbolDrop(symbol.id, existingEndpoint)) {
          logger.info(`[drop-diag] Conflicting configured endpoint drop blocked for symbol=${symbol.id}`)
          return
        }
      }

      const sameSymbolEndpoint = directSameSymbolTarget?.target.endpoint
      const sameSymbolTrunkDevice = directSameSymbolTarget?.target.trunkDevice
      const sameSymbolTarget: SameSymbolAddMoreTarget | null = sameSymbolEndpoint
        ? { endpoint: sameSymbolEndpoint }
        : sameSymbolTrunkDevice
          ? { trunkDevice: sameSymbolTrunkDevice }
          : null
      const sameSymbolAddMoreResult = incrementSameSymbolAddMoreTargetWithUndo(
        symbol.id,
        sameSymbolTarget,
        {
          syncEndpointCount: (endpointId, count) =>
            syncEndpointMultiplierCount(createSyncEndpointMultiplierDeps(), endpointId, count),
          syncSupplyDeviceCount: (deviceId, count) =>
            syncSupplyDeviceMultiplierCount(
              createSyncSupplyInverterMultiplierDeps(),
              deviceId,
              count
            ),
          withSingleUndoEntry,
        }
      )
      if (sameSymbolAddMoreResult === 'incremented') {
        trackSymbolPlace({
          canvas: 'eendraad',
          symbol,
          placementMethod: 'library_drop',
          targetType: sameSymbolEndpoint ? 'endpoint' : 'trunkDevice',
        })
        return
      }
      if (sameSymbolAddMoreResult === 'blocked') {
        logger.warn(`[drop-diag] Add-more blocked for symbol=${symbol.id}`)
        return
      }
      if (!canCreateSupplyTopologyFromDrop(symbol, null)) {
        logger.warn(`[drop-diag] Supply topology gate (null target) blocked symbol=${symbol.id}`)
        return
      }

      // Augment drop target with wire-domain information from the actual wire segments under the cursor.
      let dropTarget = rawTarget
      if (
        symbol.busFeedKind &&
        rawTarget.type === null &&
        rawTarget.panelId &&
        rawTarget.diagramId?.endsWith('--supply')
      ) {
        dropTarget = { ...rawTarget, type: 'mainBus', mainBusInsertIndex: 0 }
      }
      if (
        rawTarget.type === 'circuit' &&
        rawTarget.circuitId &&
        rawTarget.panelId &&
        // For explicit trunk segment hit zones, domain is resolved from segment index
        // in drop behavior; avoid overriding with a potentially wrong vertical segment.
        typeof rawTarget.circuitTrunkSegmentIndex !== 'number'
      ) {
        const panelWires = wireSegments.filter(
          (ws) => ws.panelId === rawTarget.panelId && ws.circuitId === rawTarget.circuitId
        )
        // Find the vertical circuit wire segment nearest to the cursor.
        const verticalCandidates = panelWires.filter(
          (ws) => ws.type === 'vertical' && ws.startPoint.x === ws.endPoint.x
        )
        const hitVertical = verticalCandidates.find((ws) => {
          const x = ws.startPoint.x
          const minY = Math.min(ws.startPoint.y, ws.endPoint.y)
          const maxY = Math.max(ws.startPoint.y, ws.endPoint.y)
          const withinX = Math.abs(position.x - x) <= 15
          const withinY = position.y >= minY - 10 && position.y <= maxY + 10
          return withinX && withinY
        })
        if (hitVertical) {
          dropTarget = { ...rawTarget, wireDomain: hitVertical.domain as DropTarget['wireDomain'] }
        }
      }

      // Normalize generic panel-frame drops (type:null with panelId) for protection
      // devices so they behave exactly like drops on the main bus of that panel.
      if (
        dropTarget.type === null &&
        dropTarget.panelId &&
        symbol &&
        protectionIds.includes(symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number])
      ) {
        dropTarget = { ...dropTarget, type: 'mainBus' }
      }

      if (symbol.busFeedKind) {
        const panel = dropTarget.panelId ? getPanelById(dropTarget.panelId) : undefined
        if (!panel) return
        const isSupplyFrameDrop = dropTarget.diagramId?.endsWith('--supply') ?? false
        if (isSupplyFrameDrop) {
          const didEnableSplit = panel.busSections?.length
            ? true
            : !!(runProjectCommand('properties.edit', {
                edits: [],
                actions: [
                  {
                    kind: 'panelFeedOrganization',
                    panelId: panel.id,
                    organization: panelHasModularChangeover(currentProject, panel.id)
                      ? 'split-switchable'
                      : 'split-backup',
                  },
                ],
              }))?.changed
          if (didEnableSplit) {
            const busSectionId =
              symbol.busFeedKind === 'backup' ? `bus-backup-${panel.id}` : `bus-grid-${panel.id}`
            setSelection({
              type: 'busSection',
              ids: [busSectionId],
              busSectionMetadata: { panelId: panel.id, busSectionId },
            })
          }
          return
        }
        const order = getMainBusOrder(panel)
        const referencedId = dropTarget.protectionId ?? dropTarget.circuitId
        const referencedIndex = referencedId
          ? order.findIndex((item) => item.id === referencedId)
          : -1
        const insertIndex =
          dropTarget.type === 'mainBus' && typeof dropTarget.mainBusInsertIndex === 'number'
            ? dropTarget.mainBusInsertIndex
            : referencedIndex >= 0
              ? referencedIndex
              : undefined
        if (insertIndex == null) return
        const didPlaceFeedBoundary = !!(runProjectCommand('properties.edit', {
          edits: [],
          actions: [
            {
              kind: 'panelBusFeedBoundary',
              panelId: panel.id,
              feed: symbol.busFeedKind,
              mainBusInsertIndex: insertIndex,
            },
          ],
        }))?.changed
        if (didPlaceFeedBoundary) {
          const busSectionId =
            symbol.busFeedKind === 'backup' ? `bus-backup-${panel.id}` : `bus-grid-${panel.id}`
          setSelection({
            type: 'busSection',
            ids: [busSectionId],
            busSectionMetadata: { panelId: panel.id, busSectionId },
          })
          trackSymbolPlace({
            canvas: 'eendraad',
            symbol,
            placementMethod: 'library_drop',
            targetType: 'mainBus',
          })
        }
        return
      }

      logger.info(
        `[drop-diag] Executing drop: symbol=${symbol.id}, target=${JSON.stringify({ type: dropTarget.type, panelId: dropTarget.panelId, circuitId: dropTarget.circuitId, protectionId: dropTarget.protectionId })}`
      )
      // The command applies the shared target rules (protection normalization, junction-panel
      // boundary) and the drop engine as one undoable step.
      const placed = placeElectricalSymbol({
        ownerDocument: window.document,
        symbolId: symbol.id,
        target: dropTarget,
        dropCanvasPosition: position,
        label: 'drop symbol from library onto installation plan',
      })
      if (placed.status === 'rejected') {
        useDialogStore.getState().openDialog({
          type: 'info',
          title: t('wires.domainMismatchTitle', { defaultValue: 'Cannot connect here' }),
          message: placed.message,
          confirmLabel: t('common.ok', { defaultValue: 'OK' }),
          variant: 'warning',
        })
        return
      }
      if (placed.status === 'placed' && placed.changed) {
        trackSymbolPlace({
          canvas: 'eendraad',
          symbol,
          placementMethod: 'library_drop',
          targetType: normalizeElectricalDropTarget(symbol.id, dropTarget).type ?? 'empty',
        })
      }
    },
    [
      currentProject,
      t,
      layoutTree,
      setDragPreview,
      setSelection,
      wireSegments,
      getPanelById,
      withSingleUndoEntry,
      resolveBranchDrop,
    ]
  )

  const pointerClientToCanvasPoint = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const stage = canvasRef.current?.getStage()
      const container = stage?.container()
      if (!stage || !container) return null
      const rect = container.getBoundingClientRect()
      const stageX = clientX - rect.left
      const stageY = clientY - rect.top
      const view = eendraadViewRef.current
      return {
        x: (stageX - view.pan.x) / view.zoom,
        y: (stageY - view.pan.y) / view.zoom,
      }
    },
    []
  )

  const endAltDuplicatePointerDrag = useCallback(() => {
    altDuplicatePointerCleanupRef.current?.()
    altDuplicatePointerCleanupRef.current = null
    draggingProtectionIdRef.current = null
    movingPanelAttachmentIdRef.current = null
    suppressKonvaDragEndRef.current = false
    setAltDuplicatePointerDragActive(false)
    internalDragElementIdRef.current = null
    setInternalDragPlacement(null)
    setDragPreview(null)
    trunkDnDLoggedStartRef.current = false
    elementDragModeRef.current = 'move'
  }, [setDragPreview])

  useEffect(
    () => () => {
      endAltDuplicatePointerDrag()
    },
    [endAltDuplicatePointerDrag]
  )

  const handleElementDragMoveRef = useRef<
    (elementId: string, elementType: string, newPos: Point) => void
  >(() => {})
  const handleElementDragEndRef = useRef<
    (elementId: string, elementType: string, position: Point) => boolean | void
  >(() => false)
  const handleElementDragStartRef = useRef<
    (elementId: string, elementType: string, altKey: boolean, nativeEvt?: MouseEvent) => boolean
  >(() => false)
  const handleGroundDragEndRef = useRef<() => void | Promise<void>>(() => {})
  const handleNoteDragEndRef = useRef<(noteId: string, newPos: Point) => void>(() => {})

  const stableElementDragMove = useCallback(
    (elementId: string, elementType: string, newPos: Point) =>
      handleElementDragMoveRef.current(elementId, elementType, newPos),
    []
  )

  const stableElementDragEnd = useCallback(
    (elementId: string, elementType: string, position: Point) =>
      handleElementDragEndRef.current(elementId, elementType, position),
    []
  )

  const stableElementDragStart = useCallback(
    (elementId: string, elementType: string, altKey: boolean, nativeEvt: MouseEvent) =>
      handleElementDragStartRef.current(elementId, elementType, altKey, nativeEvt),
    []
  )

  const stableGroundDragEnd = useCallback(() => {
    handleGroundDragEndRef.current()
  }, [])

  const stableNoteDragEnd = useCallback((noteId: string, newPos: Point) => {
    handleNoteDragEndRef.current(noteId, newPos)
  }, [])

  // Internal 1‑draad drag pipeline for existing symbols
  // Live drag: feed internal drags into the existing preview system so we get
  // the same ghost wires/rectangles as when adding a new symbol from the library.
  const handleElementDragMove = useCallback(
    (elementId: string, elementType: string, newPos: Point) => {
      if (elementType === 'panelAttachment') {
        movingPanelAttachmentIdRef.current = elementId
        const symbolMeta = getSymbolById('panel_distribution')
        if (!symbolMeta) return
        handleDragOver(newPos, symbolMeta)
        return
      }

      if (elementType === 'endpoint') {
        const endpoint = getEndpointById(elementId)
        if (!endpoint || !endpoint.symbol) return
        const symbolMeta = getSymbolById(endpoint.symbol)
        if (!symbolMeta) return
        handleDragOver(newPos, symbolMeta)
        const store = useProjectStore.getState()
        const selectionIds = endpointDragStartSelectionIdsRef.current
        const sourceCircuitId = store.findCircuitForEndpoint(elementId)?.circuit.id
        const selectedEndpointIds = (selectionIds ?? viewportUI.getState().selection.ids).filter(
          (id) => !!store.getEndpointById(id)
        )
        const isGroupMove =
          selectedEndpointIds.length > 1 && selectedEndpointIds.includes(elementId)
        const movingEndpointIds = isGroupMove ? selectedEndpointIds : [elementId]
        if (resolveBranchDrop(newPos, symbolMeta).handled) {
          if (sourceCircuitId) setDragPreview((preview) => preview ? {
            ...preview, movingEndpointSelection: {
              draggedEndpointId: elementId, sourceCircuitId, endpointIds: movingEndpointIds,
            },
          } : null)
          return
        }
        // Domotica groups keep their dedicated slot handling.
        const canUseTrunkSlot =
          !!sourceCircuitId && endpoint.symbol !== 'domotica' && !endpoint.domoticaChildProps
        const trunkBranchSlot =
          canUseTrunkSlot && layoutTree
            ? (findCircuitTrunkBranchSlot(layoutTree, newPos, {
                includeBranchRows: isGroupMove,
              }) ?? undefined)
            : undefined
        if (sourceCircuitId) {
          const movingEndpointSelection = {
            draggedEndpointId: elementId,
            sourceCircuitId,
            endpointIds: movingEndpointIds,
          }
          trunkBranchSlotMarkerRef.current?.y(newPos.y)
          trunkBranchSlotMarkerRef.current?.getLayer()?.batchDraw()
          setDragPreview((preview) => {
            if (!trunkBranchSlot) {
              return preview ? { ...preview, movingEndpointSelection,
                ...(preview.sameSymbolAddMore && layoutTree ? {
                  dropTarget: findDropTarget(layoutTree, newPos, { preferMainBusOverGroundWire: true }),
                } : {}),
              } : preview
            }
            return {
              position: newPos,
              symbolData: preview?.symbolData ?? symbolMeta,
              dropTarget: circuitTrunkBranchSlotDropTarget(trunkBranchSlot),
              movingEndpointSelection,
              trunkBranchSlot,
            }
          })
        }
        return
      }

      if (elementType === 'protection') {
        const protection = getProtectionById(elementId)
        if (!protection) return
        draggingProtectionIdRef.current = elementId

        const typeMap: Record<string, string> = {
          MCB: 'mcb',
          RCD: 'rcd',
          RCBO: 'rcbo',
          FUSE: 'fuse',
          MAIN_SWITCH: 'main_switch',
          SPD: 'spd',
        }
        const symbolId = typeMap[protection.type]
        if (!symbolId) return
        const symbolMeta = getSymbolById(symbolId)
        if (!symbolMeta) return

        const sourcePanel = useProjectStore.getState().getPanelForProtection(elementId)
        const circuitId = sourcePanel
          ? pickRepresentativeCircuitIdForMainBusMove(sourcePanel, protection)
          : protection.circuits?.[0]?.id
        if (circuitId) {
          const resolvedTarget = layoutTree
            ? resolveProtectionDropTargetForPosition(
                layoutTree,
                newPos,
                findProtectionDragTarget,
                (panelId) => getPanelById(panelId),
                elementId,
                (id) => getProtectionById(id),
                { nestOnRcd: true }
              )
            : null
          if (layoutTree && !resolvedTarget) {
            setDragPreview(null)
            return
          }
          if (!resolvedTarget) return

          const nextPreview = {
            position: newPos,
            symbolData: symbolMeta,
            dropTarget: resolvedTarget,
            movingProtection: { protectionId: elementId, circuitId },
          }
          setDragPreview((preview) =>
            getEendraadPreviewIntentKey(preview) === getEendraadPreviewIntentKey(nextPreview)
              ? { ...preview!, position: newPos, dropTarget: resolvedTarget }
              : nextPreview
          )
        }
        return
      }

      if (elementType === 'trunkDevice') {
        const info = getTrunkDeviceById(elementId)
        if (!info || info.isGroundDevice) return
        const meta = getSymbolById(info.device.symbol)
        if (!meta) return
        if (info.isSupplyDevice) {
          if (!layoutTree) return
          const { target } = findDropTargetWithDebug(layoutTree, newPos)
          if (!isSupplyTrunkDeviceDropTarget(info.device, target)) {
            setDragPreview(null)
            return
          }
          const targetPanelLayout = layout?.panels.find(
            (candidate) =>
              getPanelDiagramId(candidate) === target.diagramId ||
              (!target.diagramId && candidate.panel.id === target.panelId)
          )
          const targetMounting =
            currentProject && targetPanelLayout
              ? resolveSupplyDropMounting(
                  currentProject,
                  targetPanelLayout,
                  target,
                  newPos,
                  wireSegments
                )
              : undefined
          setDragPreview({
            position: newPos,
            symbolData: meta,
            dropTarget: target,
            relocatingSupplyTrunkDevice: { id: elementId, targetMounting },
          })
          return
        }
        if (!info.circuit) return
        if (trunkDnDVerboseLogEnabled() && !trunkDnDLoggedStartRef.current) {
          trunkDnDLoggedStartRef.current = true
          const st = useProjectStore.getState()
          const srcCircuit = st.getCircuitById(info.circuit.id)
          logTrunkDnD('canvas:drag-start', {
            deviceId: elementId,
            deviceSymbol: info.device.symbol,
            deviceType: info.device.type,
            sourceCircuitId: info.circuit.id,
            sourceCircuitCode: info.circuit.code,
            sourceTrunkOrderBottomToTop: serializeTrunkDevices(srcCircuit?.trunkDevices),
            pointerCanvas: newPos,
          })
        }
        const dropTarget = resolveTrunkRelocateDropTarget(newPos)
        if (!dropTarget) { setDragPreview(null); return }
        setDragPreview({
          position: newPos,
          symbolData: meta,
          dropTarget,
          relocatingTrunkDevice: { id: elementId, sourceCircuitId: info.circuit.id },
        })
      }
    },
    [
      getEndpointById,
      getPanelById,
      getProtectionById,
      getTrunkDeviceById,
      handleDragOver,
      resolveBranchDrop,
      currentProject,
      layout,
      layoutTree,
      resolveTrunkRelocateDropTarget,
      setDragPreview,
      wireSegments,
      viewportUI,
    ]
  )

  // Drag end: treat as "add new at drop target, then delete original". Return
  // a boolean so the symbol can snap back when the drop was invalid.
  const handleElementDragEnd = useCallback(
    (elementId: string, elementType: string, position: Point) => {
      movingPanelAttachmentIdRef.current = null
      internalDragElementIdRef.current = null
      setInternalDragPlacement(null)
      const isDuplicateDrag = elementDragModeRef.current === 'duplicate'
      // Clear any preview once the drop is committed (pointer-drag path clears in endAltDuplicatePointerDrag)
      if (!altDuplicatePointerCleanupRef.current) {
        setDragPreview(null)
        trunkDnDLoggedStartRef.current = false
        elementDragModeRef.current = 'move'
      }

      const dragSelectionIds = (() => {
        const currentIds = viewportUI.getState().selection.ids
        const capturedIds = endpointDragStartSelectionIdsRef.current
        if (capturedIds?.includes(elementId)) return capturedIds
        return currentIds.includes(elementId) ? currentIds : [elementId]
      })()

      if (!isDuplicateDrag && elementType === 'endpoint') {
        const endpoint = useProjectStore.getState().getEndpointById(elementId)
        const symbol = endpoint?.symbol ? getSymbolById(endpoint.symbol) : null
        if (symbol) {
          const branchDrop = resolveBranchDrop(position, symbol, dragSelectionIds)
          if (branchDrop.handled) return !!branchDrop.intent && moveEndpointSelection({
            draggedEndpointId: elementId, selectedEndpointIds: dragSelectionIds,
            target: branchDrop.intent.target,
          })
        }
      }

      // A rectangle selection can contain mixed domain types while Selection.type is
      // only its compatibility/majority type. Resolve one accepted family from the
      // physical drop target before entering any single-symbol behavior.
      if (!isDuplicateDrag && dragSelectionIds.length > 1 && currentProject && layoutTree) {
        const store = useProjectStore.getState()
        const classified = classifyEendraadMoveSelection(dragSelectionIds, {
          isProtection: (id) => !!store.getProtectionById(id),
          isEndpoint: (id) => !!store.getEndpointById(id),
          isTrunkDevice: (id) => !!getTrunkDeviceById(id),
        })
        const { target: rawMultiTarget } = findDropTargetWithDebug(layoutTree, position, {
          preferMainBusOverGroundWire: true,
          preferMainBusOverSupplyWire: true,
          preferSecondaryBusForNestedProtection: classified.protectionIds.length > 0,
          ignoreCircuitTrunkDeviceSymbolHits: elementType === 'trunkDevice',
        })
        // Whole-branch moves resolve the gap between branches along the circuit trunk.
        const trunkBranchSlot =
          classified.endpointIds.length === dragSelectionIds.length
            ? findCircuitTrunkBranchSlot(layoutTree, position)
            : null
        const multiKind = trunkBranchSlot
          ? 'endpoint'
          : resolveEendraadMultiMoveKind(classified, rawMultiTarget)

        if (multiKind === 'endpoint') {
          const hasDomoticaChild = classified.endpointIds.some(
            (id) => store.getEndpointById(id)?.domoticaChildProps
          )
          const endpointTarget = hasDomoticaChild
            ? findDomoticaOutputDropTarget(layoutTree, position) ?? rawMultiTarget
            : trunkBranchSlot
              ? circuitTrunkBranchSlotDropTarget(trunkBranchSlot)
              : augmentCircuitVerticalWireDomain(rawMultiTarget, position)
          return moveEndpointSelection({
            draggedEndpointId: classified.endpointIds.includes(elementId)
              ? elementId
              : classified.endpointIds[0]!,
            selectedEndpointIds: classified.endpointIds,
            target: endpointTarget,
          })
        }

        if (multiKind === 'protection') {
          const target = resolveProtectionDropTargetForPosition(
            layoutTree, position, findProtectionDragTarget,
            (panelId) => store.getPanelById(panelId), undefined, undefined, { nestOnRcd: true }
          )
          if (!target) return false
          return runEendraadBusMove({
            kind: 'protectionSelectionDrop', protectionIds: classified.protectionIds, target,
          })
        }

        if (multiKind === 'trunkDevice') {
          const target = resolveTrunkRelocateDropTarget(position)
          if (!target?.circuitId) return false
          const movable = classified.trunkDeviceIds.flatMap((id) => {
            const info = getTrunkDeviceById(id)
            return info?.circuit && !info.isGroundDevice && !info.isSupplyDevice
              ? [{ id, sourceCircuitId: info.circuit.id, symbol: info.device.symbol }]
              : []
          })
          if (movable.length !== classified.trunkDeviceIds.length) return false
          if (!moveCircuitTrunkDevices(movable, target)) return false
          setSelection({ type: 'trunkDevice', ids: movable.map((item) => item.id) })
          return true
        }

        // The target accepts none of the selected families. Do not fall through and
        // accidentally move only the symbol under the pointer.
        return false
      }

      if (elementType === 'panelAttachment') {
        if (!currentProject || !layoutTree) return false
        // Resolve from the release position first. The last drag-preview state
        // may lag one pointer event or may have selected an overlapping supply
        // hit zone, which made a visibly valid main-bus drop snap back.
        const releaseTarget = findDropTargetWithDebug(layoutTree, position, {
          preferMainBusOverGroundWire: true,
          preferMainBusOverSupplyWire: true,
        }).target
        const target =
          releaseTarget.type === 'mainBus' ||
          releaseTarget.type === 'circuit' ||
          releaseTarget.type === 'rcd' ||
          releaseTarget.type === 'endpoint'
            ? releaseTarget
            : (dragPreview?.dropTarget ?? releaseTarget)
        const canMoveToEndpoint =
          target.type === 'endpoint' &&
          !!target.endpointId &&
          !!target.circuitId
        const canMoveToCircuitTop =
          target.type === 'circuit' &&
          !!target.circuitId &&
          target.insertAfterCircuitContent === true &&
          typeof target.secondaryBusInsertIndex !== 'number'
        const canMoveToSecondary =
          target.type === 'circuit' &&
          !!target.circuitId &&
          typeof target.secondaryBusInsertIndex === 'number'
        const canMoveToMain =
          target.type === 'mainBus' &&
          !!target.panelId &&
          typeof target.mainBusInsertIndex === 'number'
        const canMoveToRcd =
          target.type === 'rcd' &&
          !!target.protectionId &&
          typeof target.secondaryBusInsertIndex === 'number'
        if (
          !canMoveToSecondary &&
          !canMoveToMain &&
          !canMoveToRcd &&
          !canMoveToEndpoint &&
          !canMoveToCircuitTop
        ) {
          return false
        }
        if (
          !isPanelAttachmentDropTargetTerminal(
            getProjectElectricalPanels(currentProject),
            elementId,
            target
          )
        ) {
          return false
        }

        if (canMoveToEndpoint || canMoveToCircuitTop) {
          const outcome = runProjectCommand('panel.moveSupply', {
            panelId: elementId,
            target: { type: 'circuit', circuitId: target.circuitId! },
          })
          if (outcome?.changed) setSelection({ type: 'panel', ids: [elementId] })
          return !!outcome?.changed
        }

        return withSingleUndoEntry(
          () => {
            let moved = false
            useProjectStore.setState((state: ProjectState) => {
              if (!state.currentProject) return
              const panels = getEditableProjectElectricalPanels(state.currentProject)
              const result = canMoveToSecondary
                ? movePanelAttachmentOnSecondaryBus(
                    panels,
                    elementId,
                    target.circuitId!,
                    target.secondaryBusInsertIndex!
                  )
                : canMoveToRcd
                  ? movePanelAttachmentOnRcdBus(
                      panels,
                      elementId,
                      target.protectionId!,
                      target.secondaryBusInsertIndex!
                    )
                  : movePanelAttachmentToMainBus(
                      panels,
                      elementId,
                      target.panelId!,
                      target.mainBusInsertIndex!
                    )
              if (!result) return
              state.isDirty = true
              moved = true
            })
            if (moved) setSelection({ type: 'panel', ids: [elementId] })
            return moved
          },
          { sessionLabel: 'move distribution board on secondary bus' }
        )
      }

      if (elementType === 'endpoint') {
        if (isDuplicateDrag) {
          if (!currentProject || !layoutTree) return false
          return withSingleUndoEntry(
            () =>
              runEendraadEndpointAltDragDuplicate(elementId, position, {
                dropHooks: createUiDropBehaviorHooks(window.document),
                project: currentProject,
                layoutTree,
                wireSegments,
                findDropTarget: (tree, pos) =>
                  findDropTargetWithDebug(tree, pos, { preferMainBusOverGroundWire: true }),
                t,
                addCircuit,
                addEndpoint,
                addPlacement,
                updateCircuit,
                setSelection,
                getFloorById: (floorId) => {
                  const floor = getFloorById(floorId)
                  return floor
                    ? {
                        id: floor.id,
                        layers: floor.layers,
                        hiddenSitplanPlacementIds: floor.hiddenSitplanPlacementIds,
                      }
                    : null
                },
                getProtectionById: (protectionId) => getProtectionById(protectionId) || null,
                incrementEndpointMultiplier: (endpointId) => {
                  const result = runProjectCommand('electrical.duplicateElements', {
                    items: [{ kind: 'endpoint', id: endpointId }],
                    purpose: 'altDrag',
                    target: { type: 'sourceSelection' },
                    sitplan: createUiDropBehaviorHooks(window.document).getSitplanTarget(),
                  }, { label: 'Add endpoint instance' })
                  if (!result?.changed) return false
                  setSelection({ type: 'endpoint', ids: [endpointId] })
                  return true
                },
              }),
            { sessionLabel: 'duplicate endpoint via alt-drag' }
          )
        }

        if (!currentProject || !layoutTree) return false
        const store = useProjectStore.getState()
        const endpoint = store.getEndpointById(elementId)
        if (!endpoint) return false
        const trunkBranchSlot =
          endpoint.symbol !== 'domotica' && !endpoint.domoticaChildProps
            ? findCircuitTrunkBranchSlot(layoutTree, position, { includeBranchRows: false })
            : null
        let target = trunkBranchSlot
          ? circuitTrunkBranchSlotDropTarget(trunkBranchSlot)
          : augmentCircuitVerticalWireDomain(
              findDropTargetWithDebug(layoutTree, position, {
                preferMainBusOverGroundWire: true,
              }).target,
              position
            )
        if (endpoint.domoticaChildProps && !target.domoticaOutput) {
          const targetEndpoint = target.endpointId ? store.getEndpointById(target.endpointId) : null
          if (!targetEndpoint?.domoticaChildProps) {
            target = findDomoticaOutputDropTarget(layoutTree, position) ?? target
          }
        }
        return moveEndpointSelection({
          draggedEndpointId: elementId,
          selectedEndpointIds: dragSelectionIds.filter((id) => !!store.getEndpointById(id)),
          target,
        })
      }

      if (elementType === 'protection') {
        try {
          if (isDuplicateDrag) {
            if (!layoutTree) return false
            const dropTarget =
              dragPreview?.dropTarget ??
              resolveProtectionDropTargetForPosition(
                layoutTree,
                position,
                findProtectionDragTarget,
                (panelId) => getPanelById(panelId),
                elementId,
                (id) => getProtectionById(id),
                { nestOnRcd: true }
              )
            if (!dropTarget) return false
            const newProtId = duplicateProtection({
              ownerDocument: window.document,
              protectionId: elementId,
              dropTarget,
              label: 'duplicate protection via alt-drag',
            })
            if (!newProtId) return false
            setSelection({ type: 'protection', ids: [newProtId] })
            return true
          }

          if (!currentProject || !layoutTree) return false
          const target = resolveProtectionDropTargetForPosition(
            layoutTree, position, findProtectionDragTarget,
            (panelId) => getPanelById(panelId), undefined, undefined, { nestOnRcd: true }
          )
          if (!target) return false
          return runEendraadBusMove({ kind: 'protectionDrop', protectionId: elementId, target })
        } finally {
          if (!isDuplicateDrag) {
            draggingProtectionIdRef.current = null
          }
        }
      }

      if (elementType === 'trunkDevice') {
        const info = getTrunkDeviceById(elementId)
        if (!info || info.isGroundDevice || !layoutTree || !currentProject) return false

        if (info.isSupplyDevice) {
          const { target, debug: hitDebug } = findDropTargetWithDebug(layoutTree, position)
          const targetFeedScope = target.supplyFeedScope ?? 'shared'
          const targetPanelId = target.panelId
          let moved = false
          const targetPanelLayout = layout?.panels.find(
            (candidate) =>
              getPanelDiagramId(candidate) === target.diagramId ||
              (!target.diagramId && candidate.panel.id === target.panelId)
          )
          const targetMounting = targetPanelLayout
            ? resolveSupplyDropMounting(
                currentProject,
                targetPanelLayout,
                target,
                position,
                wireSegments
              )
              : undefined

          if (isDuplicateDrag) {
            if (target.type === null) return false
            const outcome = runProjectCommand('electrical.duplicateElements', {
              items: [{ kind: 'trunkDevice', id: elementId }],
              purpose: 'altDrag',
              target: { type: 'drop', target, ...(targetMounting ? { targetMounting } : {}) },
            }, { label: 'Duplicate supply device' })
            const created = outcome?.results[0]?.select?.find((reference) => reference.kind === 'trunkDevice')
            if (!outcome?.changed || !created) return false
            setSelection({ type: 'trunkDevice', ids: [created.id] })
            return true
          }

          moved = moveSupplyTrunkDevice({
            deviceId: elementId,
            target,
            targetMounting,
            label: 'move supply device',
          })

          if (!moved) return false
          if (trunkDnDCommitLogEnabled()) {
            logTrunkDnDCommit('relocateSupplyTrunkDevice', {
              deviceId: elementId,
              targetPanelId,
              targetFeedScope,
              targetType: target.type,
              targetSupplyDcBusId: target.supplyDcBusId,
              targetSupplyDcBusBranchId: target.supplyDcBusBranchId,
              targetSupplyConverterDcBranch: target.supplyConverterDcBranch,
              targetSupplyConverterDcConnectionIndex:
                target.supplyConverterDcConnectionIndex,
              supplyDeviceInsertIndex: target.supplyDeviceInsertIndex,
              hitPathMatchedTail: summarizeHitDebugPath(hitDebug.path),
            })
          }
          if (moved) {
            setSelection({ type: 'trunkDevice', ids: [elementId] })
            return true
          }
          return false
        }

        if (!info.circuit) return false
        const meta = getSymbolById(info.device.symbol)
        if (!meta) return false

        const sourceCircuitId = info.circuit.id
        const dropTarget = resolveTrunkRelocateDropTarget(position)

        if (trunkDnDVerboseLogEnabled()) {
          const storeSnap = useProjectStore.getState()
          const { debug: hitDebug } = findDropTargetWithDebug(layoutTree, position, {
            ignoreCircuitTrunkDeviceSymbolHits: true,
          })
          const srcC = storeSnap.getCircuitById(sourceCircuitId)
          const tgtC =
            dropTarget?.circuitId != null
              ? storeSnap.getCircuitById(dropTarget.circuitId)
              : undefined
          logTrunkDnD('canvas:drop-end:before-commit', {
            deviceId: elementId,
            deviceSymbol: info.device.symbol,
            pointerCanvas: position,
            sourceCircuitId,
            sourceTrunkOrderBottomToTop: serializeTrunkDevices(srcC?.trunkDevices),
            targetCircuitId: dropTarget?.circuitId ?? null,
            targetTrunkOrderBottomToTop: tgtC ? serializeTrunkDevices(tgtC.trunkDevices) : null,
            resolvedDropTarget: summarizeDropTarget(dropTarget),
            hitPathMatchedTail: summarizeHitDebugPath(hitDebug.path),
          })
        }

        if (!dropTarget || dropTarget.type === null) {
          logTrunkDnDCommit('drop-aborted', {
            reason: 'no-valid-drop-target',
            deviceId: elementId,
            pointerCanvas: position,
          })
          return false
        }

        if (isDuplicateDrag) {
          const outcome = runProjectCommand('electrical.duplicateElements', {
            items: [{ kind: 'trunkDevice', id: elementId }],
            purpose: 'altDrag',
            target: { type: 'drop', target: dropTarget },
          }, { label: 'Duplicate circuit device' })
          const created = outcome?.results[0]?.select?.find((reference) => reference.kind === 'trunkDevice')
          if (!outcome?.changed || !created) return false
          setSelection({ type: 'trunkDevice', ids: [created.id] })
          return true
        }

        const moved = moveCircuitTrunkDevice({
          deviceId: elementId,
          sourceCircuitId,
          target: dropTarget,
          label: 'move circuit device',
        })

        if (trunkDnDVerboseLogEnabled()) {
          const stAfter = useProjectStore.getState()
          const srcAfter = stAfter.getCircuitById(sourceCircuitId)
          const tgtAfter =
            dropTarget.circuitId != null ? stAfter.getCircuitById(dropTarget.circuitId) : undefined
          logTrunkDnD('canvas:drop-end:after-commit', {
            deviceId: elementId,
            relocateOk: moved,
            sourceCircuitId,
            targetCircuitId: dropTarget.circuitId,
            sourceTrunkOrderBottomToTop: serializeTrunkDevices(srcAfter?.trunkDevices),
            targetTrunkOrderBottomToTop: tgtAfter
              ? serializeTrunkDevices(tgtAfter.trunkDevices)
              : null,
          })
        }

        if (!moved) return false
        setSelection({ type: dropTarget.type === 'endpoint' ? 'endpoint' : 'trunkDevice', ids: [elementId] })
        return true
      }

      return false
    },
    [
      addCircuit,
      addEndpoint,
      addPlacement,
      addSupplyTrunkDevice,
      augmentCircuitVerticalWireDomain,
      resolveBranchDrop,
      currentProject,
      dragPreview,
      getFloorById,
      getPanelById,
      getProtectionById,
      getTrunkDeviceById,
      layout?.panels,
      layoutTree,
      moveCircuitOnMainBus,
      moveCircuitToSecondaryBus,
      resolveTrunkRelocateDropTarget,
      setDragPreview,
      setSelection,
      t,
      updateCircuit,
      withSingleUndoEntry,
      wireSegments,
      viewportUI,
    ]
  )

  handleElementDragMoveRef.current = handleElementDragMove
  handleElementDragEndRef.current = handleElementDragEnd

  const readPointerClient = useCallback(
    (ev: MouseEvent | TouchEvent): { clientX: number; clientY: number } | null => {
      if ('touches' in ev) {
        const t = ev.touches[0] ?? ev.changedTouches[0]
        return t ? { clientX: t.clientX, clientY: t.clientY } : null
      }
      return { clientX: ev.clientX, clientY: ev.clientY }
    },
    []
  )

  const beginAltDuplicatePointerDrag = useCallback(
    (elementId: string, elementType: string, nativeEvt: { clientX: number; clientY: number }) => {
      endAltDuplicatePointerDrag()
      elementDragModeRef.current = 'duplicate'
      suppressKonvaDragEndRef.current = true
      setAltDuplicatePointerDragActive(true)

      const onMove = (ev: MouseEvent | TouchEvent) => {
        if ('touches' in ev) ev.preventDefault()
        const client = readPointerClient(ev)
        if (!client) return
        const pos = pointerClientToCanvasPoint(client.clientX, client.clientY)
        if (pos) handleElementDragMoveRef.current(elementId, elementType, pos)
      }
      const onUp = (ev: MouseEvent | TouchEvent) => {
        const client = readPointerClient(ev)
        const pos = client ? pointerClientToCanvasPoint(client.clientX, client.clientY) : null
        if (pos) handleElementDragEndRef.current(elementId, elementType, pos)
        else {
          setDragPreview(null)
          elementDragModeRef.current = 'move'
        }
        endAltDuplicatePointerDrag()
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp, true)
      window.addEventListener('touchmove', onMove, { capture: true, passive: false })
      window.addEventListener('touchend', onUp, true)
      window.addEventListener('touchcancel', onUp, true)

      altDuplicatePointerCleanupRef.current = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp, true)
        window.removeEventListener('touchmove', onMove, true)
        window.removeEventListener('touchend', onUp, true)
        window.removeEventListener('touchcancel', onUp, true)
      }

      const initial = pointerClientToCanvasPoint(nativeEvt.clientX, nativeEvt.clientY)
      if (initial) handleElementDragMoveRef.current(elementId, elementType, initial)
    },
    [endAltDuplicatePointerDrag, pointerClientToCanvasPoint, readPointerClient, setDragPreview, window]
  )

  const handleElementDragStart = useCallback(
    (elementId: string, elementType: string, altKey: boolean, nativeEvt?: MouseEvent): boolean => {
      internalDragElementIdRef.current = elementId
      setInternalDragPlacement(null)
      if (elementType === 'panelAttachment') {
        movingPanelAttachmentIdRef.current = elementId
        const symbol = getSymbolById('panel_distribution')
        if (symbol) setInternalDragPlacement({ elementId, symbol })
      } else if (elementType === 'trunkDevice') {
        const info = getTrunkDeviceById(elementId)
        const symbol = info ? getSymbolById(info.device.symbol) : undefined
        if (info && symbol) {
          if (info.isSupplyDevice) {
            const sourcePanelLayout = layout?.panels.find((candidate) =>
              candidate.supplyDevices?.some(({ device }) => device.id === elementId)
            )
            const sourceDeviceLayout = sourcePanelLayout?.supplyDevices?.find(
              ({ device }) => device.id === elementId
            )
            setInternalDragPlacement({
              elementId,
              symbol,
              supply: {
                panelId: sourcePanelLayout?.panel.id,
                feedScope: info.supplyFeedScope ?? sourceDeviceLayout?.feedScope ?? 'shared',
                index: sourceDeviceLayout?.feedIndex ?? info.device.trunkPosition ?? 0,
                supplyPath: info.device.supplyPath,
                supplyConverterDcConnectionIndex: info.device.supplyConverterDcConnectionIndex,
                converterGridPlacement: info.device.converterGridPlacement,
                changeoverGridPlacement: info.device.changeoverGridPlacement,
                dcBusRoot: info.device.type === 'dc_bus',
              },
            })
          } else if (info.circuit) {
            setInternalDragPlacement({
              elementId,
              symbol,
              circuitTrunk: {
                circuitId: info.circuit.id,
                index: Math.max(
                  0,
                  info.circuit.trunkDevices?.findIndex((device) => device.id === elementId) ?? 0
                ),
                converterDcConnection: info.device.converterDcConnection,
                dcBusRoot: info.device.type === 'dc_bus',
              },
            })
          }
        }
      } else if (elementType === 'endpoint') {
        const endpoint = getEndpointById(elementId)
        const symbol = endpoint?.symbol ? getSymbolById(endpoint.symbol) : undefined
        if (symbol) setInternalDragPlacement({ elementId, symbol })
      } else if (elementType === 'protection') {
        const store = useProjectStore.getState()
        const protection = store.getProtectionById(elementId)
        const panel = store.getPanelForProtection(elementId)
        const symbolId = protection ? protectionTypeToSymbolKey(protection.type) : undefined
        const symbol = symbolId ? getSymbolById(symbolId) : undefined
        if (protection && panel && symbol) {
          const busCircuitId = pickRepresentativeCircuitIdForMainBusMove(panel, protection)
          const mainBusItems = getMainBusItemsWithIndices(panel)
          const mainIndex = mainBusItems.findIndex(
            (item) =>
              (item.type === 'protection' && item.id === protection.id) ||
              (item.type === 'circuit' && item.id === busCircuitId)
          )
          if (mainIndex >= 0) {
            setInternalDragPlacement({
              elementId,
              symbol,
              protectionBus: { kind: 'main', panelId: panel.id, index: mainIndex },
            })
          } else if (busCircuitId) {
            const panelCircuits = [
              ...panel.circuits,
              ...panel.protections.flatMap((candidate) => candidate.circuits ?? []),
            ]
            const parentCircuit = panelCircuits.find((candidate) =>
              candidate.subCircuitIds?.includes(busCircuitId)
            )
            const secondaryIndex = parentCircuit?.subCircuitIds?.indexOf(busCircuitId) ?? -1
            if (parentCircuit && secondaryIndex >= 0) {
              setInternalDragPlacement({
                elementId,
                symbol,
                protectionBus: {
                  kind: 'secondary',
                  panelId: panel.id,
                  parentCircuitId: parentCircuit.id,
                  index: secondaryIndex,
                },
              })
            }
          }
        }
      }
      const selection = viewportUI.getState().selection
      endpointDragStartSelectionIdsRef.current = selection.ids.includes(elementId)
        ? [...selection.ids]
        : [elementId]
      // Grabbing the first endpoint of a branch on its own moves the whole branch.
      if (
        elementType === 'endpoint' &&
        !altKey &&
        elementDragModeRef.current !== 'duplicate' &&
        endpointDragStartSelectionIdsRef.current.length === 1
      ) {
        const circuit = useProjectStore.getState().findCircuitForEndpoint(elementId)?.circuit
        const branchGroup = circuit ? getBranchDragGroupEndpointIds(circuit, elementId) : null
        if (branchGroup) endpointDragStartSelectionIdsRef.current = branchGroup
      }

      // Long-press duplicate already started window-level drag; block Konva move-drag.
      if (elementDragModeRef.current === 'duplicate') {
        return true
      }
      if (
        !altKey ||
        (elementType !== 'endpoint' &&
          elementType !== 'protection' &&
          elementType !== 'trunkDevice')
      ) {
        elementDragModeRef.current = 'move'
        return false
      }
      if (!nativeEvt) return false
      // Alt-drag is a targeted duplicate. Keep tracking the pointer and defer
      // all mutation until the drop target is known; Ctrl-D remains the
      // immediate duplicate action.
      beginAltDuplicatePointerDrag(elementId, elementType, nativeEvt)
      return true
    },
    [
      beginAltDuplicatePointerDrag,
      getEndpointById,
      getTrunkDeviceById,
      layout?.panels,
      viewportUI,
    ]
  )
  handleElementDragStartRef.current = handleElementDragStart

  const handleLongPressDuplicateDragStart = useCallback(
    (params: {
      elementId: string
      elementType: Selection['type']
      clientX: number
      clientY: number
    }) => {
      if (params.elementType !== 'endpoint' && params.elementType !== 'protection') return
      setSelection({ type: params.elementType, ids: [params.elementId] })
      beginAltDuplicatePointerDrag(params.elementId, params.elementType, {
        clientX: params.clientX,
        clientY: params.clientY,
      })
    },
    [beginAltDuplicatePointerDrag, setSelection]
  )

  const longPressDuplicateDrag = useMemo<EendraadLongPressDuplicateDrag | undefined>(
    () =>
      canDragItems
        ? {
            elementTypes: ['endpoint', 'protection'],
            onStart: handleLongPressDuplicateDragStart,
          }
        : undefined,
    [canDragItems, handleLongPressDuplicateDragStart]
  )

  // Handle ground symbol drag end
  const handleGroundDragEnd = useCallback(async () => {
    logger.info('[GroundSymbol] onDragEnd - dragPreview:', dragPreview)
    // Check if preview showed mainBus during drag
    if (dragPreview?.dropTarget?.type === 'mainBus' && dragPreview.dropTarget.panelId) {
      const panelId = dragPreview.dropTarget.panelId
      const targetPanelLayout = layout?.panels.find((p) => p.panel.id === panelId)

      logger.info(
        '[GroundSymbol] Adding ground to panel:',
        panelId,
        'isSubPanel:',
        targetPanelLayout?.isSubPanel
      )

      // Only add to main panels or create a local stem on a secondary board
      if (targetPanelLayout && currentProject && currentInstallation) {
        if (targetPanelLayout.isSubPanel) {
          const outcome = runProjectCommand('panel.ensureEarthingStem', { panelId })
          if (!outcome) return
        } else if (!targetPanelLayout.isSubPanel) {
          updateInstallation({ hasGround: true })
        }
        const activeFloorId = resolveSitplanTargetFloorId(
          currentProject,
          viewportUI.getState().activeFloorId
        )
        if (activeFloorId) {
          const uiSnap = viewportUI.getState()
          const preferredPlanPos =
            getViewportCenterPlanSpaceIfApplicable(
              uiSnap.viewportLayout,
              uiSnap.planCanvasViewportPx,
              uiSnap.activeFloorId,
              activeFloorId,
              uiSnap.planView
            ) ?? undefined
          ensureEarthingSitplanPlacement(activeFloorId, preferredPlanPos)
        }
        logger.info('[GroundSymbol] updateInstallation called')
      }
    }

    // Clear drag preview
    setDragPreview(null)
  }, [dragPreview, layout, currentProject, currentInstallation, updateInstallation, setDragPreview, viewportUI])
  handleGroundDragEndRef.current = handleGroundDragEnd

  const shouldSuppressKonvaDragEnd = useCallback(() => suppressKonvaDragEndRef.current, [])

  const handleNoteDragEnd = useCallback(
    (noteId: string, newPos: Point) => {
      if (!canDragItems) return
      updateEendraadNote(noteId, { pos: newPos })
    },
    [canDragItems, updateEendraadNote]
  )
  handleNoteDragEndRef.current = handleNoteDragEnd

  // Track panel IDs to detect when panels are added/removed
  const panelIds = useMemo(() => {
    return currentPanels.map((p: Panel) => p.id).join(',')
  }, [currentPanels])

  // Ensure all panels have placements on the plan
  useEffect(() => {
    // Get latest project state to avoid dependency on currentProject (which changes on every store update)
    const project = useProjectStore.getState().currentProject
    if (!project) return

    getProjectElectricalPanels(project).forEach((panel: Panel) => {
      const panelPlacement = ensurePanelPlacement(project, panel)
      if (!panelPlacement) return

      // Use the same complete lookup as ensurePanelPlacement, including
      // protection circuits and subpanels.
      const existingEndpoint = getPanelEndpoint(project, panel.id)

      if (!existingEndpoint) {
        // Check if a dummy circuit already exists for this panel
        let dummyCircuit = panel.circuits.find((c: Circuit) => c.code === 'PANEL')

        if (!dummyCircuit) {
          // Create dummy circuit for panel endpoint
          dummyCircuit = {
            id: generateId(),
            code: 'PANEL',
            kind: 'other',
            cable: {
              kind: 'XVB',
              conductors: 3,
              sectionMm2: 6,
              hasPE: true,
            },
            endpoints: [],
          }
          // Add circuit to panel
          addCircuit(panel.id, dummyCircuit)
        }

        // Add endpoint to circuit
        addEndpoint(dummyCircuit.id, {
          ...panelPlacement.endpoint,
          placements: [panelPlacement.placement],
        })
      } else {
        // Non-destructive sync: panel_distribution endpoints should have one placement.
        // If one already exists (possibly moved by the user), never auto-add another.
        if (existingEndpoint.placements.length === 0) {
          addPlacement(existingEndpoint.id, panelPlacement.placement)
        }
      }
    })
  }, [panelIds, addEndpoint, addPlacement, addCircuit])

  // Sync panel selection to plan view
  useEffect(() => {
    const eendraadSelection = viewportUI.getState().selection
    if (eendraadSelection.type === 'panel' && eendraadSelection.ids.length > 0 && currentProject) {
      // Find the panel's placement endpoint and sync selection
      const panelId = eendraadSelection.ids[0]
      if (!panelId) return
      const panel = useProjectStore.getState().getPanelById(panelId)
      if (panel) {
        // Find the endpoint that represents this panel (search in panel circuits)
        let panelEndpoint: Endpoint | undefined
        for (const circuit of panel.circuits) {
          panelEndpoint = circuit.endpoints.find(
            (e: Endpoint) =>
              e.symbol === 'panel_distribution' &&
              (e.panelId === panel.id || e.label === panel.name)
          )
          if (panelEndpoint) break
        }
        if (!panelEndpoint) {
          // Also check circuits under protections
          for (const protection of panel.protections) {
            if (protection.circuits) {
              for (const circuit of protection.circuits) {
                panelEndpoint = circuit.endpoints.find(
                  (e: Endpoint) =>
                    e.symbol === 'panel_distribution' &&
                    (e.panelId === panel.id || e.label === panel.name)
                )
                if (panelEndpoint) break
              }
            }
            if (panelEndpoint) break
          }
        }
        if (panelEndpoint) {
          // Sync to plan by selecting the endpoint's placement
          // This will be handled by PlanCanvas watching for panel selections
        }
      }
    }
  }, [currentProject, viewportUI])

  // Helper function to check if a panel is the last main panel
  const isLastMainPanelCallback = useCallback(
    (panelId: string): boolean => {
      if (!currentProject) return false

      const { getPanelById } = useProjectStore.getState()
      const panel = getPanelById(panelId)
      if (!panel || !panel.isMain) return false

      return isLastMainPanel(getProjectElectricalPanels(currentProject), panelId)
    },
    [currentProject]
  )

  // Handle keyboard Delete by invoking the same delete actions as context menu.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActiveViewport()) return
      if (!canDeleteItems) return
      if (!isEendraadDeleteKey(e)) {
        return
      }
      // A floating editor over the canvas (the junction editor) deletes its own selection.
      if (isKeyboardOwnedByFloatingEditor()) return

      // Only handle Delete when not typing in an input field or contentEditable
      if (
        isKeyboardTypingTarget(e.target)
      ) {
        return
      }

      const uiState = viewportUI.getState()
      let effectiveSelection = uiState.selection

      /* @vision-scan-strip-start */
      // Deleting a reference page here only takes it off the one-wire; the document stays.
      if (
        isElectricalVisionScanEnabled() &&
        uiState.selection.type === 'oneWireReference' &&
        uiState.selection.ids.length > 0
      ) {
        e.preventDefault()
        e.stopPropagation()
        removeOneWireReferenceItems(uiState.selection.ids)
        return
      }
      /* @vision-scan-strip-end */

      if (
        (uiState.selection.type === 'note' || uiState.selection.type === 'frame') &&
        uiState.selection.ids.length > 0
      ) {
        const store = useProjectStore.getState()
        const annotationTarget = resolveEendraadAnnotationDeleteTarget(
          uiState.selection,
          null,
          store
        )
        if (hasEendraadAnnotationDeleteTarget(annotationTarget)) {
          const refs = resolveSelectionDeleteRefs(uiState.selection, 'oneWire')
          // Situation-plan notes use that canvas's keyboard adapter and explicit note scope.
          if (!refs.length) return
          if (uiState.selection.type === 'note' && !pointerOverEendraadRef.current && uiState.selection.ids.some((id) => store.getSitplanNoteById(id))) return
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation()
          deleteProjectEntities(refs, { onDeleted: () => viewportUI.getState().clearSelection() })
          return
        }
      }

      // Floor-plan placements are handled by plan keyboard delete logic. Do not convert
      // placement selections back to endpoint ids here: multiplied plan symbols can be
      // deleted one copy at a time.
      if (uiState.selection.type === 'placement' && uiState.selection.ids.length > 0) {
        return
      }
      if (
        uiState.selection.type === 'wall' ||
        uiState.selection.type === 'wallPoint' ||
        uiState.selection.type === 'door' ||
        uiState.selection.type === 'window' ||
        uiState.selection.type === 'stair' ||
        uiState.selection.type === 'stairPoint' ||
        uiState.selection.type === 'graphicElement'
      ) {
        return
      }

      const resolver = contextMenuItemsResolverRef.current
      if (!resolver) {
        return
      }
      if (
        effectiveSelection.ids.length === 0 &&
        uiState.hover.type === 'panel' &&
        uiState.hover.ids.length > 0
      ) {
        effectiveSelection = { type: 'panel', ids: [...uiState.hover.ids] }
        viewportUI.getState().setSelection(effectiveSelection)
      }

      if (effectiveSelection.ids.length === 0) {
        return
      }

      const contextElementId =
        effectiveSelection.ids.length === 1 ? (effectiveSelection.ids[0] ?? null) : null
      const itemsForElement = resolver({ x: 0, y: 0 }, contextElementId)
      const itemsForSelection = resolver({ x: 0, y: 0 }, null)
      const items = itemsForElement.length > 0 ? itemsForElement : itemsForSelection
      if (!items.length) {
        return
      }

      const deleteItem =
        items.find(
          (item) =>
            !item.separator &&
            (item.label === t('contextMenu.deleteAll') || item.label === t('contextMenu.delete'))
        ) ?? items.find((item) => !item.separator && item.variant === 'danger')
      if (!deleteItem) {
        return
      }

      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      deleteItem.onClick()
    }

    // Capture phase so Eendraad delete runs before other global key handlers (e.g. plan keyboard).
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [canDeleteItems, t, window, viewportUI, isActiveViewport])

  // Get context menu items for right-click
  const handleGetContextMenuItems = useCallback(
    (_position: Point, elementId: string | null): ContextMenuItem[] => {
      const uiState = viewportUI.getState()
      const {
        selection,
        activeFloorId,
        clearSelection,
        setActivePanelId,
        setSelection: setLiveSelection,
      } = uiState
      const projectState = useProjectStore.getState()
      const {
        getCircuitById,
        getEendraadNoteById,
        getFrameById,
        getPanelById,
        getPanelForProtection,
        getCircuitsByPanel,
        getProtectionById,
        getEndpointById,
        getSitplanNoteById,
        getTrunkDeviceById,
        findCircuitForEndpoint,
      } = projectState
      const { openDialog, closeDialog } = useDialogStore.getState()
      const items: ContextMenuItem[] = []

      // Add Element and Add note at top of every symbol menu so they're available when right-clicking on a symbol (or empty with selection).
      const addElementAndNoteItems: ContextMenuItem[] = [
        {
          label: t('contextMenu.addElement'),
          icon: getContextMenuIcon('addElement'),
          onClick: () => setAddElementDropPosition(_position),
        },
        {
          label: t('contextMenu.addNote'),
          icon: getContextMenuIcon('addNote'),
          onClick: () => {
            const outcome = runProjectCommand('annotation.createNote', {
              scope: 'oneWire', pos: _position,
            }, { source: 'one-wire-context-menu' })
            const noteId = outcome?.results[0]?.created[0]?.id
            if (noteId) setLiveSelection({ type: 'note', ids: [noteId] })
          },
        },
        { label: '', onClick: () => {}, separator: true },
      ]

      // If hit detection missed (elementId null) but one item is selected, use it so right-click still shows that symbol's menu (e.g. Delete).
      let resolvedElementId = elementId
      if (!resolvedElementId && selection.ids.length === 1 && selection.ids[0]) {
        resolvedElementId = selection.ids[0]
      }

      if (selection.type === 'wire' && selection.ids.length === 1) {
        const metadata = selection.wireMetadata?.find(
          (candidate) => candidate.id === selection.ids[0]
        )
        const selectedWire =
          wireSegments.find((candidate) => candidate.id === selection.ids[0]) ??
          (metadata ? resolveSupplyWireSegmentByMetadata(wireSegments, metadata) : undefined)
        const assembly =
          currentProject && selectedWire?.supplyAssemblyId
            ? selectProjectSupplyAssemblies(currentProject).find(
                ({ id }) => id === selectedWire.supplyAssemblyId
              )
            : undefined
        const connection = assembly?.connections.find(
          ({ id }) => id === selectedWire?.supplyConnectionId
        )
        if (
          selectedWire?.type === 'vertical' &&
          selectedWire.panelId &&
          assembly &&
          connection?.pathRole === 'inverter-grid-ac'
        ) {
          items.push({
            label: t('contextMenu.delete'),
            icon: getContextMenuIcon('delete'),
            onClick: async () => {
              const outcome = runProjectCommand('supply.disconnectInverterGridInput', {
                assemblyId: assembly.id,
                panelId: selectedWire.panelId!,
              })
              if (outcome?.changed) clearSelection()
            },
            variant: 'danger',
          })
          return items
        }
      }

      // Check for multi-selection (2+ items selected, regardless of whether right-click hit an element)
      const hasMultiSelection = selection.ids.length > 1

      // For multi-selection, classify selected IDs by actual type (since rectangle selection
      // may put mixed types into a single selection with one nominal type). Deletion works on
      // the full selection regardless of type.
      if (hasMultiSelection) {
        const protectionIds: string[] = []
        const endpointIds: string[] = []
        const panelIds: string[] = []
        const trunkDeviceIds: string[] = []
        const noteIds: string[] = []
        const frameIds: string[] = []
        let hasGroundSelected = false
        let hasSupplySelected = false
        for (const id of selection.ids) {
          if (!id) continue
          if (isGroundElementId(id) && selection.type === 'ground') {
            hasGroundSelected = true
          } else if (id === 'supply' && selection.type === 'supply') {
            hasSupplySelected = true
          } else if (getProtectionById(id)) {
            protectionIds.push(id)
          } else if (getEndpointById(id)) {
            endpointIds.push(id)
          } else if (getPanelById(id)) {
            panelIds.push(id)
          } else if (getTrunkDeviceById(id)) {
            trunkDeviceIds.push(id)
          } else if (getEendraadNoteById(id)) {
            noteIds.push(id)
          } else if (getFrameById(id)) {
            frameIds.push(id)
          }
        }

        const hasDeletable =
          protectionIds.length > 0 ||
          endpointIds.length > 0 ||
          panelIds.length > 0 ||
          trunkDeviceIds.length > 0 ||
          hasGroundSelected ||
          noteIds.length > 0 ||
          frameIds.length > 0
        // Supply is not deletable - it's a permanent part of the installation

        const selectionBlocksFrame =
          noteIds.length > 0 || panelIds.length > 0 || frameIds.length > 0 || hasSupplySelected
        const hasFrameableContent =
          protectionIds.length +
            endpointIds.length +
            trunkDeviceIds.length +
            (hasGroundSelected ? 1 : 0) >
          0
        const classifiedForFrame = {
          protectionIds,
          endpointIds,
          trunkDeviceIds,
          hasGround: hasGroundSelected,
        }
        const panelIdForFrame = resolveEendraadFramePanelIdForSelection(layout, classifiedForFrame)
        const canFrame =
          hasFrameableContent && !selectionBlocksFrame && !!panelIdForFrame && !!currentProject
        const secondaryBusEjectSelection = resolveSecondaryBusEjectSelection(
          currentProject,
          protectionIds
        )

        if (hasDeletable) {
          items.push(...addElementAndNoteItems)
          // Add "Add Frame" for any frameable-only selection on one panel (mixed types / multi-circuit trunks OK)
          if (canFrame && panelIdForFrame && currentProject) {
            items.push({
              label: t('contextMenu.addFrame', 'Add Frame'),
              onClick: () => {
                const fields = buildFrameFieldsFromClassifiedSelection(
                  classifiedForFrame,
                  getTrunkDeviceById,
                  currentProject
                )
                const outcome = runProjectCommand('eendraad.createFrame', {
                  panelId: panelIdForFrame, fields,
                }, { source: 'one-wire-context-menu' })
                const frameId = outcome?.results[0]?.created[0]?.id
                if (frameId) setLiveSelection({ type: 'frame', ids: [frameId] })
              },
            })
            items.push({ label: '', onClick: () => {}, separator: true })
          }

          if (secondaryBusEjectSelection) {
            items.push({
              label: t('contextMenu.moveProtectionToNewPanel'),
              onClick: async () => {
                const outcome = runProjectCommand('panel.ejectSecondaryBusProtections', {
                  protectionIds: secondaryBusEjectSelection.protectionIds,
                  planPlacement: getEjectPlanPlacement(),
                })
                const newId = outcome?.results[0]?.created.find((ref) => ref.kind === 'panel')?.id
                if (newId) {
                  setActivePanelId(newId)
                  setLiveSelection({ type: 'panel', ids: [newId] })
                }
              },
            })
            items.push({ label: '', onClick: () => {}, separator: true })
          }

          if (endpointIds.length >= 1) {
            const endpointOnlySelection = {
              type: 'endpoint' as const,
              ids: [...endpointIds],
            }
            const multiDuplicateGetters = {
              getEndpointById,
              getCircuitById,
              findCircuitForEndpoint,
              getTrunkDeviceById,
              getProtectionById,
              getCurrentProject: () => projectState.currentProject,
              getSupplyTrunkDeviceIndex: (id: string) =>
                currentInstallation?.mainSupply?.supplyTrunkDevices?.findIndex(
                  (d: { id: string }) => d.id === id
                ) ?? -1,
              getGroundTrunkDeviceIndex: (id: string) =>
                currentProject
                  ? findGroundTrunkDeviceOwner(
                      getProjectElectricalPanels(currentProject),
                      currentInstallation,
                      id
                    )?.index ?? -1
                  : -1,
            }
            const multiDuplicateActions = {
              addEndpoint,
              syncEndpointMultiplierCount: (endpointId: string, count: number) =>
                syncEndpointMultiplierCount(
                  createSyncEndpointMultiplierDeps(),
                  endpointId,
                  count
                ),
              addCircuit,
              addTrunkDevice,
              updateTrunkDevice,
              addSupplyTrunkDevice,
              syncSupplyDeviceMultiplierCount: (deviceId: string, count: number) =>
                syncSupplyDeviceMultiplierCount(
                  createSyncSupplyInverterMultiplierDeps(),
                  deviceId,
                  count
                ),
              addGroundTrunkDevice,
              insertProtectionAfter,
              updateCircuit,
              duplicateProtection: (protectionId: string) => duplicateProtection({ protectionId, ownerDocument: window.document }),
              setSelection,
            }
            if (canDuplicateEendraadSelection(endpointOnlySelection, multiDuplicateGetters)) {
              items.push({
                label: t('contextMenu.duplicate'),
                onClick: () =>
                  doEendraadDuplicate(
                    endpointOnlySelection,
                    multiDuplicateGetters,
                    multiDuplicateActions
                  ),
              })
            }
            items.push({
              label: t('contextMenu.moveToFloor'),
              onClick: () => {
                const ids = [...endpointIds]
                const hasAnyNotOnActive =
                  !!activeFloorId &&
                  ids.some((id) => {
                    const ep = getEndpointById(id)
                    return ep && !ep.placements.some((p: Placement) => p.floorId === activeFloorId)
                  })
                const listHighlightFloorId = hasAnyNotOnActive ? activeFloorId : null
                openDialog({
                  type: 'custom',
                  title: t('contextMenu.moveToFloor'),
                  content: (
                    <FloorSelectionDialog
                      currentFloorId={activeFloorId}
                      listHighlightFloorId={listHighlightFloorId}
                      onSelect={(floorId) => {
                        applyEendraadEndpointsToFloor(ids, floorId)
                        closeDialog()
                      }}
                      onCancel={closeDialog}
                    />
                  ),
                })
              },
            })
            items.push({ label: '', onClick: () => {}, separator: true })
          }

          items.push({
            label: t('contextMenu.deleteAll'),
            onClick: () => {
              const runBulkDelete = (preserveLinkedPanels = false) => {
                const doDeletePanels = () => {
                  deleteProjectEntities(resolveSelectionDeleteRefs(selection, 'oneWire'), { preserveLinkedPanels, onDeleted: clearSelection })
                }
                if (panelIds.length > 0) {
                  const lastMainPanels = panelIds.filter((id) => id && isLastMainPanelCallback(id))
                  const selectedPanels = panelIds
                    .map((id) => (id ? getPanelById(id) : null))
                    .filter((panel): panel is Panel => panel !== null && panel !== undefined)
                  const mainPanels = selectedPanels.filter((panel) => panel.isMain)
                  const panelsWithContent = selectedPanels.filter(panelHasContent)
                  if (lastMainPanels.length > 0) {
                    const panelNames = lastMainPanels
                      .map((id) => (id ? getPanelById(id)?.name : null))
                      .filter((name): name is string => name !== null)
                      .join(', ')
                    openDialog({
                      type: 'info',
                      title: t('panel.deleteBlockedTitle', 'Cannot delete main panel'),
                      message: t('panel.deleteLastMainMessage', {
                        panelNames,
                        defaultValue: `Main panel "${panelNames}" cannot be deleted.`,
                      }),
                      variant: 'warning',
                      confirmLabel: t('common.ok', 'OK'),
                    })
                  } else if (mainPanels.length > 0) {
                    const panelNames = selectedPanels.map((panel) => panel.name).join(', ')
                    openDialog({
                      type: 'confirm',
                      title: t('panel.deleteConfirmTitle', 'Delete Panels?'),
                      message: t('panel.deleteMainConfirmMessage', {
                        panelNames,
                        defaultValue: `Delete main panel(s) "${panelNames}"? The selected panels and their contents will be removed. You can undo this action.`,
                      }),
                      variant: 'warning',
                      confirmLabel: t('common.delete'),
                      cancelLabel: t('common.cancel'),
                      onConfirm: doDeletePanels,
                    })
                  } else if (panelsWithContent.length > 0) {
                    const panelNames = panelsWithContent.map((p: Panel) => p.name).join(', ')
                    openDialog({
                      type: 'confirm',
                      title: t('panel.deleteConfirmTitle', 'Delete Panels?'),
                      message: t('panel.deleteConfirmMessage', {
                        panelNames,
                        defaultValue: `The following panel(s) contain circuits, protections, or sub-panels: ${panelNames}\n\nDeleting them will also delete all their contents. You can undo this action.\n\nAre you sure you want to continue?`,
                      }),
                      variant: 'warning',
                      confirmLabel: t('common.delete'),
                      cancelLabel: t('common.cancel'),
                      onConfirm: doDeletePanels,
                    })
                  } else doDeletePanels()
                } else {
                  doDeletePanels()
                }
              }

              const linkedPanelNames = linkedSubPanelDisplayNamesForProtectionIds(
                projectState.currentProject,
                getPanelById,
                protectionIds
              )
              const executeBulkDelete = () => {
                if (linkedPanelNames.length > 0) {
                  openDialog(
                    createLinkedProtectionDeleteDialog({
                      t,
                      panelNames: linkedPanelNames.join(', '),
                      onDeletePanel: () => runBulkDelete(false),
                      onDeleteProtection: () => runBulkDelete(true),
                    })
                  )
                } else {
                  runBulkDelete()
                }
              }
              if (hasGroundSelected) {
                confirmDeleteEarthing({ onConfirmed: executeBulkDelete, deleteOnConfirm: false })
              } else {
                executeBulkDelete()
              }
            },
            variant: 'danger',
          })
        }
      } else if (resolvedElementId) {
        // Single element context menu - check if it's a protection device, panel, or endpoint
        let protection = getProtectionById(resolvedElementId)

        // Fallback: if not found, check layout elements to find protection by ID
        if (!protection && layout) {
          for (const panelLayout of layout.panels) {
            const layoutElement = panelLayout.elements.find(
              (e) =>
                (e.type === 'protection' || e.type === 'rcd') &&
                e.protectionId === resolvedElementId
            )
            if (layoutElement?.protectionId) {
              protection = getProtectionById(layoutElement.protectionId)
              if (protection) break
            }
          }
        }

        const isProtectionSelected =
          selection.type === 'protection' && selection.ids.includes(resolvedElementId)
        const isPanelSelected =
          selection.type === 'panel' && selection.ids.includes(resolvedElementId)
        const isGroundSelected =
          selection.type === 'ground' && selection.ids.includes(resolvedElementId)
        const annotationDeleteTarget = resolveEendraadAnnotationDeleteTarget(
          selection,
          resolvedElementId,
          {
            getEendraadNoteById,
            getSitplanNoteById,
            getFrameById,
          }
        )

        // Also check if resolvedElementId is a protection ID by checking panel protections directly
        if (!protection && currentProject) {
          for (const panel of getProjectElectricalPanels(currentProject)) {
            const foundProtection = panel.protections.find(
              (p: ProtectionDevice) => p.id === resolvedElementId
            )
            if (foundProtection) {
              protection = foundProtection
              break
            }
            const checkSubPanels = (subPanels: Panel[]): ProtectionDevice | undefined => {
              for (const subPanel of subPanels) {
                const found = subPanel.protections.find(
                  (p: ProtectionDevice) => p.id === resolvedElementId
                )
                if (found) return found
                const subFound = checkSubPanels(subPanel.subPanels)
                if (subFound) return subFound
              }
              return undefined
            }
            const subFound = checkSubPanels(panel.subPanels)
            if (subFound) {
              protection = subFound
              break
            }
          }
        }

        if (isPanelSelected) {
          // Panel context menu
          const panel = getPanelById(resolvedElementId)
          const panelEndpoint = panel
            ? panel.circuits
                .flatMap((c) => c.endpoints ?? [])
                .find(
                  (e) =>
                    e.symbol === 'panel_distribution' &&
                    (e.panelId === panel.id || e.label === panel.name)
                )
            : undefined
          items.push(
            ...addElementAndNoteItems,
            ...(panelEndpoint
              ? [
                  {
                    label: t('contextMenu.moveToFloor'),
                    onClick: () => {
                      const ep = getEndpointById(panelEndpoint.id)
                      if (!ep) return
                      const hasPlacementOnActiveFloor =
                        !!activeFloorId &&
                        ep.placements.some((p: { floorId: string }) => p.floorId === activeFloorId)
                      const listHighlightFloorId =
                        activeFloorId && !hasPlacementOnActiveFloor ? activeFloorId : null
                      openDialog({
                        type: 'custom',
                        title: t('contextMenu.moveToFloor'),
                        content: (
                          <FloorSelectionDialog
                            currentFloorId={activeFloorId}
                            listHighlightFloorId={listHighlightFloorId}
                            onSelect={(floorId) => {
                              applyEendraadEndpointsToFloor([panelEndpoint.id], floorId)
                              closeDialog()
                            }}
                            onCancel={closeDialog}
                          />
                        ),
                      })
                    },
                  },
                  { label: '', onClick: () => {}, separator: true },
                ]
              : []),
            {
              label: t('contextMenu.copy'),
              onClick: () => setEendraadClipboard({ type: 'panel', ids: [resolvedElementId!] }),
            },
            {
              label: t('contextMenu.cut'),
              onClick: () => {
                setEendraadClipboard({ type: 'panel', ids: [resolvedElementId!] })
                deletePanel(resolvedElementId!)
                clearSelection()
              },
            },
            { label: '', onClick: () => {}, separator: true },
            {
              label: t('contextMenu.delete'),
              icon: getContextMenuIcon('delete'),
              onClick: () => {
                if (!panel) {
                  deletePanel(resolvedElementId!)
                  clearSelection()
                  return
                }

                // Check if this is the last main panel
                if (isLastMainPanelCallback(resolvedElementId!)) {
                  openDialog({
                    type: 'info',
                    title: t('panel.deleteBlockedTitle', 'Cannot delete main panel'),
                    message: t('panel.deleteLastMainMessage', {
                      panelNames: panel.name,
                      defaultValue: `Main panel "${panel.name}" cannot be deleted.`,
                    }),
                    variant: 'warning',
                    confirmLabel: t('common.ok', 'OK'),
                  })
                } else if (panel.isMain) {
                  openDialog({
                    type: 'confirm',
                    title: t('panel.deleteConfirmTitle', 'Delete Panel?'),
                    message: t('panel.deleteMainConfirmMessage', {
                      panelNames: panel.name,
                      defaultValue: `Delete main panel "${panel.name}"? The panel and its contents will be removed. You can undo this action.`,
                    }),
                    variant: 'warning',
                    confirmLabel: t('common.delete'),
                    cancelLabel: t('common.cancel'),
                    onConfirm: () => {
                      deletePanel(resolvedElementId!)
                      clearSelection()
                    },
                  })
                } else if (panelHasContent(panel)) {
                  openDialog({
                    type: 'confirm',
                    title: t('panel.deleteConfirmTitle', 'Delete Panel?'),
                    message: t('panel.deleteConfirmMessage', {
                      panelNames: panel.name,
                      defaultValue: `The panel "${panel.name}" contains circuits, protections, or sub-panels.\n\nDeleting it will also delete all its contents. You can undo this action.\n\nAre you sure you want to continue?`,
                    }),
                    variant: 'warning',
                    confirmLabel: t('common.delete'),
                    cancelLabel: t('common.cancel'),
                    onConfirm: () => {
                      deletePanel(resolvedElementId!)
                      clearSelection()
                    },
                  })
                } else {
                  openDialog({
                    type: 'confirm',
                    title: t('panel.deleteConfirmTitle', 'Delete Panel?'),
                    message: t('panel.deleteEmptyPanelMessage', {
                      panelNames: panel.name,
                      defaultValue: `Are you sure you want to delete panel "${panel.name}"?\n\nThis will also remove any associated frames and nested panels. You can undo this action.`,
                    }),
                    variant: 'warning',
                    confirmLabel: t('common.delete'),
                    cancelLabel: t('common.cancel'),
                    onConfirm: () => {
                      deletePanel(resolvedElementId!)
                      clearSelection()
                    },
                  })
                }
              },
              variant: 'danger',
            }
          )
        } else if (protection || isProtectionSelected) {
          const protectionContextIds =
            selection.type === 'protection' && selection.ids.includes(resolvedElementId)
              ? selection.ids
              : [resolvedElementId]
          const secondaryBusEjectSelection = resolveSecondaryBusEjectSelection(
            currentProject,
            protectionContextIds.filter((id): id is string => !!id)
          )
          const getters = {
            getEndpointById,
            getCircuitById,
            findCircuitForEndpoint,
            getTrunkDeviceById,
            getProtectionById,
            getPanelForProtection,
            getCircuitsByPanel,
            getCurrentProject: () => projectState.currentProject,
            getSupplyTrunkDeviceIndex: (id: string) =>
              currentInstallation?.mainSupply?.supplyTrunkDevices?.findIndex(
                (d: { id: string }) => d.id === id
              ) ?? -1,
            getGroundTrunkDeviceIndex: (id: string) =>
              currentProject
                ? findGroundTrunkDeviceOwner(
                    getProjectElectricalPanels(currentProject),
                    currentInstallation,
                    id
                  )?.index ?? -1
                : -1,
          }
          const actions = {
            addEndpoint,
            syncEndpointMultiplierCount: (endpointId: string, count: number) =>
              syncEndpointMultiplierCount(
                createSyncEndpointMultiplierDeps(),
                endpointId,
                count
              ),
            addCircuit,
            addTrunkDevice,
            updateTrunkDevice,
            addSupplyTrunkDevice,
            syncSupplyDeviceMultiplierCount: (deviceId: string, count: number) =>
              syncSupplyDeviceMultiplierCount(
                createSyncSupplyInverterMultiplierDeps(),
                deviceId,
                count
              ),
            addGroundTrunkDevice,
            insertProtectionAfter,
            updateCircuit,
            duplicateProtection: (protectionId: string) => duplicateProtection({ protectionId, ownerDocument: window.document }),
            setSelection,
          }
          items.push(
            ...addElementAndNoteItems,
            ...(canDuplicateEendraadSelection(selection, getters)
              ? [
                  {
                    label: t('contextMenu.duplicate'),
                    onClick: () => doEendraadDuplicate(selection, getters, actions),
                  },
                ]
              : []),
            ...(selection.type === 'protection' &&
            selection.ids.length === 1 &&
            selection.ids[0] === resolvedElementId
              ? [
                  ...(secondaryBusEjectSelection
                    ? [
                        {
                          label: t('contextMenu.moveProtectionToNewPanel'),
                          onClick: async () => {
                            const outcome = runProjectCommand('panel.ejectSecondaryBusProtections', {
                              protectionIds: secondaryBusEjectSelection.protectionIds,
                              planPlacement: getEjectPlanPlacement(),
                            })
                            const newId = outcome?.results[0]?.created.find((ref) => ref.kind === 'panel')?.id
                            if (newId) {
                              setActivePanelId(newId)
                              setLiveSelection({ type: 'panel', ids: [newId] })
                            }
                          },
                        },
                      ]
                    : []),
                  { label: '', onClick: () => {}, separator: true },
                ]
              : []),
            ...(secondaryBusEjectSelection &&
            !(
              selection.type === 'protection' &&
              selection.ids.length === 1 &&
              selection.ids[0] === resolvedElementId
            )
              ? [
                  {
                    label: t('contextMenu.moveProtectionToNewPanel'),
                    onClick: async () => {
                      const outcome = runProjectCommand('panel.ejectSecondaryBusProtections', {
                        protectionIds: secondaryBusEjectSelection.protectionIds,
                        planPlacement: getEjectPlanPlacement(),
                      })
                      const newId = outcome?.results[0]?.created.find((ref) => ref.kind === 'panel')?.id
                      if (newId) {
                        setActivePanelId(newId)
                        setLiveSelection({ type: 'panel', ids: [newId] })
                      }
                    },
                  },
                  { label: '', onClick: () => {}, separator: true },
                ]
              : []),
            {
              label: t('contextMenu.delete'),
              icon: getContextMenuIcon('delete'),
              onClick: () => {
                const protectionId = resolvedElementId!
                const runDelete = (preserveLinkedPanels = false) => {
                  deleteProtection(protectionId, { preserveLinkedPanels })
                  clearSelection()
                }
                const linkedNames = linkedSubPanelDisplayNamesForProtectionIds(
                  currentProject,
                  getPanelById,
                  [protectionId]
                )
                if (linkedNames.length > 0) {
                  openDialog(
                    createLinkedProtectionDeleteDialog({
                      t,
                      panelNames: linkedNames.join(', '),
                      onDeletePanel: () => runDelete(false),
                      onDeleteProtection: () => runDelete(true),
                    })
                  )
                } else {
                  runDelete()
                }
              },
              variant: 'danger',
            }
          )
        } else if (isGroundSelected || isGroundElementId(resolvedElementId)) {
          // Ground symbol context menu
          items.push(...addElementAndNoteItems, {
            label: t('contextMenu.delete'),
            icon: getContextMenuIcon('delete'),
            onClick: () => confirmDeleteEarthing({ groundElementId: resolvedElementId }),
            variant: 'danger',
          })
        } else if (selection.type === 'supply' && selection.ids.includes('supply')) {
          // Supply symbol context menu (supply can't be deleted or duplicated)
        } else if (selection.type === 'trunkDevice' && selection.ids.includes(resolvedElementId)) {
          // Trunk device context menu (energy meter, protection on wire)
          const trunkResult = getTrunkDeviceById(resolvedElementId!)
          const trunkDevice = trunkResult?.device
          const supportsDeviceMultiplier = supportsSupplyDeviceMultiplier(trunkDevice)
          let panelIdForFrame: string | undefined
          if (layout) {
            for (const panelLayout of layout.panels) {
              if (
                (panelLayout as PanelLayoutWithElements).elements?.some(
                  (el) => el.type === 'trunkDevice' && el.trunkDeviceId === resolvedElementId
                )
              ) {
                panelIdForFrame = panelLayout.panel.id
                break
              }
            }
          }
          items.push(
            ...addElementAndNoteItems,
            ...(supportsDeviceMultiplier && trunkDevice
              ? [
                  {
                    label: t('contextMenu.addMore', 'Add more...'),
                    onClick: () => openSupplyDeviceAddMoreDialog(trunkDevice, t),
                  },
                ]
              : []),
            ...(panelIdForFrame && currentProject
              ? [
                  {
                    label: t('contextMenu.addFrame', 'Add Frame'),
                    onClick: () => {
                      const fields = buildFrameFieldsFromClassifiedSelection(
                        {
                          protectionIds: [],
                          endpointIds: [],
                          trunkDeviceIds: [resolvedElementId!],
                          hasGround: false,
                        },
                        getTrunkDeviceById,
                        currentProject
                      )
                      const outcome = runProjectCommand('eendraad.createFrame', {
                        panelId: panelIdForFrame!, fields,
                      }, { source: 'one-wire-context-menu' })
                      const frameId = outcome?.results[0]?.created[0]?.id
                      if (frameId) setLiveSelection({ type: 'frame', ids: [frameId] })
                    },
                  },
                  { label: '', onClick: () => {}, separator: true },
                ]
              : []),
            {
              label: t('contextMenu.delete'),
              icon: getContextMenuIcon('delete'),
              onClick: () => {
                if (trunkResult) {
                  const { device, circuit, isSupplyDevice, isGroundDevice } = trunkResult
                  const performDelete = () => {
                    if (isSupplyDevice) {
                      confirmDeleteSupplyTrunkDevice(resolvedElementId!)
                    } else if (isGroundDevice) {
                      deleteGroundTrunkDevice(resolvedElementId!)
                    } else if (circuit) {
                      deleteTrunkDevice(circuit.id, resolvedElementId!)
                    }
                    clearSelection()
                  }

                  // If this is a rectifier on a circuit that feeds DC-only endpoints, warn and cascade delete them.
                  if (device.symbol === 'rectifier' && circuit && circuit.endpoints?.length) {
                    const dcEndpoints = circuit.endpoints.filter(
                      (ep: Endpoint) => ep.symbol === 'solar_panel' || ep.symbol === 'battery'
                    )
                    if (dcEndpoints.length > 0) {
                      openDialog({
                        type: 'confirm',
                        title: t('wires.deleteRectifierWithDcDevicesTitle', {
                          defaultValue: 'Delete rectifier and DC devices?',
                        }),
                        message: t('wires.deleteRectifierWithDcDevicesMessage', {
                          defaultValue:
                            'This rectifier feeds {{count}} DC-only device(s) (solar panels / batteries). Deleting it will also delete those devices. Do you want to continue?',
                          count: dcEndpoints.length,
                        }),
                        variant: 'warning',
                        confirmLabel: t('common.delete'),
                        cancelLabel: t('common.cancel'),
                        onConfirm: () => {
                          performDelete()
                        },
                      })
                      return
                    }
                  }

                  performDelete()
                } else {
                  clearSelection()
                }
              },
              variant: 'danger',
            }
          )
        } else if (hasEendraadAnnotationDeleteTarget(annotationDeleteTarget)) {
          // Note/frame context menu (resolved by actual item id, not only selection type).
          items.push(...addElementAndNoteItems, {
            label: t('contextMenu.delete'),
            icon: getContextMenuIcon('delete'),
            onClick: () => {
              deleteProjectEntities([
                ...annotationDeleteTarget.eendraadNoteIds.map((id) => ({ kind: 'note' as const, id, scope: 'oneWire' as const })),
                ...annotationDeleteTarget.sitplanNoteIds.map((id) => ({ kind: 'note' as const, id, scope: 'sitplan' as const })),
                ...annotationDeleteTarget.frameIds.map((id) => ({ kind: 'frame' as const, id })),
              ], { onDeleted: clearSelection })
            },
            variant: 'danger',
          })
        } else if (!getEndpointById(resolvedElementId)) {
          // Wires, busbars, bus sections and other derived items are implicit: they
          // disappear with the symbols that create them, so offer no Delete here.
          items.push(...addElementAndNoteItems)
        } else {
          // Endpoint context menu
          const endpoint = getEndpointById(resolvedElementId!)
          const supportsAddMore =
            !!endpoint && (endpointSupportsMultiplier(endpoint) || endpoint.type === 'socket')
          // The store refuses to delete the main panel's distribution symbol.
          const canDeleteEndpoint =
            !!endpoint &&
            !(currentProject && isMainPanelDistributionEndpoint(currentProject, endpoint))
          items.push(
            ...addElementAndNoteItems,
            {
              label: t('contextMenu.moveToFloor'),
              onClick: () => {
                const endpointId = resolvedElementId!
                const ep = getEndpointById(endpointId)
                if (!ep) return
                const hasPlacementOnActiveFloor =
                  !!activeFloorId &&
                  ep.placements.some((p: Placement) => p.floorId === activeFloorId)
                const listHighlightFloorId =
                  activeFloorId && !hasPlacementOnActiveFloor ? activeFloorId : null
                openDialog({
                  type: 'custom',
                  title: t('contextMenu.moveToFloor'),
                  content: (
                    <FloorSelectionDialog
                      currentFloorId={activeFloorId}
                      listHighlightFloorId={listHighlightFloorId}
                      onSelect={(floorId) => {
                        applyEendraadEndpointsToFloor([endpointId], floorId)
                        closeDialog()
                      }}
                      onCancel={closeDialog}
                    />
                  ),
                })
              },
            },
            ...(canDuplicateEendraadSelection(selection, {
              getEndpointById,
              getCircuitById,
              findCircuitForEndpoint,
              getTrunkDeviceById,
              getProtectionById,
              getCurrentProject: () => projectState.currentProject,
              getSupplyTrunkDeviceIndex: (id: string) =>
                currentInstallation?.mainSupply?.supplyTrunkDevices?.findIndex(
                  (d: { id: string }) => d.id === id
                ) ?? -1,
              getGroundTrunkDeviceIndex: (id: string) =>
                currentProject
                  ? findGroundTrunkDeviceOwner(
                      getProjectElectricalPanels(currentProject),
                      currentInstallation,
                      id
                    )?.index ?? -1
                  : -1,
            })
              ? [
                  {
                    label: t('contextMenu.duplicate'),
                    onClick: () => {
                      doEendraadDuplicate(
                        selection,
                        {
                          getEndpointById,
                          getCircuitById,
                          findCircuitForEndpoint,
                          getTrunkDeviceById,
                          getProtectionById,
                          getCurrentProject: () => projectState.currentProject,
                          getSupplyTrunkDeviceIndex: (id: string) =>
                            currentInstallation?.mainSupply?.supplyTrunkDevices?.findIndex(
                              (d: { id: string }) => d.id === id
                            ) ?? -1,
                          getGroundTrunkDeviceIndex: (id: string) =>
                            currentProject
                              ? findGroundTrunkDeviceOwner(
                                  getProjectElectricalPanels(currentProject),
                                  currentInstallation,
                                  id
                                )?.index ?? -1
                              : -1,
                        },
                        {
                          addEndpoint,
                          syncEndpointMultiplierCount: (endpointId: string, count: number) =>
                            syncEndpointMultiplierCount(
                              createSyncEndpointMultiplierDeps(),
                              endpointId,
                              count
                            ),
                          addCircuit,
                          addTrunkDevice,
                          updateTrunkDevice,
                          addSupplyTrunkDevice,
                          syncSupplyDeviceMultiplierCount: (deviceId: string, count: number) =>
                            syncSupplyDeviceMultiplierCount(
                              createSyncSupplyInverterMultiplierDeps(),
                              deviceId,
                              count
                            ),
                          addGroundTrunkDevice,
                          insertProtectionAfter,
                          updateCircuit,
                          duplicateProtection: (protectionId: string) => duplicateProtection({ protectionId, ownerDocument: window.document }),
                          setSelection,
                        }
                      )
                    },
                  },
                ]
              : []),
            ...(supportsAddMore
              ? [
                  {
                    label: t('contextMenu.addMore', 'Add more...'),
                    onClick: () => {
                      if (!endpoint) return
                      openAddMoreDialogForEndpoint(endpoint, t)
                    },
                  },
                ]
              : []),
            ...(canDeleteEndpoint
              ? [
                  { label: '', onClick: () => {}, separator: true },
                  {
                    label: t('contextMenu.delete'),
                    icon: getContextMenuIcon('delete'),
                    onClick: () => {
                      deleteEndpoint(resolvedElementId!)
                      clearSelection()
                    },
                    variant: 'danger' as const,
                  },
                ]
              : [])
          )
        }
      } else {
        // Right-click on empty space with no selection
        items.push(
          {
            label: t('contextMenu.addElement'),
            icon: getContextMenuIcon('addElement'),
            onClick: () => setAddElementDropPosition(_position),
          },
          {
            label: t('contextMenu.addNote'),
            icon: getContextMenuIcon('addNote'),
            onClick: () => {
            const outcome = runProjectCommand('annotation.createNote', {
              scope: 'oneWire', pos: _position,
            }, { source: 'one-wire-context-menu' })
            const noteId = outcome?.results[0]?.created[0]?.id
            if (noteId) setLiveSelection({ type: 'note', ids: [noteId] })
            },
          }
        )
      }

      while (items.length > 0 && items[items.length - 1]?.separator) items.pop()
      return items
    },
    [
      t,
      isLastMainPanelCallback,
      setEendraadClipboard,
      setAddElementDropPosition,
      currentProject,
      addEndpoint,
      addCircuit,
      addTrunkDevice,
      addSupplyTrunkDevice,
      addGroundTrunkDevice,
      insertProtectionAfter,
      layout,
      wireSegments,
      setSelection,
      withSingleUndoEntry,
      currentInstallation,
      updateCircuit,
      updateTrunkDevice,
      viewportUI,
    ]
  )

  useEffect(() => {
    contextMenuItemsResolverRef.current = handleGetContextMenuItems
  }, [handleGetContextMenuItems])

  const handleEendraadContextMenu = useCallback(
    (position: Point, elementId: string | null) => {
      if (eendraadDateMarkingMode) {
        exitDateMarkingMode()
        return []
      }
      /* @vision-scan-strip-start */
      if (isElectricalVisionScanEnabled() && elementId) {
        const { documentId } = parseOneWireReferenceItemId(elementId)
        const reference = useProjectStore
          .getState()
          .currentProject?.assets.find((asset) => asset.id === documentId)?.document?.oneWire
        if (reference) {
          if (!canEditProject) return []
          return [
            {
              label: t('oneWireReference.remove', 'Remove from one-wire'),
              icon: getContextMenuIcon('delete'),
              variant: 'danger' as const,
              onClick: () => removeOneWireReferenceItems([elementId]),
            },
          ]
        }
      }
      /* @vision-scan-strip-end */
      const items = withJunctionEditorItem(handleGetContextMenuItems(position, elementId), [
        elementId ?? viewportUI.getState().selection.ids[0],
      ])
      if (!canEditProject || !canDragItems) return items
      // Dragged metadata cards can return to automatic placement. Card owners are
      // part of the card's selection, so check the selection and the hit element.
      const { getEndpointById, getTrunkDeviceById } = useProjectStore.getState()
      const candidateIds = new Set([
        ...viewportUI.getState().selection.ids,
        ...(elementId ? [elementId] : []),
      ])
      const movedOwners = [...candidateIds].flatMap((id): MetadataCalloutOwnerRef[] => {
        const owner: MetadataCalloutOwnerRef | null = getEndpointById(id)
          ? { type: 'endpoint', id }
          : getTrunkDeviceById(id)
            ? { type: 'trunkDevice', id }
            : null
        return owner && getStoredMetadataCalloutOffset(owner) ? [owner] : []
      })
      if (movedOwners.length === 0) return items
      const resetItem: ContextMenuItem = {
        label: t('contextMenu.resetCardPosition'),
        onClick: () =>
          withSingleUndoEntry(() => {
            movedOwners.forEach((owner) => setMetadataCalloutOffset(owner, null))
            return true
          }),
      }
      const firstDangerIndex = items.findIndex((item) => item.variant === 'danger')
      if (firstDangerIndex < 0) return [...items, resetItem]
      const insertIndex =
        firstDangerIndex > 0 && items[firstDangerIndex - 1]?.separator
          ? firstDangerIndex - 1
          : firstDangerIndex
      return [...items.slice(0, insertIndex), resetItem, ...items.slice(insertIndex)]
    },
    [canDragItems, canEditProject, eendraadDateMarkingMode, exitDateMarkingMode, handleGetContextMenuItems, t, withJunctionEditorItem, withSingleUndoEntry, viewportUI]
  )

  const handleAddElementSelect = useCallback(
    (symbol: import('@/lib/symbols').SymbolMetadata, position: Point) => {
      handleDrop(position, symbol)
      setAddElementDropPosition(null)
    },
    [handleDrop]
  )

  // Blank canvas only accepts a few symbols (e.g. a new board); list only those there so
  // picking an element never silently does nothing.
  const canPlaceAddElementSymbol = useMemo(() => {
    if (!addElementDropPosition || !layoutTree) return undefined
    const { target } = findDropTargetWithDebug(layoutTree, addElementDropPosition)
    if (target.type !== null || target.panelId) return undefined
    return (symbol: import('@/lib/symbols').SymbolMetadata) => canDropSymbolOnEmptyCanvas(symbol.id)
  }, [addElementDropPosition, layoutTree])

  const [separatorTooltip, setSeparatorTooltip] = useState<{
    text: string
    clientX: number
    clientY: number
  } | null>(null)
  const describeEnclosureTransition = useCallback(
    (transition: { from: string; to: string }) => {
      const name = (key: string) =>
        currentProject
          ? describeEnclosureKey(currentProject, key, (k, fallback) => t(k, fallback))
          : key
      return t('canvas.enclosureTransition', '{{from}} → {{to}}', {
        from: name(transition.from),
        to: name(transition.to),
      })
    },
    [currentProject, t]
  )

  const supplySeparators = useMemo(() => {
    if (!layout) return []
    return layout.panels.flatMap((panelLayout) =>
      getSupplySeparatorsForDiagram(wireSegments, getPanelDiagramId(panelLayout))
    )
  }, [layout, wireSegments])

  const enableAutomaticNamingAndApply = useCallback(() => {
    updateInstallation({ eendraadAutomaticNaming: true })
    applyAutomaticEendraadNamingAllPanels()
  }, [applyAutomaticEendraadNamingAllPanels, updateInstallation])

  const handleEendraadAutomaticNamingChange = useCallback(
    (checked: boolean) => {
      if (!currentProject) return
      if (!checked) {
        updateInstallation({ eendraadAutomaticNaming: false })
        return
      }
      const opts = resolveAutomaticNamingOptsFromInstallation(
        getProjectElectricalInstallation(currentProject)
      )
      if (!automaticMainBusNamingWouldChangeProject(currentProject, opts)) {
        enableAutomaticNamingAndApply()
        return
      }
      openDialog({
        type: 'confirm',
        title: t('canvas.eendraadNaming.confirmOverwriteTitle'),
        message: t('canvas.eendraadNaming.confirmOverwriteMessage'),
        variant: 'warning',
        confirmLabel: t('canvas.eendraadNaming.confirmOverwriteConfirm'),
        cancelLabel: t('common.cancel'),
        onConfirm: enableAutomaticNamingAndApply,
      })
    },
    [currentProject, enableAutomaticNamingAndApply, openDialog, t, updateInstallation]
  )

  const handleResetAllEendraadLabels = useCallback(() => {
    if (!currentProject || !eendraadAutoNaming || !hasCustomEendraadLabels) return
    openDialog({
      type: 'confirm',
      title: t('canvas.eendraadNaming.resetAllConfirmTitle', 'Reset all custom labels?'),
      message: t(
        'canvas.eendraadNaming.resetAllConfirmMessage',
        'All custom circuit labels will be cleared and replaced by automatic labels. You can undo this change.'
      ),
      variant: 'warning',
      confirmLabel: t('canvas.eendraadNaming.resetAllConfirm', 'Reset labels'),
      cancelLabel: t('common.cancel'),
      onConfirm: () => {
        const latestProject = useProjectStore.getState().currentProject
        if (!latestProject || !projectHasManualEendraadLabelOverrides(latestProject)) return
        withSingleUndoEntry(() => {
          resetAllEendraadLabelOverrides()
          return true
        })
      },
    })
  }, [
    currentProject,
    eendraadAutoNaming,
    hasCustomEendraadLabels,
    openDialog,
    resetAllEendraadLabelOverrides,
    t,
    withSingleUndoEntry,
  ])

  const applyHideFeederPreferenceAndRenumber = useCallback(
    (hideFeederLetters: boolean) => {
      updateInstallation({ eendraadAutoNamingHideFeederLetters: hideFeederLetters })
      applyAutomaticEendraadNamingAllPanels()
    },
    [applyAutomaticEendraadNamingAllPanels, updateInstallation]
  )

  const handleEendraadHideFeederLettersChange = useCallback(
    (checked: boolean) => {
      if (!currentProject) return
      if (!eendraadAutoNaming) {
        updateInstallation({ eendraadAutoNamingHideFeederLetters: checked })
        return
      }
      const opts = { hideFeederLetters: checked }
      if (!automaticMainBusNamingWouldChangeProject(currentProject, opts)) {
        applyHideFeederPreferenceAndRenumber(checked)
        return
      }
      openDialog({
        type: 'confirm',
        title: t('canvas.eendraadNaming.confirmOverwriteTitle'),
        message: t('canvas.eendraadNaming.confirmOverwriteMessage'),
        variant: 'warning',
        confirmLabel: t('canvas.eendraadNaming.confirmOverwriteConfirm'),
        cancelLabel: t('common.cancel'),
        onConfirm: () => applyHideFeederPreferenceAndRenumber(checked),
      })
    },
    [
      applyHideFeederPreferenceAndRenumber,
      currentProject,
      eendraadAutoNaming,
      openDialog,
      t,
      updateInstallation,
    ]
  )

  const normalSceneArtworkRevision = useMemo(
    () => ({
      layout,
      layoutTree,
      wireSegments,
      currentProject,
      advancedPanelLabels,
      t,
      supplySeparators,
    }),
    [layout, layoutTree, wireSegments, currentProject, advancedPanelLabels, t, supplySeparators]
  )

  const diagramSceneMounting = useMemo(
    () => indexDiagramSceneMounting(layout?.panels ?? [], layoutTree?.panels ?? [], wireSegments),
    [layout, layoutTree, wireSegments]
  )
  const diagramOverviewModels = useMemo(() => {
    const models = new Map<string, NonNullable<ReturnType<typeof buildDiagramOverview>>>()
    if (!layout || !layoutTree || layout.panels.length <= 8) return models
    const wiresByDiagram = new Map<string, WireSegment[]>()
    for (const wire of wireSegments) {
      const id = wire.diagramId ?? wire.panelId
      let wires = wiresByDiagram.get(id)
      if (!wires) wiresByDiagram.set(id, wires = [])
      wires.push(wire)
    }
    for (const panelLayout of layout.panels) {
      if (panelLayout.frameRole === 'supply' || panelLayout.supplyChangeoverBranches ||
        panelLayout.supplyConverterBranch || getFramesByPanel(panelLayout.panel.id).length > 0) continue
      const id = getPanelDiagramId(panelLayout)
      const panelNode = layoutTree.panels.find((node) => node.diagramId === id)
      if (!panelNode) continue
      const model = buildDiagramOverview(panelNode, wiresByDiagram.get(id) ?? [])
      if (model) models.set(id, model)
    }
    return models
  }, [layout, layoutTree, wireSegments, currentProject, getFramesByPanel])
  const selectedDiagramIds = useMemo(() => {
    const ids = new Set<string>()
    for (const id of [...selection.ids, ...(selection.wireAnchor ? [selection.wireAnchor] : [])]) {
      for (const diagramId of diagramSceneMounting.diagramIdsByEntityId.get(id) ?? []) {
        ids.add(diagramId)
      }
    }
    if (selection.type === 'frame') {
      for (const panel of layout?.panels ?? []) {
        if (getFramesByPanel(panel.panel.id).some((frame) => selection.ids.includes(frame.id))) {
          ids.add(getPanelDiagramId(panel))
        }
      }
    }
    if (selection.type === 'supply') {
      for (const panel of layout?.panels ?? []) {
        if (!selection.supplyPanelId || panel.panel.id === selection.supplyPanelId) {
          ids.add(getPanelDiagramId(panel))
        }
      }
    }
    return ids
  }, [diagramSceneMounting, selection, layout, getFramesByPanel])

  const normalScene = useMemo(() => {
    if (!layoutTree || !layout) return null
    const initialZoom = viewportUI.getState().eendraadView.zoom

    return (
      <>
        {layout.panels.map((panelLayout) => {
          const panelNode = layoutTree.panels.find(
            (p) => p.diagramId === getPanelDiagramId(panelLayout)
          )
          if (!panelNode) return null
          const overviewModel = diagramOverviewModels.get(getPanelDiagramId(panelLayout))
          const renderDiagramNode = (node: LayoutNode) => (
            <RenderNode
              node={node}
              translate={t}
              advancedPanelLabels={advancedPanelLabels}
              panelLayout={panelLayout}
              getProtectionById={getProtectionById}
              getPanelById={getPanelById}
              getCanvasPositionFromEvent={getCanvasPositionFromEvent}
              onElementDragStart={canDragItems ? stableElementDragStart : undefined}
              shouldSuppressKonvaDragEnd={canDragItems ? shouldSuppressKonvaDragEnd : undefined}
              onElementDragMove={canDragItems ? stableElementDragMove : undefined}
              onElementDragEnd={canDragItems ? stableElementDragEnd : undefined}
              onGroundDragEnd={canDragItems ? stableGroundDragEnd : undefined}
            />
          )

          return (
            <ViewportMountedDiagram
              key={getPanelDiagramId(panelLayout)}
              name={`panel-group-${getPanelDiagramId(panelLayout)}`}
              logicalBounds={
                diagramSceneMounting.boundsByDiagramId.get(getPanelDiagramId(panelLayout)) ??
                panelLayout.frame
              }
              boundsRevision={normalSceneArtworkRevision}
              virtualized={layout.panels.length > 8}
              initialZoom={initialZoom}
              forceMounted={selectedDiagramIds.has(getPanelDiagramId(panelLayout))}
              materializeForcedDetail={false}
              overview={overviewModel ? (forward) => (
                <DiagramOverview model={overviewModel} panelLayout={panelLayout}
                  forward={forward} renderAuxiliaryNode={renderDiagramNode} />
              ) : undefined}
            >
              {/* Frames layer - render first so they appear under everything */}
              {panelLayout.frameRole !== 'supply' &&
                getFramesByPanel(panelLayout.panel.id).map((frame: Frame) => (
                  <FrameComponent key={frame.id} frame={frame} panelLayout={panelLayout} />
                ))}

              {/* Supply/panel dashed separator — behind wires and labels */}
              {supplySeparators
                .filter((separator) => separator.diagramId === getPanelDiagramId(panelLayout))
                .flatMap((separator) =>
                  separator.pieces.map((points, index) => (
                    <Line
                      key={`${separator.id}-${index}`}
                      points={points}
                      stroke="#6b7280"
                      strokeWidth={2.25}
                      dash={[4, 4]}
                      lineCap="round"
                      listening={false}
                    />
                  ))
                )}

              {/* Wire segments layer - render above frames/separator but below symbols */}
              <WireSegments
                panelId={panelLayout.panel.id}
                diagramId={getPanelDiagramId(panelLayout)}
                wireSegments={wireSegments}
              />

              {/* Tree-based element rendering */}
              {renderDiagramNode(panelNode)}

              {/* Small hover zones naming the two enclosures of each dashed transition */}
              {supplySeparators
                .filter(
                  (separator) =>
                    separator.transition != null &&
                    separator.diagramId === getPanelDiagramId(panelLayout)
                )
                .map((separator) => {
                  const long = ENCLOSURE_SEPARATOR_HALF_LENGTH * 2 + 4
                  const width = separator.horizontal ? 10 : long
                  const height = separator.horizontal ? long : 10
                  const text = describeEnclosureTransition(separator.transition!)
                  const show = (event: KonvaEventObject<MouseEvent>) =>
                    setSeparatorTooltip({
                      text,
                      clientX: event.evt.clientX,
                      clientY: event.evt.clientY,
                    })
                  return (
                    <Rect
                      key={`${separator.id}-hover`}
                      name="eendraad-enclosure-separator-hover"
                      x={separator.center.x - width / 2}
                      y={separator.center.y - height / 2}
                      width={width}
                      height={height}
                      fill="transparent"
                      onMouseEnter={show}
                      onMouseMove={show}
                      onMouseLeave={() => setSeparatorTooltip(null)}
                    />
                  )
                })}
            </ViewportMountedDiagram>
          )
        })}

        {/* Notes layer - render last so they appear on top of everything (above preview graph) */}
        {eendraadNotes.map((note) => (
          <NoteSymbol key={note.id} note={note} onDragEnd={stableNoteDragEnd} />
        ))}
      </>
    )
  }, [
    advancedPanelLabels,
    canDragItems,
    eendraadNotes,
    getCanvasPositionFromEvent,
    getFramesByPanel,
    getPanelById,
    getProtectionById,
    layout,
    layoutTree,
    normalSceneArtworkRevision,
    diagramSceneMounting,
    diagramOverviewModels,
    selectedDiagramIds,
    shouldSuppressKonvaDragEnd,
    stableElementDragEnd,
    stableElementDragMove,
    stableElementDragStart,
    stableGroundDragEnd,
    stableNoteDragEnd,
    supplySeparators,
    describeEnclosureTransition,
    t,
    wireSegments,
    viewportUI,
  ])

  const selectedEndpointOverlay = useMemo(() => {
    if (
      selection.type !== 'endpoint' ||
      selection.ids.length !== 1 ||
      !layoutTree ||
      !layout
    ) {
      return null
    }
    const target = findEndpointRenderTarget(layoutTree.panels, selection.ids[0]!)
    if (!target) return null
    const panelLayout = layout.panels.find(
      (candidate) => getPanelDiagramId(candidate) === target.panelNode.diagramId
    )
    if (!panelLayout) return null
    return (
      <CanvasPanOrClickProvider onBeginPan={beginInteractiveOverlayPan}>
        <RenderNode
          node={target.node}
          translate={t}
          advancedPanelLabels={advancedPanelLabels}
          panelLayout={panelLayout}
          getProtectionById={getProtectionById}
          getPanelById={getPanelById}
          getCanvasPositionFromEvent={getCanvasPositionFromEvent}
          onElementDragStart={canDragItems ? stableElementDragStart : undefined}
          shouldSuppressKonvaDragEnd={canDragItems ? shouldSuppressKonvaDragEnd : undefined}
          onElementDragMove={canDragItems ? stableElementDragMove : undefined}
          onElementDragEnd={canDragItems ? stableElementDragEnd : undefined}
          onGroundDragEnd={canDragItems ? stableGroundDragEnd : undefined}
          renderSelectedEndpoint
        />
      </CanvasPanOrClickProvider>
    )
  }, [
    advancedPanelLabels,
    beginInteractiveOverlayPan,
    canDragItems,
    getCanvasPositionFromEvent,
    getPanelById,
    getProtectionById,
    layout,
    layoutTree,
    selection,
    shouldSuppressKonvaDragEnd,
    stableElementDragEnd,
    stableElementDragMove,
    stableElementDragStart,
    stableGroundDragEnd,
    t,
  ])

  const previewArtworkKey = getEendraadPreviewIntentKey(dragPreview)
  const previewArtworkFollowsPointer = Boolean(
    dragPreview?.movingPanelAttachment ||
    ((dragPreview?.dropTarget?.type === 'mainBus' || isSecondaryBusPreviewTarget(dragPreview?.dropTarget)) &&
      dragPreview?.symbolData &&
      PROTECTION_SYMBOL_IDS.includes(
        dragPreview.symbolData.id as (typeof PROTECTION_SYMBOL_IDS)[number]
      ))
  )
  const stableArtworkRef = useRef({
    key: previewArtworkKey,
    nodeId: activeDropTargetNodeId,
    preview: dragPreview,
  })
  if (
    stableArtworkRef.current.key !== previewArtworkKey ||
    stableArtworkRef.current.nodeId !== activeDropTargetNodeId ||
    previewArtworkFollowsPointer
  ) {
    stableArtworkRef.current = {
      key: previewArtworkKey,
      nodeId: activeDropTargetNodeId,
      preview: dragPreview,
    }
  }
  const artworkPreview = stableArtworkRef.current.preview

  const simulatedDragArtwork = useMemo(
    () => (
      <BoundedCanvasPreview>
        {/* Ordinary drops show added ink; protection drops retain their dynamic bus preview. */}
        {showSimulatedDragPreview &&
          previewGraph &&
          previewGraph.affectedPanelIds
            .flatMap((panelId) =>
              previewGraph.layout.panels
                .filter((p: BottomUpPanelLayout) => p.panel.id === panelId)
                .map((previewPanelLayout) => ({ panelId, previewPanelLayout }))
            )
            .map(({ panelId, previewPanelLayout }) => {
              const diagramId = getPanelDiagramId(previewPanelLayout)
              const previewPanelNode = previewGraph.layoutTree.panels.find(
                (p: LayoutNode) => p.diagramId === diagramId
              )
              const currentPanelNode = layoutTree?.panels.find(
                (p: LayoutNode) => p.diagramId === diagramId
              )
              const currentPanelLayout = layout?.panels.find(
                (candidate) => getPanelDiagramId(candidate) === diagramId
              )
              if (!previewPanelLayout || !previewPanelNode) return null

              const previewPanelTranslation = getPreviewPanelTranslation(
                currentPanelLayout,
                previewPanelLayout
              )

              const showStructuralPreview = usesStructuralDropPreview(artworkPreview?.symbolData?.id, artworkPreview?.dropTarget)
              const hasDynamicProtectionPreview =
                previewGraph.createdProtectionIds.length > 0 || !!artworkPreview?.movingProtection
              const previewProtectionIds = new Set([
                ...previewGraph.createdProtectionIds,
                ...(artworkPreview?.movingProtection ? [artworkPreview.movingProtection.protectionId] : []),
              ])
              const includeGroundStem = artworkPreview?.dropTarget?.type === 'groundWire' || (
                artworkPreview?.dropTarget?.type === 'mainBus' &&
                (artworkPreview.symbolData?.id === 'earthing' || artworkPreview.symbolData?.id === 'earthing_separator')
              )
              // Collect nodes for newly created symbols (endpoints, protections, trunk devices).
              const createdNodes: LayoutNode[] = []
              const collectCreated = (node: LayoutNode) => {
                if (
                  (node.type === 'endpoint' &&
                    node.domainId &&
                    previewGraph.createdEndpointIds.includes(node.domainId)) ||
                  ((node.type === 'mcb' || node.type === 'rcd') &&
                    node.domainId &&
                    (previewGraph.createdProtectionIds.includes(node.domainId) ||
                      artworkPreview?.movingProtection?.protectionId === node.domainId)) ||
                  (node.type === 'trunkDevice' &&
                    node.domainId &&
                    previewGraph.createdTrunkDeviceIds.includes(node.domainId))
                ) {
                  createdNodes.push(node)
                }
                if (node.children && node.children.length > 0) {
                  node.children.forEach(collectCreated)
                }
              }
              collectCreated(previewPanelNode)
              const dropTarget = artworkPreview?.dropTarget
              const expandingDomoticaParentNode: LayoutNode | null =
                dropTarget?.domoticaOutput?.expands && dropTarget.endpointId
                  ? (() => {
                      let found: LayoutNode | null = null
                      const visit = (node: LayoutNode) => {
                        if (found) return
                        if (node.type === 'endpoint' && node.domainId === dropTarget.endpointId) {
                          found = node
                          return
                        }
                        node.children?.forEach(visit)
                      }
                      visit(previewPanelNode)
                      return found
                    })()
                  : null

              // Preview nodes are taken from the same simulated layout graph that
              // will be used after commit, including domotica output branches.
              const previewNodes: LayoutNode[] = []
              const seenNodeIds = new Set<string>()
              if (
                expandingDomoticaParentNode &&
                !seenNodeIds.has((expandingDomoticaParentNode as LayoutNode).id)
              ) {
                seenNodeIds.add((expandingDomoticaParentNode as LayoutNode).id)
                previewNodes.push(expandingDomoticaParentNode)
              }
              for (const node of createdNodes) {
                if (!seenNodeIds.has(node.id)) {
                  seenNodeIds.add(node.id)
                  previewNodes.push(node)
                }
              }
              const previewStroke = '#0284c7'
              const previewSeparatorStroke = '#38bdf8'
              const dashPattern = DRAG_PREVIEW_DASH
              const previewSupplySeparators = showStructuralPreview
                ? getChangedSupplySeparatorsForDiagram(
                    previewGraph.wireSegments,
                    wireSegments,
                    diagramId
                  )
                : []
              if (artworkPreview?.movingPanelAttachment) {
                const panelPreviewTarget =
                  artworkPreview.dropTarget?.type === 'mainBus' && artworkPreview.dropTarget.panelId
                    ? {
                        type: 'mainBus' as const,
                        panelId: artworkPreview.dropTarget.panelId,
                      }
                    : artworkPreview.dropTarget?.type === 'circuit' &&
                        artworkPreview.dropTarget.panelId &&
                        artworkPreview.dropTarget.circuitId
                      ? {
                          type: 'circuit' as const,
                          panelId: artworkPreview.dropTarget.panelId,
                          circuitId: artworkPreview.dropTarget.circuitId,
                        }
                      : artworkPreview.dropTarget?.type === 'rcd' &&
                          artworkPreview.dropTarget.panelId &&
                          artworkPreview.dropTarget.protectionId
                        ? {
                            type: 'rcd' as const,
                            panelId: artworkPreview.dropTarget.panelId,
                            protectionId: artworkPreview.dropTarget.protectionId,
                          }
                        : null
                const geometry = panelPreviewTarget
                  ? resolvePanelAttachmentPreviewGeometry(
                      wireSegments,
                      panelPreviewTarget,
                      artworkPreview.position.x
                    )
                  : null

                // Never fall through to the generic changed-wire preview for a
                // panel move. A panel reflow can change almost every wire and
                // would render a second, ghost copy of the entire bus layout.
                if (!geometry || panelPreviewTarget?.panelId !== panelId) return null

                const { busSegment, busY, ghostX, symbolY } = geometry
                return (
                  <Group
                    key={`preview-panel-attachment-${diagramId}`}
                    name={`preview-panel-attachment-${panelId}`}
                    opacity={0.88}
                    listening={false}
                  >
                    <Line
                      points={[
                        busSegment.startPoint.x,
                        busSegment.startPoint.y,
                        busSegment.endPoint.x,
                        busSegment.endPoint.y,
                      ]}
                      stroke={previewStroke}
                      strokeWidth={DRAG_PREVIEW_HIGHLIGHT_WIDTH}
                      opacity={0.6}
                      lineCap="round"
                      listening={false}
                    />
                    <Line
                      points={[ghostX, busY, ghostX, symbolY + 14]}
                      stroke={previewStroke}
                      strokeWidth={DRAG_PREVIEW_WIRE_WIDTH}
                      dash={dashPattern}
                      lineCap="round"
                      listening={false}
                    />
                    <Rect
                      x={ghostX - 13}
                      y={symbolY}
                      width={26}
                      height={14}
                      stroke={previewStroke}
                      strokeWidth={2}
                      dash={dashPattern}
                      cornerRadius={3}
                      fill="rgba(59,130,246,0.12)"
                      listening={false}
                    />
                  </Group>
                )
              }

              const mainBusInsertIndex = dropTarget?.mainBusInsertIndex
              const isDomoticaOutputPreview =
                !!dropTarget?.domoticaOutput && !!dropTarget.endpointId && !!dropTarget.circuitId

              // Special-case: when inserting a protection on the main or
              // secondary bus, show a very explicit ghost (highlighted bus
              // segment + vertical line + box) at the resolved insertion slot.
              const isMainBusProtectionPreview =
                !showStructuralPreview && dropTarget?.type === 'mainBus' && previewGraph.createdProtectionIds.length > 0
              const isSecondaryBusProtectionPreview =
                isSecondaryBusPreviewTarget(dropTarget) && hasDynamicProtectionPreview && !showStructuralPreview

              const shouldUseMainBusInsertionGhost =
                isMainBusProtectionPreview &&
                typeof mainBusInsertIndex === 'number' &&
                typeof dropTarget.mainBusItemCount === 'number'
              const nestCircuitIdAtCursor = (() => {
                if (!layoutTree || !artworkPreview?.position) return undefined
                const matched = findDropTargetWithDebug(
                  layoutTree,
                  artworkPreview.position
                ).debug.path.find(
                  (step) => step.matched && step.nodeId?.startsWith('circuit-nest-')
                )
                const id = matched?.nodeId?.slice('circuit-nest-'.length)
                return id && id.length > 0 ? id : undefined
              })()

              const nestCircuitIdForPreview = resolveProtectionNestPreviewCircuitId(
                dropTarget,
                nestCircuitIdAtCursor
              )

              const isProtectionNestOnCircuitPreview =
                !!nestCircuitIdForPreview && previewGraph.createdProtectionIds.length > 0

              const nestedPreviewOffsetX = (() => {
                if (
                  dropTarget?.insertBeforeNestedCircuitId ||
                  !isProtectionNestOnCircuitPreview ||
                  !nestCircuitIdForPreview ||
                  isSecondaryBusProtectionPreview ||
                  !currentPanelNode
                ) {
                  return 0
                }

                const createdProtectionNode = previewNodes.find(
                  (node) =>
                    (node.type === 'mcb' || node.type === 'rcd') &&
                    !!node.domainId &&
                    previewGraph.createdProtectionIds.includes(node.domainId)
                )
                if (!createdProtectionNode) return 0

                const currentMatch: {
                  nest: LayoutNode | null
                  protection: LayoutNode | null
                } = { nest: null, protection: null }
                const visit = (node: LayoutNode) => {
                  if (node.id === `circuit-nest-${nestCircuitIdForPreview}`) {
                    currentMatch.nest = node
                  }
                  if (
                    (node.type === 'mcb' || node.type === 'rcd') &&
                    node.circuitIdForWires === nestCircuitIdForPreview
                  ) {
                    currentMatch.protection = node
                  }
                  node.children?.forEach(visit)
                }
                visit(currentPanelNode)
                if (currentMatch.protection) {
                  return currentMatch.protection.bounds.x - createdProtectionNode.bounds.x
                }
                if (!currentMatch.nest) return 0

                const currentNestBounds = getHitZoneBounds(currentMatch.nest, 'core')
                const currentAttachX = (currentNestBounds.left + currentNestBounds.right) / 2
                return currentAttachX - createdProtectionNode.bounds.x
              })()

              const circuitPreviewTranslation = !showStructuralPreview && !previewProtectionIds.size
                ? getPreviewCircuitTranslation(currentPanelNode, previewPanelNode, dropTarget?.circuitId)
                : { x: 0, y: 0 }
              const localPreviewTranslation = {
                x: nestedPreviewOffsetX + previewPanelTranslation.x + circuitPreviewTranslation.x,
                y: previewPanelTranslation.y + circuitPreviewTranslation.y,
              }
              const previewWiresForPanel = showStructuralPreview
                ? getChangedPreviewWireSegments(previewGraph.wireSegments, wireSegments, panelId, previewPanelNode, diagramId)
                : getAddedPreviewWireSegments(
                    previewGraph.wireSegments.filter((segment) => segment.panelId === panelId &&
                      (segment.diagramId ?? segment.panelId) === diagramId),
                    wireSegments,
                    new Set([...previewGraph.createdEndpointIds, ...previewGraph.createdTrunkDeviceIds, ...previewProtectionIds]),
                    {
                      translation: localPreviewTranslation,
                      includeGroundStem,
                      previewProtectionIds,
                    }
                  )

              if (
                previewWiresForPanel.length === 0 &&
                previewNodes.length === 0 &&
                previewSupplySeparators.length === 0
              ) {
                return null
              }

              if (isDomoticaOutputPreview) {
                const currentDomoticaWires = wireSegments
                  .filter(
                    (ws) =>
                      ws.panelId === panelId &&
                      ws.circuitId === dropTarget.circuitId &&
                      ws.type === 'branch' &&
                      ws.fromElementId === dropTarget.endpointId
                  )
                  .sort((a, b) => a.startPoint.y - b.startPoint.y)
                const bottomWire = currentDomoticaWires[currentDomoticaWires.length - 1]
                const targetWire =
                  currentDomoticaWires.find(
                    (ws) => ws.domoticaOutputIndex === dropTarget.domoticaOutput?.index
                  ) ?? currentDomoticaWires[dropTarget.domoticaOutput!.index]
                const allCurrentRowsOccupied =
                  currentDomoticaWires.length > 0 &&
                  currentDomoticaWires.every((ws) => !!ws.toElementId)
                const shouldRenderExpandPreview =
                  !!dropTarget.domoticaOutput?.expands ||
                  (allCurrentRowsOccupied &&
                    currentDomoticaWires.length < DOMOTICA_MAX_ENDPOINT_OUTPUTS &&
                    !!targetWire?.toElementId)
                if (!shouldRenderExpandPreview) {
                  // Non-expanding domotica output previews use the generic simulated graph.
                } else {
                  const anchorWire = dropTarget.domoticaOutput?.expands ? bottomWire : targetWire
                  if (!anchorWire) return null

                  const outputStartX = anchorWire.startPoint.x
                  const outputY = dropTarget.domoticaOutput?.expands
                    ? anchorWire.startPoint.y + DOMOTICA_OUTPUT_SPACING
                    : anchorWire.startPoint.y - DOMOTICA_OUTPUT_SPACING
                  const ghostX = outputStartX + DOMOTICA_BRANCH_LEAD
                  const ghostSize = SYMBOL_SIZE
                  const expandCueHeight = Math.max(12, DOMOTICA_OUTPUT_SPACING - 4)
                  const domoticaParentPreviewNode: LayoutNode | null = (() => {
                    let found: LayoutNode | null = null
                    const visit = (node: LayoutNode) => {
                      if (found) return
                      if (node.type === 'endpoint' && node.domainId === dropTarget.endpointId) {
                        found = node
                        return
                      }
                      node.children?.forEach(visit)
                    }
                    visit(previewPanelNode)
                    return found
                  })()

                  return (
                    <Group
                      key={`preview-panel-${diagramId}`}
                      name={`preview-panel-${panelId}`}
                      opacity={0.85}
                      listening={false}
                    >
                      {domoticaParentPreviewNode &&
                        (() => {
                          const { x, y, width, height } = (domoticaParentPreviewNode as LayoutNode)
                            .bounds
                          const inset = 2
                          const adjWidth = Math.max(0, width - inset * 2)
                          const adjHeight = Math.max(0, height - inset * 2)
                          return (
                            <Rect
                              key={`preview-node-${(domoticaParentPreviewNode as LayoutNode).id}`}
                              x={x - adjWidth / 2}
                              y={y - adjHeight / 2}
                              width={adjWidth}
                              height={adjHeight}
                              stroke={previewStroke}
                              strokeWidth={2}
                              dash={dashPattern}
                              cornerRadius={4}
                              fill="rgba(59,130,246,0.08)"
                              listening={false}
                            />
                          )
                        })()}
                      <Rect
                        x={outputStartX - 6}
                        y={outputY - expandCueHeight / 2}
                        width={12}
                        height={expandCueHeight}
                        stroke={previewStroke}
                        strokeWidth={2}
                        dash={dashPattern}
                        cornerRadius={6}
                        fill="rgba(59,130,246,0.16)"
                        listening={false}
                      />
                      <Circle
                        x={outputStartX}
                        y={outputY}
                        radius={4}
                        fill={previewStroke}
                        opacity={0.9}
                        listening={false}
                      />
                      <Line
                        points={[outputStartX, outputY, ghostX, outputY]}
                        stroke={previewStroke}
                        strokeWidth={DRAG_PREVIEW_WIRE_WIDTH}
                        dash={dashPattern}
                        lineCap="round"
                        lineJoin="round"
                        listening={false}
                      />
                      <Rect
                        x={ghostX - ghostSize / 2}
                        y={outputY - ghostSize / 2}
                        width={ghostSize}
                        height={ghostSize}
                        stroke={previewStroke}
                        strokeWidth={2}
                        dash={dashPattern}
                        cornerRadius={4}
                        fill="rgba(59,130,246,0.12)"
                        listening={false}
                      />
                    </Group>
                  )
                }
              }

              if (dropTarget && (
                (isMainBusProtectionPreview && !nestCircuitIdAtCursor) ||
                isSecondaryBusProtectionPreview
              )) {
                const createdProtectionNode = previewNodes.find(
                  (node) =>
                    (node.type === 'mcb' || node.type === 'rcd') &&
                    !!node.domainId &&
                    (previewGraph.createdProtectionIds.includes(node.domainId) ||
                      artworkPreview?.movingProtection?.protectionId === node.domainId)
                )
                const busSegments = getProtectionPreviewBusSegments(
                  previewGraph.wireSegments, dropTarget, diagramId
                )
                const realBusSegments = getProtectionPreviewBusSegments(wireSegments, dropTarget, diagramId)
                const segmentsForHighlight = realBusSegments.length > 0 ? realBusSegments : busSegments
                const artworkPreviewPosition = artworkPreview?.position
                // Hovering an existing protection body means "after this item";
                // keep that ghost clear of the symbol. Direct rail hovers follow X.
                const pointerOnSecondaryRail = isSecondaryBusProtectionPreview && artworkPreviewPosition &&
                  segmentsForHighlight[0] &&
                  Math.abs(artworkPreviewPosition.y - segmentsForHighlight[0].startPoint.y) <= 20
                const shouldUseInsertionGhost = shouldUseMainBusInsertionGhost || pointerOnSecondaryRail
                const targetX = shouldUseInsertionGhost
                  ? artworkPreviewPosition?.x
                  : createdProtectionNode?.bounds.x

                // For insertion ghost, use REAL layout's bus segments (matches the
                // segments the drop logic will hit-test against) so the highlighted
                // segment and ghost X align with what the user actually clicks on.
                // The simulated layout has an extra ghost item which shifts its
                // segments away from the cursor's true position.
                const hitSegment =
                  (targetX != null
                    ? segmentsForHighlight.find((ws) => {
                        const minX = Math.min(ws.startPoint.x, ws.endPoint.x)
                        const maxX = Math.max(ws.startPoint.x, ws.endPoint.x)
                        return targetX >= minX && targetX <= maxX
                      })
                    : undefined) ??
                  (targetX != null && segmentsForHighlight.length > 0
                    ? [...segmentsForHighlight].sort((a, b) => {
                        const aMid = (a.startPoint.x + a.endPoint.x) / 2
                        const bMid = (b.startPoint.x + b.endPoint.x) / 2
                        return Math.abs(aMid - targetX) - Math.abs(bMid - targetX)
                      })[0]
                    : undefined)

                const busY = hitSegment?.startPoint.y ?? previewPanelLayout.mainBus.y
                // Approximate the real MCB geometry: short vertical from bus to symbol,
                // and a nearly square symbol box.
                const verticalLen = 40
                const symbolHeight = 20
                const symbolWidth = 20
                const symbolCenterY = busY - verticalLen
                // Follow the pointer on either rail; the slot still determines
                // insertion order and the simulated graph stays cached within it.
                const ghostCenterX = shouldUseInsertionGhost
                  ? (targetX ??
                    (hitSegment ? (hitSegment.startPoint.x + hitSegment.endPoint.x) / 2 : 0))
                  : (createdProtectionNode?.bounds.x ?? targetX)

                if (ghostCenterX == null) {
                  return null
                }

                return (
                  <Group
                    key={`preview-panel-${diagramId}`}
                    name={`preview-panel-${panelId}`}
                    opacity={0.85}
                    listening={false}
                  >
                    {/* Show the live rail; extend only as far as the pointer's new connection. */}
                    {isSecondaryBusProtectionPreview &&
                      segmentsForHighlight.map((ws) => (
                        <Line
                          key={`preview-extended-secondary-bus-${ws.id}`}
                          name="eendraad-preview-secondary-bus"
                          points={[ws.startPoint.x, ws.startPoint.y, ws.endPoint.x, ws.endPoint.y]}
                          stroke={previewStroke}
                          strokeWidth={DRAG_PREVIEW_BUS_WIDTH}
                          opacity={0.6}
                          listening={false}
                        />
                      ))}
                    {isSecondaryBusProtectionPreview && segmentsForHighlight.length > 0 && (() => {
                      const left = Math.min(...segmentsForHighlight.flatMap((ws) => [ws.startPoint.x, ws.endPoint.x]))
                      const right = Math.max(...segmentsForHighlight.flatMap((ws) => [ws.startPoint.x, ws.endPoint.x]))
                      const edge = ghostCenterX < left ? left : ghostCenterX > right ? right : null
                      return edge == null ? null : <Line
                        name="eendraad-preview-secondary-bus"
                        points={[edge, busY, ghostCenterX, busY]}
                        stroke={previewStroke}
                        strokeWidth={DRAG_PREVIEW_BUS_WIDTH}
                        opacity={0.6}
                        listening={false}
                      />
                    })()}

                    {/* Highlight the busbar segment we're inserting on */}
                    {hitSegment && (
                      <Line
                        points={[
                          hitSegment.startPoint.x,
                          hitSegment.startPoint.y,
                          hitSegment.endPoint.x,
                          hitSegment.endPoint.y,
                        ]}
                        stroke={previewStroke}
                        strokeWidth={DRAG_PREVIEW_HIGHLIGHT_WIDTH}
                        opacity={0.6}
                        listening={false}
                      />
                    )}

                    {/* Vertical preview wire from bus to protection */}
                    <Line
                      points={[ghostCenterX, busY, ghostCenterX, symbolCenterY + symbolHeight]}
                      stroke={previewStroke}
                      strokeWidth={DRAG_PREVIEW_WIRE_WIDTH}
                      dash={dashPattern}
                      lineCap="round"
                      lineJoin="round"
                      listening={false}
                    />

                    {/* Vertical preview wire from protection to empty top */}
                    <Line
                      points={[ghostCenterX, symbolCenterY, ghostCenterX, symbolCenterY - 70]}
                      stroke={previewStroke}
                      strokeWidth={DRAG_PREVIEW_WIRE_WIDTH}
                      dash={dashPattern}
                      lineCap="round"
                      lineJoin="round"
                      listening={false}
                    />

                    {/* Protection ghost box, centered on symbolCenterY */}
                    <Rect
                      name={artworkPreview?.movingProtection
                        ? 'eendraad-preview-moved-protection' : 'eendraad-preview-created-protection'}
                      x={ghostCenterX - symbolWidth / 2}
                      y={symbolCenterY}
                      width={symbolWidth}
                      height={symbolWidth}
                      stroke={previewStroke}
                      strokeWidth={2}
                      dash={dashPattern}
                      cornerRadius={4}
                      fill="rgba(59,130,246,0.12)"
                      listening={false}
                    />
                  </Group>
                )
              }

              return (
                <Group
                  key={`preview-panel-${diagramId}`}
                  name={`preview-panel-${panelId}`}
                  x={localPreviewTranslation.x}
                  y={localPreviewTranslation.y}
                  opacity={0.8}
                  listening={false}
                >
                  {previewSupplySeparators.flatMap((separator) =>
                    separator.pieces.map((points, index) => (
                      <Line
                        key={`preview-${separator.id}-${index}`}
                        name="eendraad-preview-supply-separator"
                        points={points}
                        stroke={previewSeparatorStroke}
                        strokeWidth={4}
                        dash={[5, 5]}
                        opacity={0.95}
                        lineCap="round"
                        listening={false}
                      />
                    ))
                  )}

                  {previewWiresForPanel.map((ws) => {
                    const isThick = ws.type === 'trunk' || ws.type === 'mainBus'
                    return (
                      <Line
                        key={`preview-wire-${ws.id}`}
                        name="eendraad-preview-added-wire"
                        points={[ws.startPoint.x, ws.startPoint.y, ws.endPoint.x, ws.endPoint.y]}
                        stroke={previewStroke}
                        strokeWidth={isThick ? DRAG_PREVIEW_BUS_WIDTH : DRAG_PREVIEW_WIRE_WIDTH}
                        dash={dashPattern}
                        lineCap="round"
                        lineJoin="round"
                        listening={false}
                      />
                    )
                  })}

                  {previewNodes.map((node) => {
                    const { x, y, width, height } = node.bounds
                    const inset = 4
                    const adjWidth = Math.max(0, width - inset * 2)
                    const adjHeight = Math.max(0, height - inset * 2)
                    const rectX = x - adjWidth / 2
                    const rectY = y - adjHeight / 2

                    return (
                      <InsertionPreviewChunk
                        key={`preview-node-${node.id}`}
                        name={
                          node.domainId && previewGraph.createdProtectionIds.includes(node.domainId)
                            ? 'eendraad-preview-created-protection'
                            : artworkPreview?.movingProtection?.protectionId === node.domainId
                              ? 'eendraad-preview-moved-protection'
                              : 'eendraad-preview-created-symbol'
                        }
                        x={rectX}
                        y={rectY}
                        width={adjWidth}
                        height={adjHeight}
                      />
                    )
                  })}
                </Group>
              )
            })}
      </BoundedCanvasPreview>
    ),
    [
      artworkPreview,
      internalDragPlacement,
      layout,
      layoutTree,
      previewGraph,
      showSimulatedDragPreview,
      wireSegments,
    ]
  )

  // Keep pointer-driven decorations off the dense diagram's scene canvas.
  // Both layers use the same camera; these shapes never participate in hit testing.
  const canvasDragArtwork = useMemo(
    () => (
      <Group name="canvas-drag-artwork" listening={false}>
        {simulatedDragArtwork}
        {artworkPreview?.sameSymbolAddMore && <SameSymbolAddMorePreview
          target={artworkPreview.sameSymbolAddMore}
          increment={artworkPreview.movingEndpointSelection
            ? Math.max(1, getEndpointById(artworkPreview.movingEndpointSelection.draggedEndpointId)?.placements.length ?? 1) : 1}
          zoom={canvasRef.current?.getLiveViewTransform().zoom ?? eendraadView.zoom} />}
        {layout && artworkPreview?.branchIntent && <BranchInsertionPreview
          layout={layout} intent={artworkPreview.branchIntent} />}
        {branchDropTargets && <BranchDropHints targets={branchDropTargets}
          activeId={artworkPreview?.branchIntent?.id ?? null}
          zoom={canvasRef.current?.getLiveViewTransform().zoom ?? eendraadView.zoom} />}

        {/* Drop-zone hints: legal targets while dragging from the library */}
        {canPlaceSymbols && activePlacementSymbol && !dragPreview?.trunkBranchSlot && (
          <DropZoneHintsOverlay
            layoutTree={layoutTree}
            project={currentProject}
            symbol={artworkPreview?.symbolData ?? activePlacementSymbol}
            activeDropTarget={artworkPreview?.dropTarget ?? null}
            activeDropTargetNodeId={activeDropTargetNodeId}
            activeSameSymbolTargetNodeId={artworkPreview?.sameSymbolAddMore?.nodeId ?? null}
            activePosition={artworkPreview?.position ?? null}
            relocation={internalDragPlacement}
            branchEndpointNodeIds={branchDropTargets?.endpointNodeIds}
            branchCircuitIds={branchDropTargets?.circuitIds}
            movingPanelAttachmentId={
              internalDragPlacement?.elementId ?? dragPreview?.movingPanelAttachment?.panelId
            }
          />
        )}

        {canPlaceSymbols && liveProtectionBusPreview && (
          <BoundedCanvasPreview>
            <LiveProtectionBusPreview geometry={liveProtectionBusPreview} />
          </BoundedCanvasPreview>
        )}

        {/* Legacy drag preview fallback when simulated preview graph is unavailable. */}
        {canPlaceSymbols && showLegacyDragPreview && dragPreview && (
          <BoundedCanvasPreview>
            <DragPreview
              position={dragPreview.position}
              dropTarget={dragPreview.dropTarget}
              layout={layout}
              wireSegments={wireSegments}
              symbolData={dragPreview.symbolData}
              showMainBusPositionMarker={!dragPreview.movingProtection}
            />
          </BoundedCanvasPreview>
        )}

        {/* Pointer-follow icon (Alt-duplicate); library drag uses HTML5 setDragImage instead. */}
        {canPlaceSymbols &&
          altDuplicatePointerDragActive &&
          dragPreview?.symbolData &&
          dragPreview.position.x !== -Infinity && (
            <BoundedCanvasPreview>
              <DragCursorSymbol
                position={dragPreview.position}
                symbolData={dragPreview.symbolData}
              />
            </BoundedCanvasPreview>
          )}
        {import.meta.env.DEV && (
          <HitZoneDebugOverlay layoutTree={layoutTree} dragPreview={dragPreview} />
        )}
      </Group>
    ),
    [
      activeDropTargetNodeId,
      activePlacementSymbol,
      branchDropTargets,
      eendraadView.zoom,
      altDuplicatePointerDragActive,
      artworkPreview,
      canPlaceSymbols,
      currentProject,
      dragPreview,
      internalDragPlacement,
      layout,
      layoutTree,
      showLegacyDragPreview,
      liveProtectionBusPreview,
      simulatedDragArtwork,
      wireSegments,
    ]
  )

  const canvasInteractionOverlay = useMemo(
    () => (
      <>
        {canvasDragArtwork}
        {changeoverGridSourcePreviewScene && (
          <BoundedCanvasPreview>
            <ChangeoverGridSourcePreviewArtwork scene={changeoverGridSourcePreviewScene} />
          </BoundedCanvasPreview>
        )}
        {selectedEndpointOverlay}
        {dragPreview?.trunkBranchSlot && (
          <BoundedCanvasPreview>
            <TrunkBranchSlotPreview
              slot={dragPreview.trunkBranchSlot}
              markerRef={trunkBranchSlotMarkerRef}
            />
          </BoundedCanvasPreview>
        )}
      </>
    ),
    [canvasDragArtwork, changeoverGridSourcePreviewScene, dragPreview, selectedEndpointOverlay]
  )

  return (
    <EendraadWireSegmentsContext.Provider value={wireSegments}>
    <CanvasOverlayScaleProvider containerRef={containerRef}>
      <div
        ref={containerRef}
        className="relative w-full h-full"
        data-1p-ignore
        data-op-ignore
        onPointerEnter={() => {
          pointerOverEendraadRef.current = true
        }}
        onPointerLeave={() => {
          pointerOverEendraadRef.current = false
        }}
      >
        {separatorTooltip && containerRef.current && (
          <div
            className="pointer-events-none absolute z-50"
            style={{
              left: separatorTooltip.clientX - containerRef.current.getBoundingClientRect().left,
              top: separatorTooltip.clientY - containerRef.current.getBoundingClientRect().top,
              transform: 'translate(12px, 12px)',
            }}
          >
            <div className="max-w-[240px] whitespace-pre-wrap rounded bg-black/85 px-2 py-1 text-xs text-white shadow-lg">
              {separatorTooltip.text}
            </div>
          </div>
        )}
        {canPlaceSymbols && addElementDropPosition && (
          <AddElementPicker
            dropPosition={addElementDropPosition}
            onSelect={handleAddElementSelect}
            onClose={() => setAddElementDropPosition(null)}
            canPlaceSymbol={canPlaceAddElementSymbol}
          />
        )}
        <BaseCanvas
          ref={canvasRef}
          gestureZoomCanvas="eendraad"
          minZoom={minZoom}
          zoom={eendraadView.zoom}
          pan={eendraadView.pan}
          showGrid={false}
          gridSize={eendraadView.gridSize}
          onZoomChange={handleZoomChange}
          onPanChange={handlePanChange}
          onViewTransformCommit={handleViewTransformCommit}
          onViewportPanStateChange={handleViewportPanStateChange}
          onViewportPixelSizeChange={setViewportPixelSize}
          onDrop={canPlaceSymbols ? handleDrop : undefined}
          /* @vision-scan-strip-start */
          onDocumentDrop={
            isElectricalVisionScanEnabled() && canEditProject
              ? (position, documentId) => {
                  placeDocumentOnOneWire(documentId, position)
                }
              : undefined
          }
          /* @vision-scan-strip-end */
          onDragOver={canPlaceSymbols ? handleDragOver : undefined}
          onFindElementsInRectangle={handleFindElementsInRectangle}
          onGetContextMenuItems={
            canDeleteItems || canPlaceSymbols || eendraadDateMarkingMode
              ? handleEendraadContextMenu
              : undefined
          }
          onGetSelectionBounds={handleGetSelectionBounds}
          selectionFitMaxZoom={ZOOM_100}
          onMultiFingerSwipe={onMultiFingerSwipe}
          
          gridOpacity={0.1}
          overlayChildren={canvasInteractionOverlay}
          enableIsolatedDragLayer
        >
          <Group name="canvas-content">
            {/* @vision-scan-strip-start */}
            {isElectricalVisionScanEnabled() && (
              <OneWireReferencePages layout={layout} canDrag={canEditProject && canDragItems} />
            )}
            {/* @vision-scan-strip-end */}
            <ConverterResizeViewportContext.Provider value={resizeConverterWithViewportAnchor}>
              <MetadataCalloutDragContext.Provider value={canEditProject && canDragItems}>
                <CanvasPanOrClickProvider onBeginPan={beginInteractiveOverlayPan}>
                  {normalScene}
                </CanvasPanOrClickProvider>
              </MetadataCalloutDragContext.Provider>
            </ConverterResizeViewportContext.Provider>

            {currentProject ? (
              <InstallDateOverlay
                project={currentProject}
                layout={layout}
                wireSegments={wireSegments}
                visible={installDatesVisible}
                monochrome={eendraadDateMarkingVisibility.installDatesMonochrome}
                selectionEnabled={eendraadDateMarkingMode}
                onSelectFrame={(frame) => {
                  if (suppressDateFrameSelectionRef.current) return
                  const selectableTargets = frame.targets.filter(
                    (target) => target.type !== 'panel'
                  )
                  const selectionTargets =
                    selectableTargets.length > 0 ? selectableTargets : frame.targets
                  const firstTarget = selectionTargets[0]
                  if (!firstTarget) return
                  setClosedDateToolSelectionKey(null)
                  setSelection({
                    type: firstTarget.type,
                    ids: selectionTargets.map((target) => target.id),
                  })
                  setDateToolFrameSelection({
                    year: frame.year,
                    bounds: frame.bounds,
                    selectionKey: selectionTargets.map((target) => target.id).join('|'),
                  })
                }}
              />
            ) : null}

            {/* Debug: hit zone overlay (dev builds only, when enabled in settings) */}
            {import.meta.env.DEV && (
              <>
                <TrunkLayoutDebugOverlay layout={layout} wireSegments={wireSegments} />
              </>
            )}
            {}
          </Group>
        </BaseCanvas>

        {pendingDragPreview?.movingProtection && (
          <svg
            data-protection-drag-cursor
            aria-hidden="true"
            className="absolute pointer-events-none"
            viewBox="0 0 34 34"
            style={{
              left: 0,
              top: 0,
              width: 34 * eendraadView.zoom,
              height: 34 * eendraadView.zoom,
              transform: `translate3d(${eendraadView.pan.x + (pendingDragPreview.position.x - 17) * eendraadView.zoom}px, ${eendraadView.pan.y + (pendingDragPreview.position.y - 17) * eendraadView.zoom}px, 0)`,
            }}
          >
            <circle
              cx="17"
              cy="17"
              r="15"
              fill="#0284c7"
              stroke="#0284c7"
              strokeWidth="2"
              opacity="0.25"
            />
          </svg>
        )}

        {offscreenSupplyPreviewDirection ? (
          <OffscreenPreviewIndicator direction={offscreenSupplyPreviewDirection} />
        ) : null}

        <ViewNavigationToolbar
          zoom={eendraadView.zoom}
          minZoom={minZoom}
          onZoomChange={handleZoomChange}
          onPanChange={handlePanChange}
          onFitToView={handleFitToView}
          canvasType="eendraad"
        />

        <CanvasFloatingControlRail
          side="left"
          verticalAlign="center"
          offsetPx={12}
          zIndex={30}
          dataCanvasOverlayAnchor="left"
          dataCanvasOverlayPosition="center-left"
        >
          {canUseInstallDates ? (
            <FloatingControl
              icon={<CalendarDays className="h-5 w-5" />}
              label={t('installDates.tool', 'Install date')}
              tooltipDescription={t(
                'installDates.toolDescription',
                'Mark selected one-wire items by year'
              )}
              variant="tool"
              side="left"
              active={eendraadDateMarkingMode}
              onClick={() => setEendraadDateMarkingMode(!eendraadDateMarkingMode)}
            />
          ) : null}
        </CanvasFloatingControlRail>

        {dateToolHelperStyle ? (
          <div
            className="absolute z-40 rounded-md border border-gray-200 bg-white p-3 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800"
            style={dateToolHelperStyle}
          >
            <label className="mb-1 block font-medium text-gray-700 dark:text-gray-200">
              {t('installDates.installDate', 'Install date')}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <label
                className="relative block h-8 w-8 shrink-0 cursor-pointer rounded border border-gray-300 shadow-sm dark:border-gray-600"
                style={{ backgroundColor: dateToolStoredColor }}
                title={t('installDates.color', 'Install date color')}
              >
                <input
                  type="color"
                  value={dateToolStoredColor}
                  onChange={(e) => updateInstallDateColor(dateToolDraftYear, e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  aria-label={t('installDates.color', 'Install date color')}
                />
              </label>
              <button
                type="button"
                onClick={() => setDateToolCalendarOpen((open) => !open)}
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  dateToolCalendarOpen
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-200'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600'
                }`}
                title={t('installDates.chooseExactDate', 'Choose exact date')}
                aria-label={t('installDates.chooseExactDate', 'Choose exact date')}
                aria-expanded={dateToolCalendarOpen}
              >
                <CalendarDays className="h-4 w-4" aria-hidden />
              </button>
              <input
                ref={dateToolInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={dateToolYear}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
                  const parsed = digits.length === 4 ? Number.parseInt(digits, 10) : null
                  if (parsed != null && parsed > currentInstallYear) {
                    setDateToolYear(String(currentInstallYear))
                  } else {
                    setDateToolYear(digits)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitDateToolDraft()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setDateToolYear(String(selectedDateToolYear))
                    setClosedDateToolSelectionKey(dateToolSelectionKey)
                  }
                }}
                onBlur={() => {
                  if (dateToolYear === '') return
                  const parsed = normalizeInstallYear(dateToolYear)
                  const clamped =
                    parsed == null ? selectedDateToolYear : clamp(parsed, 1900, currentInstallYear)
                  setDateToolYear(String(clamped))
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.preventDefault()
                  const input = e.currentTarget
                  const pointerId = e.pointerId
                  const startY = e.clientY
                  const startYear = Math.max(
                    1900,
                    Math.min(
                      currentInstallYear,
                      normalizeInstallYear(dateToolYear) ?? selectedDateToolYear
                    )
                  )
                  let didDrag = false
                  input.setPointerCapture(pointerId)
                  const handleMove = (moveEvent: PointerEvent) => {
                    if (moveEvent.pointerId !== pointerId) return
                    if (Math.abs(startY - moveEvent.clientY) < 4) return
                    didDrag = true
                    moveEvent.preventDefault()
                    const delta = Math.trunc((startY - moveEvent.clientY) / 8)
                    if (delta === 0) return
                    const nextYear = clamp(startYear + delta, 1900, currentInstallYear)
                    setDateToolYear(String(nextYear))
                  }
                  const finishPointer = (pointerEvent: PointerEvent) => {
                    if (pointerEvent.pointerId !== pointerId) return
                    input.removeEventListener('pointermove', handleMove)
                    input.removeEventListener('pointerup', finishPointer)
                    input.removeEventListener('pointercancel', finishPointer)
                    if (input.hasPointerCapture(pointerId)) input.releasePointerCapture(pointerId)
                    if (!didDrag) {
                      input.focus({ preventScroll: true })
                      input.select()
                    }
                  }
                  input.addEventListener('pointermove', handleMove)
                  input.addEventListener('pointerup', finishPointer)
                  input.addEventListener('pointercancel', finishPointer)
                }}
                onDragStart={(e) => e.preventDefault()}
                placeholder={String(
                  currentProject?.project.yearOfConstruction ?? new Date().getFullYear()
                )}
                className="min-w-[4rem] flex-1 touch-none cursor-ns-resize rounded-md border border-gray-300 bg-white px-2 py-1.5 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
              <button
                type="button"
                onClick={commitDateToolDraft}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                title={t('common.confirm', 'Confirm')}
                aria-label={t('common.confirm', 'Confirm')}
              >
                <CornerDownLeft className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={clearSelectedInstallDates}
                disabled={!dateToolHasExplicitDate}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-300 bg-red-50 text-red-600 shadow-sm hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-300 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70 dark:disabled:border-gray-700 dark:disabled:bg-gray-800 dark:disabled:text-gray-600"
                title={t('installDates.clearExplicitDate', 'Clear explicit date')}
                aria-label={t('installDates.clearExplicitDate', 'Clear explicit date')}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
            {dateToolCalendarOpen ? (
              <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
                <div
                  className="mb-2 grid grid-cols-6 gap-1"
                  aria-label={t('installDates.month', 'Month')}
                >
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                    <button
                      key={month}
                      type="button"
                      onClick={() => {
                        setDateToolMonth(month)
                        const maxDay = new Date(Date.UTC(dateToolDraftYear, month, 0)).getUTCDate()
                        setDateToolDay((day) => Math.min(day, maxDay))
                      }}
                      className={`h-7 rounded text-[11px] tabular-nums transition-colors ${
                        dateToolMonth === month
                          ? 'bg-blue-600 font-semibold text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
                      }`}
                      aria-pressed={dateToolMonth === month}
                    >
                      {dateToolMonthLabels[month - 1]}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1" aria-label={t('installDates.day', 'Day')}>
                  {Array.from({ length: dateToolDaysInMonth }, (_, index) => index + 1).map(
                    (day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => setDateToolDay(day)}
                        className={`h-7 rounded text-[11px] tabular-nums transition-colors ${
                          dateToolSafeDay === day
                            ? 'bg-blue-600 font-semibold text-white'
                            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'
                        }`}
                        aria-pressed={dateToolSafeDay === day}
                      >
                        {day}
                      </button>
                    )
                  )}
                </div>
                <div className="mt-2 text-center text-xs font-medium tabular-nums text-gray-600 dark:text-gray-300">
                  {dateToolDraftDate}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <CanvasFloatingControlRail
          side="right"
          verticalAlign="top"
          offsetPx={12}
          topOffsetPx={12}
          zIndex={30}
          menuOpen={openEendraadMenu !== null}
          dataCanvasOverlayAnchor="right"
          dataCanvasOverlayPosition="top-right"
        >
          {canEditProject ? (
            <FloatingControl
              icon={
                <span className="flex items-baseline justify-center gap-px font-bold text-[13px] leading-none tracking-tight text-gray-700 dark:text-gray-200 tabular-nums">
                  <span>A</span>
                  <span className="text-[11px] opacity-80">B</span>
                </span>
              }
              label={t('canvas.eendraadNaming.menuTitle')}
              triggerTestId="eendraad-naming-menu"
              variant="menu"
              side="right"
              open={openEendraadMenu === 'naming'}
              onOpenChange={(next) => setOpenEendraadMenu(next ? 'naming' : null)}
            >
              <div className="rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg p-3 min-w-[260px] space-y-3 text-xs">
                <div
                  data-testid="eendraad-auto-label-setting"
                  className={`flex items-center gap-2 rounded-md p-1 text-gray-700 transition-all duration-1000 dark:text-gray-200 ${
                    namingGuidanceHighlighted
                      ? 'bg-sky-100 ring-2 ring-sky-500 dark:bg-sky-950/60'
                      : 'ring-2 ring-transparent'
                  }`}
                >
                  <label className="flex min-w-0 flex-1 items-start gap-2">
                    <input
                      type="checkbox"
                      checked={eendraadAutoNaming}
                      onChange={(e) => handleEendraadAutomaticNamingChange(e.target.checked)}
                      className="mt-0.5 shrink-0 rounded border-gray-400"
                    />
                    <span>
                      <span className="font-medium block">
                        {t('canvas.eendraadNaming.automaticNaming')}
                      </span>
                      <span className="block text-[11px] leading-snug text-gray-500 dark:text-gray-400 mt-0.5">
                        {t('canvas.eendraadNaming.automaticNamingDescription')}
                      </span>
                    </span>
                  </label>
                  <span
                    className="shrink-0"
                    title={t(
                      'canvas.eendraadNaming.resetAllTooltip',
                      'Remove every custom label and return all circuits to automatic naming.'
                    )}
                  >
                    <button
                      type="button"
                      aria-label={t('canvas.eendraadNaming.resetAllLabels', 'Reset all labels')}
                      disabled={!eendraadAutoNaming || !hasCustomEendraadLabels}
                      onClick={handleResetAllEendraadLabels}
                      className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </span>
                </div>
                <div className="space-y-1.5 text-gray-700 dark:text-gray-200">
                  <label htmlFor="eendraad-label-style" className="block font-medium">
                    {t('canvas.eendraadNaming.scheme.style', 'Style')}
                  </label>
                  <LabelStyleSelect
                    id="eendraad-label-style"
                    scheme={eendraadLabelScheme}
                    savedStyles={savedLabelStyles}
                    panelPartAvailable={advancedPanelLabels}
                    onChange={(scheme) =>
                      applyLabelScheme(
                        scheme,
                        advancedPanelLabels && labelSchemeUsesPanelPart(scheme) ? true : undefined
                      )
                    }
                  />
                  <button
                    type="button"
                    data-testid="eendraad-label-scheme-customize"
                    onClick={() => {
                      setOpenEendraadMenu(null)
                      openLabelSchemeDialog(t)
                    }}
                    className="text-[11px] font-medium text-sky-600 hover:underline dark:text-sky-400"
                  >
                    {t('canvas.eendraadNaming.scheme.customize', 'Customize…')}
                  </button>
                </div>
                <label
                  className={`flex items-start gap-2 ${
                    eendraadAutoNaming
                      ? 'text-gray-700 dark:text-gray-200'
                      : 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={eendraadHideFeederLetters}
                    disabled={!eendraadAutoNaming}
                    onChange={(e) => handleEendraadHideFeederLettersChange(e.target.checked)}
                    className="rounded border-gray-400 mt-0.5 disabled:opacity-50"
                  />
                  <span>
                    <span className="font-medium block">
                      {t('canvas.eendraadNaming.hideFeederLetters')}
                    </span>
                    <span className="block text-[11px] leading-snug text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('canvas.eendraadNaming.hideFeederLettersDescription')}
                    </span>
                  </span>
                </label>
                {canUseInstallDates ? (
                  <>
                    <div className="flex items-center gap-2 border-t border-gray-200 pt-3 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                      <span>{t('installDates.menuSection', 'Dates')}</span>
                    </div>
                    <label className="flex items-start gap-2 text-gray-700 dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={eendraadDateMarkingVisibility.installDatesVisible}
                        onChange={(e) =>
                          setEendraadDateMarkingVisibility({
                            installDatesVisible: e.target.checked,
                          })
                        }
                        className="rounded border-gray-400 mt-0.5"
                      />
                      <span>
                        <span className="font-medium block">
                          {t('installDates.showLabelsOutsideMode', 'Date labels')}
                        </span>
                        <span className="block text-[11px] leading-snug text-gray-500 dark:text-gray-400 mt-0.5">
                          {t(
                            'installDates.showLabelsOutsideModeDescription',
                            'Show outside date mode.'
                          )}
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-gray-700 dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={eendraadDateMarkingVisibility.installDatesMonochrome}
                        onChange={(e) =>
                          setEendraadDateMarkingVisibility({
                            installDatesMonochrome: e.target.checked,
                          })
                        }
                        className="rounded border-gray-400 mt-0.5"
                      />
                      <span>
                        <span className="font-medium block">
                          {t('installDates.forceMonochrome', 'Monochrome')}
                        </span>
                        <span className="block text-[11px] leading-snug text-gray-500 dark:text-gray-400 mt-0.5">
                          {t('installDates.forceMonochromeDescription', 'Use one neutral color.')}
                        </span>
                      </span>
                    </label>
                  </>
                ) : null}
              </div>
            </FloatingControl>
          ) : null}
        </CanvasFloatingControlRail>
      </div>
    </CanvasOverlayScaleProvider>
    </EendraadWireSegmentsContext.Provider>
  )
}

interface SupplySeparatorGeometry {
  id: string
  diagramId: string
  /** Dashed pieces; a label that cannot be avoided splits the dash in two. */
  pieces: Array<[number, number, number, number]>
  center: { x: number; y: number }
  horizontal: boolean
  transition?: { from: string; to: string }
}

function getSupplySeparatorsForDiagram(
  wireSegments: WireSegment[],
  diagramId: string
): SupplySeparatorGeometry[] {
  const diagramSegments = wireSegments.filter((segment) => segment.diagramId === diagramId)
  const enclosureBoundaries = diagramSegments.filter(
    (segment) => segment.supplyEnclosureBoundary === true || segment.enclosureTransition != null
  )
  const separators: SupplySeparatorGeometry[] = enclosureBoundaries.map((segment) => {
    const geometry = getEnclosureSeparatorGeometry(segment)
    return {
      id: `supply-enclosure-separator-${diagramId}-${segment.id}`,
      diagramId,
      pieces: geometry.pieces,
      center: geometry.center,
      horizontal: geometry.horizontal,
      ...(segment.enclosureTransition ? { transition: segment.enclosureTransition } : {}),
    }
  })
  if (enclosureBoundaries.some((segment) => segment.supplyEnclosureBoundary === true))
    return separators

  const crossing = diagramSegments.find(
    (segment) =>
      segment.isSupplyTrunk === true &&
      segment.supplyWireRole === 'crossing' &&
      segment.supplySeparatorX != null
  )
  if (!crossing || crossing.supplySeparatorX == null) return separators

  const legacySeparator: SupplySeparatorGeometry = {
    id: `supply-separator-${diagramId}`,
    diagramId,
    pieces: [
      [
        crossing.supplySeparatorX,
        crossing.startPoint.y - 16,
        crossing.supplySeparatorX,
        crossing.startPoint.y + 16,
      ],
    ],
    center: { x: crossing.supplySeparatorX, y: crossing.startPoint.y },
    horizontal: true,
  }
  return [...separators, legacySeparator]
}

function separatorPointsEqual(left: SupplySeparatorGeometry, right: SupplySeparatorGeometry) {
  const a = left.pieces.flat()
  const b = right.pieces.flat()
  return a.length === b.length && a.every((value, index) => Math.abs(value - b[index]!) < 0.001)
}

function getChangedSupplySeparatorsForDiagram(
  previewWireSegments: WireSegment[],
  currentWireSegments: WireSegment[],
  diagramId: string
): SupplySeparatorGeometry[] {
  const currentById = new Map(
    getSupplySeparatorsForDiagram(currentWireSegments, diagramId).map((separator) => [
      separator.id,
      separator,
    ])
  )
  return getSupplySeparatorsForDiagram(previewWireSegments, diagramId).filter((preview) => {
    // Simulating an unrelated drop can rebuild an enclosure boundary with a new wire id.
    // Stable geometry means there is no separator change to preview.
    const current =
      currentById.get(preview.id) ??
      [...currentById.values()].find((candidate) => separatorPointsEqual(preview, candidate))
    return !current || !separatorPointsEqual(preview, current)
  })
}

const EendraadCanvas = memo(
  EendraadCanvasInner,
  (prev: Readonly<EendraadCanvasProps>, next: Readonly<EendraadCanvasProps>) => {
    return (
      prev.onMultiFingerSwipe === next.onMultiFingerSwipe && prev.capabilities === next.capabilities
    )
  }
)

export default EendraadCanvas
