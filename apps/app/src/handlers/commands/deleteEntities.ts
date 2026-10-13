import type { DeleteEntityRef } from '@/lib/eendraad/entityDeletion'
import type { Selection } from '@/types/ui'
import { useProjectStore } from '@/stores/projectStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { liveProjectSession } from '@/stores/liveProjectCommandSession'
import { CommandError } from '@/lib/commands/project/types'
import { useDialogStore } from '@/stores/dialogStore'
import { linkedSubPanelDisplayNamesForProtectionIds } from '@/lib/panel/linkedSubPanelDeleteWarning'
import { createLinkedProtectionDeleteDialog } from '@/lib/panel/linkedProtectionDeleteDialog'
import type { TFunction } from 'i18next'
import { isGroundElementId, parseGroundElementId } from '@/lib/eendraad/panelGround'

/** UI adapters supply stable entity refs; all dependent mutations happen in one command. */
export function deleteProjectEntities(
  refs: DeleteEntityRef[],
  options: { preserveLinkedPanels?: boolean; onDeleted?: () => void } = {}
): boolean {
  if (refs.length === 0) return false
  const result = runProjectCommand(
    'entities.delete',
    { refs, ...(options.preserveLinkedPanels ? { preserveLinkedPanels: true } : {}) },
    { label: 'delete selected entities', source: 'editor' }
  )
  if (!result) return false
  options.onDeleted?.()
  return true
}

export function resolveSelectionDeleteRefs(
  selection: Selection,
  noteScope?: 'oneWire' | 'sitplan'
): DeleteEntityRef[] {
  const store = useProjectStore.getState()
  const refs: DeleteEntityRef[] = []
  for (const id of selection.ids) {
    if (selection.type === 'placement') refs.push({ kind: 'placement', id })
    else if (store.getProtectionById(id)) refs.push({ kind: 'protection', id })
    else if (store.getEndpointById(id)) refs.push({ kind: 'endpoint', id })
    else if (store.getTrunkDeviceById(id)) refs.push({ kind: 'trunkDevice', id })
    else if (store.getPanelById(id)) refs.push({ kind: 'panel', id })
    else if (store.getCircuitById(id)) refs.push({ kind: 'circuit', id })
    else if (store.getFrameById(id)) refs.push({ kind: 'frame', id })
    else if (noteScope !== 'oneWire' && store.getSitplanNoteById(id))
      refs.push({ kind: 'note', id, scope: 'sitplan' })
    else if (noteScope !== 'sitplan' && store.getEendraadNoteById(id))
      refs.push({ kind: 'note', id, scope: 'oneWire' })
    else if (isGroundElementId(id)) {
      const parsed = parseGroundElementId(id)
      refs.push({
        kind: 'ground',
        id: parsed?.kind === 'panel' ? parsed.panelId : 'installation',
        scope:
          parsed?.kind === 'panel'
            ? 'panel'
            : parsed?.kind === 'installation'
              ? 'installation'
              : 'all',
      })
    } else if (
      selection.type === 'wall' ||
      selection.type === 'door' ||
      selection.type === 'window' ||
      selection.type === 'stair' ||
      selection.type === 'graphicElement'
    )
      refs.push({ kind: selection.type, id })
  }
  return refs
}

/** Palette/general selection adapter retains the established destructive-action dialogs. */
export function requestDeleteProjectEntities(
  refs: DeleteEntityRef[],
  t: TFunction,
  onDeleted: () => void
): boolean {
  if (!refs.length) return false
  const invocation = { id: 'entities.delete', input: { refs } }
  const preview = liveProjectSession.preview(invocation)
  if (!preview.check.ok) return false
  const execute = (preserveLinkedPanels = false) => {
    try {
      liveProjectSession.execute([{ ...invocation, input: { refs, preserveLinkedPanels } }], {
        expectedRevision: preview.revision,
        label: 'delete selected entities',
        source: 'palette',
      })
      onDeleted()
    } catch (error) {
      if (!(error instanceof CommandError)) throw error
      if (error.code === 'stale_revision')
        queueMicrotask(() => requestDeleteProjectEntities(refs, t, onDeleted))
    }
  }
  const store = useProjectStore.getState()
  const linkedNames = linkedSubPanelDisplayNamesForProtectionIds(
    store.currentProject,
    store.getPanelById,
    refs.filter((ref) => ref.kind === 'protection').map((ref) => ref.id)
  )
  const confirmLinks = () => {
    if (linkedNames.length)
      useDialogStore.getState().openDialog(
        createLinkedProtectionDeleteDialog({
          t,
          panelNames: linkedNames.join(', '),
          onDeletePanel: () => execute(false),
          onDeleteProtection: () => execute(true),
        })
      )
    else execute()
  }
  if (refs.some((ref) => ref.kind === 'panel' || ref.kind === 'ground')) {
    const panelNames = refs
      .filter((ref) => ref.kind === 'panel')
      .map((ref) => store.getPanelById(ref.id)?.name ?? ref.id)
      .join(', ')
    useDialogStore.getState().openDialog({
      type: 'confirm',
      title: panelNames ? t('panel.deleteConfirmTitle') : t('earthing.deleteConfirmTitle'),
      ...(panelNames ? { message: t('panel.deleteConfirmMessage', { panelNames }) } : {}),
      variant: 'warning',
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      onConfirm: confirmLinks,
    })
  } else confirmLinks()
  return true
}

export const deleteEndpointByCommand = (id: string) => {
  deleteProjectEntities([{ kind: 'endpoint', id }])
}
export const deletePlacementByCommand = (id: string) => {
  deleteProjectEntities([{ kind: 'placement', id, retainOwner: true }])
}
export const deleteEndpointsByCommand = (ids: string[]) => {
  deleteProjectEntities(ids.map((id) => ({ kind: 'endpoint', id })))
}
export const deleteProtectionByCommand = (
  id: string,
  options?: { preserveLinkedPanels?: boolean }
) => {
  deleteProjectEntities([{ kind: 'protection', id }], options)
}
export const deleteProtectionsByCommand = (
  ids: string[],
  options?: { preserveLinkedPanels?: boolean }
) => {
  deleteProjectEntities(
    ids.map((id) => ({ kind: 'protection', id })),
    options
  )
}
export const deletePanelByCommand = (id: string) => {
  deleteProjectEntities([{ kind: 'panel', id }])
}
export const deleteTrunkDeviceByCommand = (_circuitId: string, id: string) => {
  deleteProjectEntities([{ kind: 'trunkDevice', id }])
}
export const deleteGroundTrunkDeviceByCommand = (id: string) => {
  deleteProjectEntities([{ kind: 'trunkDevice', id }])
}
export const deleteEendraadNotesByCommand = (ids: string[]) => {
  deleteProjectEntities(ids.map((id) => ({ kind: 'note', id, scope: 'oneWire' })))
}
export const deleteSitplanNotesByCommand = (ids: string[]) => {
  deleteProjectEntities(ids.map((id) => ({ kind: 'note', id, scope: 'sitplan' })))
}
export const deleteFramesByCommand = (ids: string[]) => {
  deleteProjectEntities(ids.map((id) => ({ kind: 'frame', id })))
}
