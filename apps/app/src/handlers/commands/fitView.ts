import type { CommandContext } from '@/lib/commands/ui/types'
import { createElement } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { useDialogStore } from '@/stores/dialogStore'
import HiddenItemsDialog, { type HiddenItem } from '@/components/common/HiddenItemsDialog'
import { getSymbolById } from '@/lib/symbols'
import { buildAutoSitplanPlacement } from '@/lib/plan/autoSitplanPlacement'
import { generateId } from '@/utils/project'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import i18n from '@/i18n'
import { restoreHiddenSituationPlanPlacementsToActiveView } from '@/lib/plan/restoreHiddenSituationPlanPlacements'
import { hasCustomPlacement } from '@/lib/plan/customPlacement'

const REPAIRABLE_SITPLAN_SYMBOLS = new Set([
  'junction_box',
  'junction_panel',
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
])

/**
 * When the selected item's placement on the active floor is hidden, offers to show it
 * again and returns `true`. Missing placements of repairable symbols are created first.
 */
function revealHiddenSelectedPlacement(): boolean {
  const ui = useUIStore.getState()
  const store = useProjectStore.getState()
  const floorId = ui.activeFloorId
  const floor = floorId ? store.getFloorById(floorId) : undefined
  let targetPlacementId: string | undefined

  if (floorId && floor && ui.selection.ids.length > 0) {
    if (ui.selection.type === 'endpoint') {
      const endpointId = ui.selection.ids[0]!
      const endpoint = store.getEndpointById(endpointId)
      let placement = endpoint?.placements.find((candidate) => candidate.floorId === floorId)
      if (
        !placement &&
        endpoint?.symbol &&
        REPAIRABLE_SITPLAN_SYMBOLS.has(endpoint.symbol) &&
        store.currentProject
      ) {
        const circuitId = store.findCircuitForEndpoint(endpointId)?.circuit.id
        if (circuitId) {
          const suggested = buildAutoSitplanPlacement(store.currentProject, {
            circuitId,
            floorId,
            placementId: generateId(),
          })
          if (
            suggested &&
            runProjectCommand(
              'plan.placeExisting',
              {
                target: { kind: 'endpoint', id: endpointId },
                floorId,
                layer: suggested.layer,
                pos: suggested.pos,
              },
              { label: 'place existing plan item', source: 'plan' }
            )
          ) {
            placement = useProjectStore
              .getState()
              .getEndpointById(endpointId)
              ?.placements.find((candidate) => candidate.floorId === floorId)
          }
        }
      }
      targetPlacementId = placement?.id
    } else if (ui.selection.type === 'trunkDevice') {
      const deviceId = ui.selection.ids[0]!
      const resolved = store.getTrunkDeviceById(deviceId)
      const device = resolved?.device
      let placement = device?.placements?.find((candidate) => candidate.floorId === floorId)
      if (
        !placement &&
        (device?.type === 'conversion' || device?.symbol === 'junction_box') &&
        resolved?.circuit &&
        store.currentProject
      ) {
        const suggested = buildAutoSitplanPlacement(store.currentProject, {
          circuitId: resolved.circuit.id,
          floorId,
          placementId: generateId(),
        })
        if (
          suggested &&
          runProjectCommand(
            'plan.placeExisting',
            {
              target: { kind: 'trunkDevice', id: deviceId },
              floorId,
              layer: suggested.layer,
              pos: suggested.pos,
            },
            { label: 'place existing plan item', source: 'plan' }
          )
        ) {
          placement = useProjectStore
            .getState()
            .getTrunkDeviceById(deviceId)
            ?.device.placements?.find((candidate) => candidate.floorId === floorId)
        }
      }
      targetPlacementId = placement?.id
    }
  }

  const refreshedFloor = floorId ? store.getFloorById(floorId) : undefined
  const hiddenIds = refreshedFloor?.hiddenSitplanPlacementIds ?? []
  if (!floorId || !targetPlacementId || !hiddenIds.includes(targetPlacementId)) return false

  const rows = store.getPlacementsByFloor(floorId)
  const rowById = new Map(rows.map((row) => [row.id, row]))
  const customPlacementIds = new Set(rows.filter(hasCustomPlacement).map((row) => row.id))
  const items: HiddenItem[] = hiddenIds.flatMap((hiddenId) => {
    const row = rowById.get(hiddenId)
    if (!row) return []
    const endpoint = row.endpointId ? store.getEndpointById(row.endpointId) : undefined
    const trunkDevice = row.trunkDeviceId
      ? store.getTrunkDeviceById(row.trunkDeviceId)?.device
      : undefined
    const symbolKey = endpoint?.symbol ?? trunkDevice?.symbol
    const symbol = symbolKey ? getSymbolById(symbolKey) : undefined
    return [
      {
        id: hiddenId,
        label:
          endpoint?.label ||
          trunkDevice?.label ||
          symbol?.name ||
          i18n.t('hiddenItemsDialog.unnamedItem', { defaultValue: 'Unnamed item' }),
        subtitle: symbol
          ? i18n.t(`symbols.${symbol.id}`, { defaultValue: symbol.name })
          : undefined,
        icon: symbol
          ? createElement('img', {
              src: symbol.svgPath,
              alt: '',
              className: 'w-7 h-7 object-contain dark:invert',
            })
          : undefined,
      },
    ]
  })
  const { openDialog, closeDialog } = useDialogStore.getState()
  openDialog({
    type: 'custom',
    title: i18n.t('contextMenu.showHidden', { defaultValue: 'Show hidden…' }),
    content: createElement(HiddenItemsDialog, {
      items,
      initialSelectedIds: [targetPlacementId],
      showMoveToCurrentView: true,
      getMoveToCurrentViewDefault: (selectedIds: string[]) =>
        selectedIds.some((id) => !customPlacementIds.has(id)),
      onConfirm: (
        selectedIds: string[],
        options: { moveToCurrentView: boolean; moveToCurrentViewOverridden: boolean }
      ) => {
        restoreHiddenSituationPlanPlacementsToActiveView(selectedIds, {
          moveToActiveView: options.moveToCurrentViewOverridden
            ? options.moveToCurrentView
            : undefined,
        })
        closeDialog()
      },
      onCancel: closeDialog,
    }),
  })
  return true
}

