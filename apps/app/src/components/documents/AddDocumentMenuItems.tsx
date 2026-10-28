import type { ContextMenuItem } from '@/components/common/ContextMenu'

const menuItemClassName =
  'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:text-gray-300 dark:hover:bg-gray-700'

/** Render document actions without evaluating the callbacks that open native file pickers. */
export function AddDocumentMenuItems({ items }: { items: ContextMenuItem[] }) {
  return <>{items.map((item, index) => (
    <button
      key={item.label}
      type="button"
      data-testid={index === 0 ? 'project-documents-upload' : undefined}
      className={menuItemClassName}
      disabled={item.disabled}
      onClick={item.onClick}
    >
      {item.icon}
      {item.label}
      {item.badge ? <span className="ml-auto pl-3">{item.badge}</span> : null}
    </button>
  ))}</>
}
