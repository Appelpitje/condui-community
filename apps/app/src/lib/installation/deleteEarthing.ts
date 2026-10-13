import i18n from '@/i18n'
import { deleteProjectEntities } from '@/handlers/commands/deleteEntities'
import { resolveEarthingDeleteScope } from '@/lib/eendraad/panelGround'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { useDialogStore } from '@/stores/dialogStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'

export function performDeleteEarthingLocations(options: {
  mode: 'all' | 'installation' | 'panel'
  panelId?: string
  clearSelection?: boolean
}): void {
  const deleted = deleteProjectEntities([
    { kind: 'ground', id: options.panelId ?? 'installation', scope: options.mode },
  ])
  if (deleted && options.clearSelection !== false) useUIStore.getState().clearSelection()
}

/** Remove every earth electrode stem and sitplan placements. */
export function performDeleteEarthing(clearSelection = true): void {
  performDeleteEarthingLocations({ mode: 'all', clearSelection })
}

type ConfirmDeleteEarthingArg =
  | (() => void)
  | { groundElementId?: string; onConfirmed?: () => void; deleteOnConfirm?: boolean }

/** Ask for confirmation before removing earthing. Optional callback runs after removal. */
export function confirmDeleteEarthing(onConfirmedOrOptions?: ConfirmDeleteEarthingArg): void {
  const options =
    typeof onConfirmedOrOptions === 'function'
      ? { onConfirmed: onConfirmedOrOptions }
      : (onConfirmedOrOptions ?? {})
  const { openDialog } = useDialogStore.getState()
  const t = i18n.t.bind(i18n)
  openDialog({
    type: 'confirm',
    title: t('earthing.deleteConfirmTitle', 'Remove earthing?'),
    variant: 'warning',
    confirmLabel: t('common.remove', 'Remove'),
    cancelLabel: t('common.cancel'),
    onConfirm: () => {
      const store = useProjectStore.getState()
      const project = store.currentProject
      const scope = project
        ? resolveEarthingDeleteScope(options.groundElementId, getProjectElectricalPanels(project))
        : { mode: 'all' as const }
      if (options.deleteOnConfirm !== false)
        performDeleteEarthingLocations({
          ...scope,
          clearSelection: !options.onConfirmed,
        })
      options.onConfirmed?.()
    },
  })
}
