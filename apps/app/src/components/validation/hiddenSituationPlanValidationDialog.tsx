import type { TFunction } from 'i18next'
import HiddenItemsDialog, { type HiddenItem } from '@/components/common/HiddenItemsDialog'
import { getHiddenSituationPlanPlacements } from '@/lib/plan/hiddenSituationPlanPlacements'
import type { ProjectWithSituationPlanPlacements } from '@/lib/plan/hiddenSituationPlanPlacements'
import { restoreHiddenSituationPlanPlacementsToActiveView } from '@/lib/plan/restoreHiddenSituationPlanPlacements'
import { getSymbolById, getSymbolIconPath } from '@/lib/symbols'
import { useDialogStore } from '@/stores/dialogStore'
import { useUIStore } from '@/stores/uiStore'

export const HIDDEN_SITUATION_PLAN_RULE_ID =
  'be.areibook1.2025.hidden-situation-plan-symbols'

export function openHiddenSituationPlanValidationDialog(
  project: ProjectWithSituationPlanPlacements,
  t: TFunction,
): boolean {
  const hiddenPlacements = getHiddenSituationPlanPlacements(project)
  if (hiddenPlacements.length === 0) return false

  const ui = useUIStore.getState()
  if (!ui.viewportLayout.panels.some((panel) => panel.canvas === 'plan')) {
    ui.setPanelCanvas(0, 'plan')
  }
  if (!ui.activeFloorId) ui.setActiveFloor(hiddenPlacements[0]!.floorId)

  const dialogItems: HiddenItem[] = hiddenPlacements.map((hidden) => {
    const symbolMeta = hidden.symbol ? getSymbolById(hidden.symbol) : undefined
    const symbolLabel = symbolMeta?.id
      ? t(`symbols.${symbolMeta.id}`, symbolMeta.name)
      : undefined
    const itemLabel = hidden.endpointLabel.trim() || symbolLabel || hidden.symbol
    return {
      id: hidden.placementId,
      label:
        itemLabel ||
        t('hiddenItemsDialog.unnamedItem', 'Unnamed item'),
      subtitle: hidden.circuitLabel || undefined,
      icon: symbolMeta ? (
        <img src={getSymbolIconPath(symbolMeta)} alt="" className="h-7 w-7 object-contain dark:invert" />
      ) : undefined,
    }
  })
  const customPlacementIds = new Set(
    hiddenPlacements.filter((hidden) => hidden.isCustomPlacement).map((hidden) => hidden.placementId)
  )

  const { openDialog, closeDialog } = useDialogStore.getState()
  openDialog({
    type: 'custom',
    title: t('contextMenu.showHidden', 'Show hidden…'),
    content: (
      <HiddenItemsDialog
        items={dialogItems}
        showMoveToCurrentView
        getMoveToCurrentViewDefault={(selectedIds) =>
          selectedIds.some((id) => !customPlacementIds.has(id))
        }
        onConfirm={(selectedIds, options) => {
          restoreHiddenSituationPlanPlacementsToActiveView(selectedIds, {
            moveToActiveView: options.moveToCurrentViewOverridden
              ? options.moveToCurrentView
              : undefined,
          })
          closeDialog()
        }}
        onCancel={closeDialog}
      />
    ),
  })
  return true
}
