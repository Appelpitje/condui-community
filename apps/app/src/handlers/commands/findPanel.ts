import { createElement } from 'react'
import i18n from '@/i18n'
import { FindPanelDialog } from '@/components/commands/FindPanelDialog'
import { useDialogStore } from '@/stores/dialogStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { focusSelectionOnCanvas } from '@/lib/ui/focusSelectionOnCanvas'
import { findPanels } from '@/lib/panel/findPanels'
import type { CommandContext } from '@/lib/commands/ui/types'
import type { CanvasType } from '@/types/ui'

export function focusFoundPanel(panelId: string, canvas: CanvasType, ctx: CommandContext): boolean {
  const project = useProjectStore.getState().currentProject
  const result = project && findPanels(project, '').find((panel) => panel.id === panelId)
  if (!result) return false
  const windowUI = ctx.viewport?.ui ?? useUIStore
  const state = windowUI.getState()
  const preferredIndex = ctx.pointerPanelIndex ?? ctx.targetPanelIndex ?? 0
  const existingIndex = state.viewportLayout.panels.findIndex((panel) => panel.canvas === canvas)
  const index =
    state.viewportLayout.panels[preferredIndex]?.canvas === canvas
      ? preferredIndex
      : existingIndex >= 0
        ? existingIndex
        : preferredIndex
  const ui = ctx.viewport?.getPanelUI(index) ?? windowUI
  const placement =
    result.placements.find((entry) => entry.floorId === ui.getState().activeFloorId) ??
    result.placements[0]
  if (canvas === 'plan' && !placement) return false
  if (state.viewportLayout.panels[index]?.canvas !== canvas) state.setPanelCanvas(index, canvas)
  ui.getState().setActivePanelId(panelId)
  if (canvas === 'panel' && ui.getState().panelCanvasMode.kind === 'panel') {
    ui.getState().setPanelCanvasMode({ kind: 'panel', panelId })
  }
  const selection =
    canvas === 'plan' && placement
      ? { type: 'placement' as const, ids: [placement.id] }
      : { type: 'panel' as const, ids: [panelId] }
  if (canvas === 'plan' && placement) {
    ui.getState().setActiveFloor(placement.floorId)
    ui.getState().setSitplanPanelFilterId(null)
  }
  ui.getState().setSelection(selection)
  useDialogStore.getState().closeDialog()
  focusSelectionOnCanvas(
    selection,
    { preferredCanvas: canvas },
    {
      getState: ui.getState,
      getWindow: ctx.viewport?.getOwnerWindow ?? (() => window),
    }
  )
  return true
}

export function openFindPanel(ctx: CommandContext): void {
  const ui = ctx.viewport?.ui ?? useUIStore
  const index = ctx.pointerPanelIndex ?? ctx.targetPanelIndex ?? 0
  const current = ui.getState().viewportLayout.panels[index]?.canvas
  const canvas = current === 'panel' || current === 'plan' ? current : 'eendraad'
  useDialogStore.getState().openDialog({
    id: 'find-panel',
    type: 'custom',
    title: i18n.t('findPanel.title'),
    size: 'lg',
    content: createElement(FindPanelDialog, {
      canvas,
      onChoose: (panelId: string, target: CanvasType) => focusFoundPanel(panelId, target, ctx),
    }),
  })
}
