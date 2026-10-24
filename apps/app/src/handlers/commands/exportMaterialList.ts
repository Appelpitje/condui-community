import { createElement } from 'react'
import i18n from '@/i18n'
import { useProjectStore } from '@/stores/projectStore'
import { useDialogStore } from '@/stores/dialogStore'
import { MaterialListExportDialog } from '@/components/export/MaterialListExportDialog'

/** Shared by both editions, the tally, and the command palette; never edits project data. */
export function openMaterialListExport(ownerDocument?: Document): void {
  if (!useProjectStore.getState().currentProject) return
  useDialogStore.getState().openDialog(
    {
      id: 'material-list-export',
      type: 'custom',
      title: i18n.t('materialListExport.title'),
      content: createElement(MaterialListExportDialog),
      size: 'wide',
      showCloseButton: true,
    },
    ownerDocument
  )
}
