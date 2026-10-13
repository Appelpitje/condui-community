/* eslint react-refresh/only-export-components: off -- Shared menu actions and their input component form one API. */
import { FileText, Map as MapIcon } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { useDialog } from '@/hooks/useDialog'
import { revealCanvas } from '@/lib/ui/revealCanvas'
import { usePendingImportStore } from '@/stores/pendingImportStore'
import { MenuActionPicker, type MenuActionItem } from './MenuSubmenu'

/**
 * Shared pieces of the project menu's Import and Export groups. The hosted and Community
 * layouts both build their menus from these so the two editions behave the same.
 */

export const LARGE_MENU_ICON_CLASS = 'h-9 w-9'

/** Hover flyouts on desktop pointers; touch and compact layouts open the picker directly. */
export function menuSubmenusOnHover(compact: boolean): boolean {
  return (
    !compact &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  )
}

/** Import > Floor plan and Import > Document; the document choice needs a mounted file input. */
export function createImportMenuItems({
  t,
  menuIconClass,
  closeMenu,
  documentInput,
  documentsEnabled,
}: {
  t: TFunction
  menuIconClass: string
  closeMenu: () => void
  documentInput: HTMLInputElement | null | (() => HTMLInputElement | null)
  documentsEnabled: boolean
}): MenuActionItem[] {
  const resolveInput = () => (typeof documentInput === 'function' ? documentInput() : documentInput)
  return [
    {
      id: 'plan',
      label: t('menu.importKind.plan'),
      icon: <MapIcon className={menuIconClass} aria-hidden />,
      largeIcon: <MapIcon className={LARGE_MENU_ICON_CLASS} aria-hidden />,
      testId: 'app-menu-import-plan',
      onSelect: () => {
        closeMenu()
        usePendingImportStore.getState().requestPlanImport()
        revealCanvas('plan')
      },
    },
    ...(documentsEnabled
      ? [
          {
            id: 'document',
            label: t('menu.importKind.document'),
            icon: <FileText className={menuIconClass} aria-hidden />,
            largeIcon: <FileText className={LARGE_MENU_ICON_CLASS} aria-hidden />,
            testId: 'app-menu-import-document',
            onSelect: () => {
              closeMenu()
              // Opened from the click itself: browsers block file pickers started later.
              resolveInput()?.click()
            },
          },
        ]
      : []),
  ]
}

/** Hidden file input behind Import > Document; files go to the Documents canvas once shown. */
export function DocumentImportInput({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  return (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,image/svg+xml"
      className="hidden"
      data-testid="import-document-input"
      onChange={(event) => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        if (files.length === 0) return
        usePendingImportStore.getState().requestDocumentFiles(files)
        revealCanvas('documents')
      }}
    />
  )
}

/** The large-icon picker opened by clicking Import… or Export…. */
export function openMenuActionPicker(
  dialog: ReturnType<typeof useDialog>,
  title: string,
  items: MenuActionItem[],
): void {
  dialog.custom({
    title,
    content: <MenuActionPicker items={items} onPicked={() => dialog.close()} />,
    size: 'lg',
    showCloseButton: true,
  })
}
