import { create } from 'zustand'
import type React from 'react'
import { getDialogOwnerDocument } from '@/lib/ui/dialogOwner'

export type DialogType = 'confirm' | 'prompt' | 'info' | 'custom'

export interface DialogButton {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary' | 'danger'
  autoFocus?: boolean
  testId?: string
}

export interface BaseDialogConfig {
  id?: string
  title: string
  titleIcon?: React.ReactNode
  /** Small secondary text shown after the title in the header. */
  titleAside?: React.ReactNode
  message?: string
  type?: DialogType
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'wide'
  showCloseButton?: boolean
  onClose?: () => void
}

export interface ConfirmDialogConfig extends BaseDialogConfig {
  type: 'confirm'
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel?: () => void
  variant?: 'danger' | 'warning' | 'info'
}

export interface PromptDialogConfig extends BaseDialogConfig {
  type: 'prompt'
  inputLabel?: string
  inputPlaceholder?: string
  inputType?: 'text' | 'number' | 'email' | 'password'
  inputValue?: string
  inputValidator?: (value: string) => string | null // Returns error message or null
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: (value: string) => void
  onCancel?: () => void
}

export interface InfoDialogConfig extends BaseDialogConfig {
  type: 'info'
  confirmLabel?: string
  onConfirm?: () => void
  variant?: 'info' | 'success' | 'warning' | 'error'
}

export interface CustomDialogConfig extends BaseDialogConfig {
  type: 'custom'
  content: React.ReactNode
  buttons?: DialogButton[]
  /** Rendered on the left side of the custom dialog footer, below the divider. */
  footerStart?: React.ReactNode
}

export type DialogConfig =
  ConfirmDialogConfig | PromptDialogConfig | InfoDialogConfig | CustomDialogConfig

interface DialogState {
  dialog: DialogConfig | null
  ownerDocument: Document | null
  openDialog: (config: DialogConfig, ownerDocument?: Document | null) => void
  closeDialog: () => void
}

export const selectIsAppDialogOpen = (state: DialogState) => state.dialog != null

export const useDialogStore = create<DialogState>()((set) => ({
  dialog: null,
  ownerDocument: null,

  openDialog: (dialog, ownerDocument = getDialogOwnerDocument()) => set({ dialog, ownerDocument }),

  closeDialog: () => set({ dialog: null, ownerDocument: null }),
}))

export function closeDialogForDocument(ownerDocument: Document): void {
  const state = useDialogStore.getState()
  if (!state.dialog || state.ownerDocument !== ownerDocument) return
  state.dialog.onClose?.()
  if (useDialogStore.getState().dialog === state.dialog) state.closeDialog()
}
