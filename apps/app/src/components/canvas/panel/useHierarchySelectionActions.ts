import { getModuleSelectionBounds } from './hierarchyPanelSceneQueries'

import type { Project, HierarchySurface } from './hierarchyPanelCanvasModel'

import { editPanelLayout } from '@/handlers/panel/editPanelLayout'

import {
  useRef,
  useCallback,
  useEffect,
  type MutableRefObject,
  type RefObject,
} from 'react'
import type { useTranslation } from 'react-i18next'

import type Konva from 'konva'
import type { BaseCanvasHandle } from '../BaseCanvas'

import type { useUIStore } from '@/stores/uiStore'

import { useProjectStore } from '@/stores/projectStore'
import type { useDialogStore } from '@/stores/dialogStore'

import type { ModulePlacement } from '@/lib/panel/panelGridLayout'

import { addToSelection } from '@/utils/selection'

import type { Panel } from '@/types/schema'

import type { Selection as CanvasSelection } from '@/types/ui'

import { rectContainsRect } from '@/lib/geometry'

import type { BuiltPanelScene } from '@/lib/panel/panelScene'

interface HierarchySelectionActionsOptions {
  canvasRef: RefObject<BaseCanvasHandle | null>
  currentProject: Project | null
  feedSideDirection: 'left' | 'right'
  hierarchyPanelsFromSelection: Panel[]
  leftDragPansCanvas: boolean
  openDialog: ReturnType<typeof useDialogStore.getState>['openDialog']
  panelDepthById: Map<string, number>
  prioritizeOverviewNavigation: boolean
  scene: BuiltPanelScene | null
  selectedAuxiliaryEnclosureIds: string[]
  selectedPanelIds: string[]
  selectedPanels: Panel[]
  selection: CanvasSelection
  setSelection: ReturnType<typeof useUIStore.getState>['setSelection']
  t: ReturnType<typeof useTranslation>['t']
}

const PANEL_FRAME_DRAG_THRESHOLD = 6

function beginDeferredPanelFrameSelectionRect(options: {
  event: Konva.KonvaEventObject<MouseEvent>
  canvasRef: RefObject<BaseCanvasHandle | null>
  leftDragPansCanvas: boolean
  pointerDownRef: MutableRefObject<{ x: number; y: number } | null>
  pendingCleanupRef: MutableRefObject<(() => void) | null>
}): void {
  const window = options.event.evt.view ?? globalThis.window
  const { event, canvasRef, leftDragPansCanvas, pointerDownRef, pendingCleanupRef } = options

  if (event.evt.button !== 0) return

  const pointer = event.target.getStage()?.getPointerPosition()
  if (!pointer) return

  pointerDownRef.current = {
    x: event.evt.clientX,
    y: event.evt.clientY,
  }

  if (pendingCleanupRef.current) {
    pendingCleanupRef.current()
    pendingCleanupRef.current = null
  }

  const clientX = event.evt.clientX
  const clientY = event.evt.clientY

  const cleanup = () => {
    window.removeEventListener('mousemove', handleWindowMouseMove, true)
    window.removeEventListener('mouseup', handleWindowMouseUp, true)
    if (pendingCleanupRef.current === cleanup) {
      pendingCleanupRef.current = null
    }
  }

  const handleWindowMouseMove = (evt: MouseEvent) => {
    if (!pendingCleanupRef.current) return
    const dx = evt.clientX - clientX
    const dy = evt.clientY - clientY
    if (Math.hypot(dx, dy) <= PANEL_FRAME_DRAG_THRESHOLD) return
    if (leftDragPansCanvas && !event.evt.shiftKey) {
      canvasRef.current?.startMousePan(clientX, clientY)
    } else {
      canvasRef.current?.startSelectionRect(pointer)
    }
    cleanup()
  }

  const handleWindowMouseUp = () => {
    cleanup()
  }

  pendingCleanupRef.current = cleanup
  window.addEventListener('mousemove', handleWindowMouseMove, true)
  window.addEventListener('mouseup', handleWindowMouseUp, true)

  event.cancelBubble = true
}

