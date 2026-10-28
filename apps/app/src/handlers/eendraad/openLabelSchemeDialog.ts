import { createElement } from 'react'
import type { TFunction } from 'i18next'
import { LabelSchemeDialogContent } from '@/components/canvas/eendraad/LabelSchemeSettings'
import { useDialogStore } from '@/stores/dialogStore'

export function openLabelSchemeDialog(t: TFunction): void {
  useDialogStore.getState().openDialog({
    id: 'label-scheme',
    type: 'custom',
    title: t('canvas.eendraadNaming.scheme.dialogTitle', 'Automatic labels'),
    size: 'wide',
    content: createElement(LabelSchemeDialogContent),
  })
}