/**
 * Fits the canvas of the given panel; without a pointer panel (touch, the palette with
 * the pointer elsewhere, several panels), fits them all. On the situation plan a hidden selected placement is offered for
 * showing again instead.
 */
export function fitView({
  viewport,
  panelIndex,
  pointerPanelIndex,
  canEditProject,
}: {
  viewport?: CommandContext['viewport']
  panelIndex: number | null
  pointerPanelIndex: number | null
  canEditProject: boolean
}): void {
  const ui = viewport?.ui ?? useUIStore
  const layout = ui.getState().viewportLayout
  const targetPanel =
    panelIndex != null
      ? layout.panels[panelIndex]
      : layout.panels.length === 1
        ? layout.panels[0]
        : null
  if (targetPanel?.canvas === 'plan' && canEditProject && revealHiddenSelectedPlacement()) return
  const canvasesToFit =
    targetPanel && (layout.panels.length === 1 || pointerPanelIndex != null)
      ? [targetPanel.canvas]
      : Array.from(new Set(layout.panels.map((panel) => panel.canvas)))
  if (viewport) {
    layout.panels.forEach((panel, index) => {
      if (canvasesToFit.includes(panel.canvas) && (targetPanel == null || panelIndex == null || index === panelIndex)) {
        viewport.getPanelUI(index)?.getState().requestFitToView([panel.canvas])
      }
    })
  } else ui.getState().requestFitToView(canvasesToFit)
}
