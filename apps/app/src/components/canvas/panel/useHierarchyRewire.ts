import type { BuiltPanelScene } from '@/lib/panel/panelScene'
import { HIERARCHY_PANEL_FRAME_HIT_MARGIN, HIERARCHY_PANEL_FRAME_TITLE_HIT_HEIGHT } from './hierarchyPanelSceneQueries'

import type {
  Project,
  HierarchySurface,
  PanelOption,
} from './hierarchyPanelCanvasModel'

import { createPanelRewirePreviewQuery } from '@/lib/panel/panelRewirePreview'
import type { usePointerPreview } from '@/hooks/usePointerPreview'
import type { useCanvasWindow } from '@/components/viewport/ViewportContext'
import type { useIsActiveViewport } from '@/components/viewport/ViewportUIStore'

import { rewirePanelModules } from '@/handlers/panel/editPanelLayout'

import {
  useCallback,
  useMemo,
  useEffect,
  type RefObject,
} from 'react'

import type Konva from 'konva'

import { panelGridModuleRefKey, type ModulePlacement } from '@/lib/panel/panelGridLayout'

import { PANEL_SCENE_SHARED_SUPPLY_ID } from '@/lib/panel/panelScene'

import { findTrunkDeviceInProject } from '@/utils/project'

import { isRootSupplyTailOrSharedSupplyTailRef } from '@/lib/panel/panelRewire'
import { isTerminalStripDevice } from '@/lib/eendraad/projectElectricalDomain'
import type { PanelGridModuleRef, Panel } from '@/types/schema'

import type { Point } from '@/types/ui'

import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'

import type { Dispatch, SetStateAction } from 'react'

interface HierarchyRewireOptions {
  containerRef: RefObject<HTMLDivElement | null>
  currentProject: Project | null
  isActiveViewport: ReturnType<typeof useIsActiveViewport>
  labelMode: boolean
  panelOptions: PanelOption[]
  panelPan: Point
  panelZoom: number
  rewireMode: boolean
  rewireOriginRef: PanelGridModuleRef | null
  rewireOriginSurfaceId: string | null
  rewireTargetRef: PanelGridModuleRef | null
  rewireTargetSurfaceId: string | null
  rewireTargetValid: boolean
  scene: BuiltPanelScene | null
  setLabelMode: Dispatch<SetStateAction<boolean>>
  setRewireDragPos: ReturnType<typeof usePointerPreview>['setPoint']
  setRewireMode: Dispatch<SetStateAction<boolean>>
  setRewireOriginRef: Dispatch<SetStateAction<PanelGridModuleRef | null>>
  setRewireOriginSurfaceId: Dispatch<SetStateAction<string | null>>
  setRewireTargetRef: Dispatch<SetStateAction<PanelGridModuleRef | null>>
  setRewireTargetSurfaceId: Dispatch<SetStateAction<string | null>>
  setRewireTargetValid: Dispatch<SetStateAction<boolean>>
  window: ReturnType<typeof useCanvasWindow>
}