type ModuleScopeKey = string
export function useHierarchySelectionActions({
  canvasRef,
  currentProject,
  feedSideDirection,
  hierarchyPanelsFromSelection,
  leftDragPansCanvas,
  openDialog,
  panelDepthById,
  prioritizeOverviewNavigation,
  scene,
  selectedAuxiliaryEnclosureIds,
  selectedPanelIds,
  selectedPanels,
  selection,
  setSelection,
  t,
}: HierarchySelectionActionsOptions) {
  const handleHierarchyAutoArrange = useCallback(() => {
    if (!currentProject || !scene) return

    const targetPanels =
      selectedPanels.length > 0
        ? selectedPanels
        : hierarchyPanelsFromSelection.length > 0
          ? hierarchyPanelsFromSelection
          : scene.surfaces
              .filter(
                (surface): surface is HierarchySurface & { panel: Panel } =>
                  surface.kind === 'panel' && surface.panel != null
              )
              .map((surface) => surface.panel)

    if (targetPanels.length === 0) return

    openDialog({
      type: 'confirm',
      title: t('panelCanvas.autoArrange'),
      message:
        targetPanels.length === 1
          ? t(
              'panelCanvas.autoArrangeConfirm',
              'This will fully replace the current panel layout (main and supply). Continue?'
            )
          : t(
              'panelCanvas.autoArrangeVisibleConfirm',
              'This will fully replace the current layout of the visible panels. Continue?'
            ),
      variant: 'warning',
      confirmLabel: t('common.confirm', 'Confirm'),
      cancelLabel: t('common.cancel', 'Cancel'),
      onConfirm: () => {
        editPanelLayout({
          autoArrange: { panelIds: targetPanels.map((target) => target.id), feedSideDirection },
        })
      },
    })
  }, [
    currentProject,
    feedSideDirection,
    hierarchyPanelsFromSelection,
    openDialog,
    scene,
    selectedPanels,
    t,
  ])

  const handleHierarchyPanelSelect = useCallback(
    (
      panelId: string,
      event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } | undefined
    ) => {
      const additive = !!event?.shiftKey || !!event?.ctrlKey || !!event?.metaKey
      if (!additive || selection.type !== 'panel') {
        setSelection({ type: 'panel', ids: [panelId] })
        return
      }
      if (selection.ids.includes(panelId)) return
      setSelection(addToSelection(selection, panelId))
    },
    [selection, setSelection]
  )

  const panelFramePointerDownRef = useRef<{ x: number; y: number } | null>(null)
  const pendingPanelFrameSelectCleanupRef = useRef<(() => void) | null>(null)
  const shouldIgnorePanelFrameClick = useCallback(
    (event?: { button?: number; clientX?: number; clientY?: number }) => {
      const start = panelFramePointerDownRef.current
      panelFramePointerDownRef.current = null
      if (event?.button != null && event.button !== 0) return true
      if (!start || event?.clientX == null || event?.clientY == null) return false
      return (
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > PANEL_FRAME_DRAG_THRESHOLD
      )
    },
    []
  )

  useEffect(() => {
    const cleanup = pendingPanelFrameSelectCleanupRef.current
    return () => {
      cleanup?.()
    }
  }, [])

  const startPanelFrameSelectionRect = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      beginDeferredPanelFrameSelectionRect({
        event,
        canvasRef,
        leftDragPansCanvas: leftDragPansCanvas || prioritizeOverviewNavigation,
        pointerDownRef: panelFramePointerDownRef,
        pendingCleanupRef: pendingPanelFrameSelectCleanupRef,
      })
    },
    [canvasRef, leftDragPansCanvas, prioritizeOverviewNavigation]
  )

  const handleGetHierarchySelectionBounds = useCallback(() => {
    const padding = 20
    if (!scene) return null
    if (selection.type === 'panel' && selectedPanelIds.length > 0) {
      const selectedSurfaces = scene.surfaces.filter(
        (surface): surface is HierarchySurface & { panel: Panel } =>
          surface.kind === 'panel' &&
          surface.panel != null &&
          selectedPanelIds.includes(surface.panel.id)
      )
      if (selectedSurfaces.length === 0) return null

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity

      for (const surface of selectedSurfaces) {
        minX = Math.min(minX, surface.x)
        minY = Math.min(minY, surface.y)
        maxX = Math.max(maxX, surface.x + surface.width)
        maxY = Math.max(maxY, surface.y + surface.height)
      }

      return {
        x: minX - padding,
        y: minY - padding,
        width: maxX - minX + padding * 2,
        height: maxY - minY + padding * 2,
      }
    }

    if (selection.type === 'auxiliaryEnclosure' && selectedAuxiliaryEnclosureIds.length > 0) {
      const selectedSurfaces = scene.surfaces.filter(
        (surface) =>
          surface.kind === 'auxiliary' && selectedAuxiliaryEnclosureIds.includes(surface.id)
      )
      if (selectedSurfaces.length === 0) return null
      const minX = Math.min(...selectedSurfaces.map((surface) => surface.x))
      const minY = Math.min(...selectedSurfaces.map((surface) => surface.y))
      const maxX = Math.max(...selectedSurfaces.map((surface) => surface.x + surface.width))
      const maxY = Math.max(...selectedSurfaces.map((surface) => surface.y + surface.height))
      return {
        x: minX - padding,
        y: minY - padding,
        width: maxX - minX + padding * 2,
        height: maxY - minY + padding * 2,
      }
    }

    const placementsInScene = scene.surfaces.flatMap((surface) =>
      surface.placements.map((placement) => ({
        ref: placement.ref,
        x: surface.x + placement.x,
        y: surface.y + placement.y,
        width: placement.width,
        height: placement.height,
      }))
    )

    return getModuleSelectionBounds(placementsInScene, selection, padding)
  }, [scene, selection, selectedAuxiliaryEnclosureIds, selectedPanelIds])

  const onFindHierarchyElementsInRectangle = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      if (!scene) return []
      const buckets = new Map<
        ModuleScopeKey,
        {
          hits: Array<{ id: string; type: 'protection' | 'trunkDevice' | 'endpoint' | 'panel' }>
          panelDepth: number
        }
      >()
      for (const surface of scene.surfaces) {
        if (surface.kind === 'panel' && surface.panel) {
          const frameBox = {
            x: surface.x,
            y: surface.y + surface.mainPanelY,
            width: surface.width,
            height: surface.panelFrameHeight,
          }
          if (rectContainsRect(rect, frameBox)) {
            const scopeKey = `panel:${surface.panel.id}:frame`
            buckets.set(scopeKey, {
              hits: [{ id: surface.panel.id, type: 'panel' }],
              panelDepth: panelDepthById.get(surface.panel.id) ?? Number.MAX_SAFE_INTEGER,
            })
          }
        }
        for (const pl of surface.placements) {
          const renderBox = {
            x: surface.x + pl.x,
            y: surface.y + pl.y,
            width: pl.width,
            height: pl.height,
          }
          if (!rectContainsRect(rect, renderBox)) continue
          const scopeKey =
            surface.kind === 'panel' && surface.panel
              ? `panel:${surface.panel.id}:${pl.inSupplyPanel ? 'supply' : 'main'}`
              : 'shared-supply'
          const panelDepth =
            surface.kind === 'panel' && surface.panel
              ? (panelDepthById.get(surface.panel.id) ?? Number.MAX_SAFE_INTEGER)
              : -1
          if (!buckets.has(scopeKey)) {
            buckets.set(scopeKey, { hits: [], panelDepth })
          }
          const bucket = buckets.get(scopeKey)!
          if (pl.ref.kind === 'protection') {
            bucket.hits.push({ id: pl.ref.id, type: 'protection' })
          } else if (pl.ref.kind === 'trunkDevice') {
            bucket.hits.push({ id: pl.ref.id, type: 'trunkDevice' })
          } else {
            const endpoint = useProjectStore.getState().getEndpointById(pl.ref.endpointId)
            if (endpoint?.symbol === 'panel_distribution' && endpoint.panelId) {
              bucket.hits.push({ id: endpoint.panelId, type: 'panel' })
            } else {
              bucket.hits.push({ id: pl.ref.endpointId, type: 'endpoint' })
            }
          }
        }
      }
      let winner: {
        hits: Array<{ id: string; type: 'protection' | 'trunkDevice' | 'endpoint' | 'panel' }>
        panelDepth: number
      } | null = null
      for (const bucket of buckets.values()) {
        if (!winner) {
          winner = bucket
          continue
        }
        if (bucket.hits.length > winner.hits.length) {
          winner = bucket
          continue
        }
        if (bucket.hits.length === winner.hits.length && bucket.panelDepth < winner.panelDepth) {
          winner = bucket
        }
      }
      return winner?.hits ?? []
    },
    [panelDepthById, scene]
  )

  const createHierarchySelectionResolver = useCallback(
    (surface: HierarchySurface, placement: ModulePlacement & { inSupplyPanel?: boolean }) =>
      (
        nextSelection: CanvasSelection,
        context: {
          event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
          currentSelection: CanvasSelection
        }
      ) => {
        const additive = context.event.shiftKey || context.event.ctrlKey || context.event.metaKey
        if (!additive || nextSelection.type == null) return nextSelection
        const scopedPlacements = surface.placements.filter(
          (candidate) => candidate.inSupplyPanel === placement.inSupplyPanel
        )
        // Include every module entity id in this zone (all ref kinds). Drag-rect can set
        // selection.type to a single "dominant" kind while ids list mixes protections, trunks
        // (e.g. MUNQ), endpoints — filtering only by nextSelection.type would drop the rest.
        const scopedIds = new Set(
          scopedPlacements.flatMap((candidate) => {
            if (candidate.ref.kind === 'protection') return [candidate.ref.id]
            if (candidate.ref.kind === 'trunkDevice') return [candidate.ref.id]
            if (candidate.ref.kind === 'domotica') return [candidate.ref.endpointId]
            return []
          })
        )
        return {
          type: nextSelection.type,
          ids: nextSelection.ids.filter((id) => scopedIds.has(id)),
        }
      },
    []
  )

  return { handleHierarchyAutoArrange, handleHierarchyPanelSelect, shouldIgnorePanelFrameClick, startPanelFrameSelectionRect, handleGetHierarchySelectionBounds, onFindHierarchyElementsInRectangle, createHierarchySelectionResolver }
}
