import { CommandError, type EntityRef } from '@/lib/commands/project'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { logger } from '@/lib/logger'
import { liveProjectSession } from '@/stores/liveProjectCommandSession'
import { useDialogStore } from '@/stores/dialogStore'
import { useUIStore } from '@/stores/uiStore'
import type { Selection } from '@/types/ui'
import { createUiDropBehaviorHooks } from './uiDropBehaviorHooks'
import i18n from '@/i18n'

export type MoveEndpointSelectionOutcome =
  | { status: 'moved'; changed: boolean; selected: EntityRef[] }
  | { status: 'rejected'; message: string }
  | { status: 'failed' }

/** Executes one atomic one-wire endpoint move, then applies the command's suggested selection. */
export function moveEndpointSelection(options: {
  draggedEndpointId: string
  selectedEndpointIds?: string[]
  target: DropTarget
  sitplan?: {
    activeFloorId: string | null
    viewportCenter?: { x: number; y: number } | null
    activePanelId?: string | null
  }
  label?: string
}): MoveEndpointSelectionOutcome {
  try {
    const outcome = liveProjectSession.execute(
      [
        {
          id: 'electrical.moveEndpoints',
          input: {
            draggedEndpointId: options.draggedEndpointId,
            selectedEndpointIds: options.selectedEndpointIds,
            target: options.target,
            sitplan: options.sitplan
              ? {
                  activeFloorId: options.sitplan.activeFloorId,
                  viewportCenter: options.sitplan.viewportCenter ?? null,
                  activePanelId: options.sitplan.activePanelId ?? null,
                }
              : undefined,
          },
        },
      ],
      { label: options.label ?? 'move endpoint on one-wire', source: 'drag' }
    )
    const selected = outcome.results[0]?.select ?? []
    const kind = selected[0]?.kind
    if (kind && ['endpoint', 'trunkDevice'].includes(kind)) {
      useUIStore.getState().setSelection({
        type: kind as NonNullable<Selection['type']>,
        ids: selected.map((ref) => ref.id),
      })
    }
    return { status: 'moved', changed: outcome.changed, selected }
  } catch (error) {
    if (error instanceof CommandError && error.details?.reason === 'drop_rejected') {
      return { status: 'rejected', message: error.message }
    }
    if (error instanceof CommandError) {
      logger.info('[moveEndpointSelection] move was not applied', {
        code: error.code,
        reason: error.details?.reason,
      })
      return { status: 'failed' }
    }
    throw error
  }
}

/** Canvas adapter: captures the visible plan context and shows the existing domain warning. */
export function commitEndpointMove(options: {
  draggedEndpointId: string
  selectedEndpointIds?: string[]
  target: DropTarget
  label?: string
}): boolean {
  const sitplan = createUiDropBehaviorHooks().getSitplanTarget()
  const outcome = moveEndpointSelection({
    ...options,
    sitplan: {
      activeFloorId: sitplan.activeFloorId ?? null,
      viewportCenter: sitplan.viewportCenter ?? null,
      activePanelId: sitplan.activePanelId ?? null,
    },
  })
  if (outcome.status === 'rejected') {
    useDialogStore.getState().openDialog({
      type: 'info',
      title: i18n.t('wires.domainMismatchTitle', { defaultValue: 'Cannot connect here' }),
      message: outcome.message,
      confirmLabel: i18n.t('common.ok', { defaultValue: 'OK' }),
      variant: 'warning',
    })
    return false
  }
  return outcome.status === 'moved' && outcome.changed
}