export function useHierarchyRewire({
  containerRef,
  currentProject,
  isActiveViewport,
  labelMode,
  panelOptions,
  panelPan,
  panelZoom,
  rewireMode,
  rewireOriginRef,
  rewireOriginSurfaceId,
  rewireTargetRef,
  rewireTargetSurfaceId,
  rewireTargetValid,
  scene,
  setLabelMode,
  setRewireDragPos,
  setRewireMode,
  setRewireOriginRef,
  setRewireOriginSurfaceId,
  setRewireTargetRef,
  setRewireTargetSurfaceId,
  setRewireTargetValid,
  window,
}: HierarchyRewireOptions) {
  const getSurfaceRewireId = useCallback(
    (surface: HierarchySurface) =>
      surface.kind === 'shared_supply' ? PANEL_SCENE_SHARED_SUPPLY_ID : surface.id,
    []
  )

  const canUseHierarchyRewireSurface = useCallback(
    (originSurfaceId: string | null, candidate: HierarchySurface) => {
      if (!originSurfaceId) return false
      const candidateSurfaceId = getSurfaceRewireId(candidate)
      if (candidateSurfaceId === originSurfaceId) return true
      const originIsTerminalStrip =
        currentProject != null &&
        rewireOriginRef?.kind === 'trunkDevice' &&
        rewireOriginRef.scope === 'circuit' &&
        isTerminalStripDevice(findTrunkDeviceInProject(currentProject, rewireOriginRef.id))
      if (originIsTerminalStrip && candidate.kind === 'panel' && candidate.panel != null) {
        return true
      }
      return (
        currentProject != null &&
        rewireOriginRef != null &&
        isRootSupplyTailOrSharedSupplyTailRef(currentProject, rewireOriginRef) &&
        candidate.kind === 'panel' &&
        candidate.panel?.isMain !== true
      )
    },
    [currentProject, getSurfaceRewireId, rewireOriginRef]
  )

  const resolveHierarchyRewirePanel = useCallback(
    (originSurfaceId: string | null, targetSurfaceId: string | null): Panel | null => {
      if (!scene || !originSurfaceId || !targetSurfaceId) return null
      if (
        originSurfaceId === PANEL_SCENE_SHARED_SUPPLY_ID &&
        targetSurfaceId === PANEL_SCENE_SHARED_SUPPLY_ID
      ) {
        return panelOptions.find((opt) => opt.isRoot && opt.panel.isMain)?.panel ?? null
      }

      const surface = scene.surfaces.find(
        (candidate) => getSurfaceRewireId(candidate) === targetSurfaceId
      )
      if (surface?.kind !== 'panel' || !surface.panel) return null
      if (
        originSurfaceId !== targetSurfaceId &&
        !(
          currentProject != null &&
          rewireOriginRef != null &&
          isRootSupplyTailOrSharedSupplyTailRef(currentProject, rewireOriginRef) &&
          surface.panel.isMain !== true
        ) &&
        !(
          currentProject != null &&
          rewireOriginRef?.kind === 'trunkDevice' &&
          rewireOriginRef.scope === 'circuit' &&
          isTerminalStripDevice(findTrunkDeviceInProject(currentProject, rewireOriginRef.id))
        )
      ) {
        return null
      }
      return surface.panel
    },
    [currentProject, getSurfaceRewireId, panelOptions, rewireOriginRef, scene]
  )

  const resetHierarchyRewireState = useCallback(() => {
    setRewireOriginRef(null)
    setRewireOriginSurfaceId(null)
    setRewireDragPos(null)
    setRewireTargetRef(null)
    setRewireTargetSurfaceId(null)
    setRewireTargetValid(true)
  }, [setRewireDragPos, setRewireOriginRef, setRewireOriginSurfaceId, setRewireTargetRef, setRewireTargetSurfaceId, setRewireTargetValid])
  useEffect(() => {
    if (!labelMode) return
    const exitLabelMode = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return
      } else {
        const target = event.target
        if (!(target instanceof Node) || !containerRef.current?.contains(target)) return
      }
      event.preventDefault()
      event.stopPropagation()
      setLabelMode(false)
    }
    window.addEventListener('keydown', exitLabelMode)
    window.addEventListener('contextmenu', exitLabelMode, true)
    return () => {
      window.removeEventListener('keydown', exitLabelMode)
      window.removeEventListener('contextmenu', exitLabelMode, true)
    }
  }, [containerRef, labelMode, setLabelMode, window])
  useEffect(() => {
    if (!rewireMode) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isActiveViewport()) return
      if (event.key !== 'Escape') return
      if (isKeyboardTypingTarget(event.target)) return
      event.preventDefault()
      resetHierarchyRewireState()
      setRewireMode(false)
    }
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target
      const insidePanelCanvas = target instanceof Node && !!containerRef.current?.contains(target)
      if (!insidePanelCanvas) return
      event.preventDefault()
      event.stopPropagation()
      resetHierarchyRewireState()
      setRewireMode(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('contextmenu', handleContextMenu, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('contextmenu', handleContextMenu, true)
    }
  }, [containerRef, resetHierarchyRewireState, rewireMode, window, isActiveViewport, setRewireMode])

  const handleHierarchyRewireDragStart = useCallback(
    (surface: HierarchySurface, ref: PanelGridModuleRef) => {
      if (!rewireMode) return false
      setRewireOriginRef(ref)
      setRewireOriginSurfaceId(getSurfaceRewireId(surface))
      setRewireDragPos(null)
      setRewireTargetRef(null)
      setRewireTargetSurfaceId(null)
      setRewireTargetValid(true)
      return true
    },
    [
      getSurfaceRewireId,
      rewireMode,
      setRewireDragPos,
      setRewireOriginRef,
      setRewireOriginSurfaceId,
      setRewireTargetRef,
      setRewireTargetSurfaceId,
      setRewireTargetValid,
    ]
  )

  const queryRewirePreview = useMemo(
    () => createPanelRewirePreviewQuery(currentProject, rewireOriginRef),
    [currentProject, rewireOriginRef]
  )

  const rewireSurfaces = useMemo(
    () => scene?.surfaces.filter(surface => canUseHierarchyRewireSurface(rewireOriginSurfaceId, surface)) ?? [],
    [scene, canUseHierarchyRewireSurface, rewireOriginSurfaceId]
  )

  const handleHierarchyRewireDragMove = useCallback(
    (_surface: HierarchySurface, _stage: Konva.Stage, pointerPos: Point) => {
      if (!scene || !rewireMode || !rewireOriginRef || !rewireOriginSurfaceId) return

      const zoom = panelZoom
      const pan = panelPan
      const canvasPos = {
        x: (pointerPos.x - pan.x) / zoom,
        y: (pointerPos.y - pan.y) / zoom,
      }
      setRewireDragPos(canvasPos)

      let foundTarget: { ref: PanelGridModuleRef; surfaceId: string } | null = null
      for (const surface of rewireSurfaces) {
        for (const placement of surface.placements) {
          const moduleKey = panelGridModuleRefKey(placement.ref)
          if (moduleKey === panelGridModuleRefKey(rewireOriginRef)) continue
          const left = surface.x + placement.x
          const right = left + placement.width
          const top = surface.y + placement.y
          const bottom = top + placement.height
          if (
            canvasPos.x >= left &&
            canvasPos.x <= right &&
            canvasPos.y >= top &&
            canvasPos.y <= bottom
          ) {
            foundTarget = { ref: placement.ref, surfaceId: getSurfaceRewireId(surface) }
            break
          }
        }
        if (foundTarget) break
      }

      let foundFrameSurfaceId: string | null = null
      if (!foundTarget) {
        for (const surface of rewireSurfaces) {
          if (
            surface.kind !== 'panel' ||
            !surface.panel
          ) {
            continue
          }
          const left = surface.x - HIERARCHY_PANEL_FRAME_HIT_MARGIN
          const right = surface.x + surface.width + HIERARCHY_PANEL_FRAME_HIT_MARGIN
          const top =
            surface.y +
            surface.mainPanelY -
            Math.max(HIERARCHY_PANEL_FRAME_HIT_MARGIN, HIERARCHY_PANEL_FRAME_TITLE_HIT_HEIGHT)
          const bottom =
            surface.y +
            surface.mainPanelY +
            surface.panelFrameHeight +
            HIERARCHY_PANEL_FRAME_HIT_MARGIN
          if (
            canvasPos.x < left ||
            canvasPos.x > right ||
            canvasPos.y < top ||
            canvasPos.y > bottom
          ) {
            continue
          }
          const surfaceId = getSurfaceRewireId(surface)
          if (queryRewirePreview(surface.panel, null)) {
            foundFrameSurfaceId = surfaceId
            break
          }
        }
      }

      setRewireTargetRef(foundTarget?.ref ?? null)
      setRewireTargetSurfaceId(foundTarget?.surfaceId ?? foundFrameSurfaceId)
      if (!foundTarget) {
        setRewireTargetValid(foundFrameSurfaceId !== null)
        return
      }

      const targetPanel = resolveHierarchyRewirePanel(rewireOriginSurfaceId, foundTarget.surfaceId)
      setRewireTargetValid(
        queryRewirePreview(targetPanel, foundTarget.ref) != null
      )
    },
    [
      queryRewirePreview,
      rewireSurfaces,
      panelPan,
      panelZoom,
      resolveHierarchyRewirePanel,
      rewireMode,
      rewireOriginRef,
      rewireOriginSurfaceId,
      scene,
      getSurfaceRewireId,
      setRewireDragPos,
      setRewireTargetRef,
      setRewireTargetSurfaceId,
      setRewireTargetValid,
    ]
  )

  const handleHierarchyRewireDragEnd = useCallback(() => {
    if (
      !rewireMode ||
      !rewireOriginRef ||
      !rewireOriginSurfaceId ||
      !rewireTargetSurfaceId ||
      !rewireTargetValid
    ) {
      resetHierarchyRewireState()
      return
    }

    const targetPanel = resolveHierarchyRewirePanel(rewireOriginSurfaceId, rewireTargetSurfaceId)
    if (!targetPanel) {
      resetHierarchyRewireState()
      return
    }

    try {
      rewirePanelModules(targetPanel.id, rewireOriginRef, rewireTargetRef)
    } finally {
      resetHierarchyRewireState()
    }
  }, [
    rewireMode,
    rewireOriginRef,
    rewireOriginSurfaceId,
    rewireTargetRef,
    rewireTargetSurfaceId,
    rewireTargetValid,
    resolveHierarchyRewirePanel,
    resetHierarchyRewireState,
  ])

  const hierarchyRewirePreviewWire = useMemo(() => {
    if (!scene || !rewireMode || !rewireOriginRef || !rewireOriginSurfaceId) {
      return null
    }

    let originPlacement:
      (ModulePlacement & { inSupplyPanel?: boolean; surface: HierarchySurface }) | null = null
    let targetPlacement:
      (ModulePlacement & { inSupplyPanel?: boolean; surface: HierarchySurface }) | null = null

    for (const surface of scene.surfaces) {
      const surfaceId = getSurfaceRewireId(surface)
      for (const placement of surface.placements) {
        const key = panelGridModuleRefKey(placement.ref)
        if (surfaceId === rewireOriginSurfaceId && key === panelGridModuleRefKey(rewireOriginRef)) {
          originPlacement = { ...placement, surface }
        }
        if (
          rewireTargetRef &&
          rewireTargetSurfaceId === surfaceId &&
          key === panelGridModuleRefKey(rewireTargetRef)
        ) {
          targetPlacement = { ...placement, surface }
        }
      }
    }

    if (!originPlacement) return null

    const originCx = originPlacement.surface.x + originPlacement.x + originPlacement.width / 2
    const originY = originPlacement.surface.y + originPlacement.y
    let finalTargetX: number | undefined
    let finalTargetY: number | undefined

    if (targetPlacement) {
      finalTargetX = targetPlacement.surface.x + targetPlacement.x + targetPlacement.width / 2
      finalTargetY = targetPlacement.surface.y + targetPlacement.y
    }

    const targetPanel = resolveHierarchyRewirePanel(rewireOriginSurfaceId, rewireTargetSurfaceId)
    const operation = targetPanel
      ? queryRewirePreview(targetPanel, rewireTargetRef)
      : null
    const promotionPanelId =
      operation?.kind === 'promotePanelToRootSupply' ? operation.panelId : null
    if (promotionPanelId && !targetPlacement) {
      const targetSurface = scene.surfaces.find(
        (surface) => surface.kind === 'panel' && surface.panel?.id === promotionPanelId
      )
      if (targetSurface) {
        finalTargetX = targetSurface.x + targetSurface.width / 2
        finalTargetY = targetSurface.y + targetSurface.mainPanelY
      }
    }

    const stroke = promotionPanelId
      ? '#2563eb'
      : rewireTargetRef && targetPlacement
        ? rewireTargetValid
          ? '#10b981'
          : '#ef4444'
        : '#f59e0b'

    return {
      origin: { x: originCx, y: originY, height: originPlacement.height },
      target: finalTargetX != null && finalTargetY != null ? { x: finalTargetX, y: finalTargetY } : null,
      sameSurface: rewireOriginSurfaceId === rewireTargetSurfaceId,
      stroke,
      promotionPanelId,
    }
  }, [
    queryRewirePreview,
    getSurfaceRewireId,
    rewireMode,
    rewireOriginRef,
    rewireOriginSurfaceId,
    rewireTargetRef,
    rewireTargetSurfaceId,
    rewireTargetValid,
    resolveHierarchyRewirePanel,
    scene,
  ])

  return { getSurfaceRewireId, resetHierarchyRewireState, handleHierarchyRewireDragStart, handleHierarchyRewireDragMove, handleHierarchyRewireDragEnd, hierarchyRewirePreviewWire }
}
