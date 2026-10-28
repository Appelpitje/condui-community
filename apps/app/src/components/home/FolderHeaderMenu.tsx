import { useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { homeCardSecondaryIconButtonClass } from '@/lib/ui/homeButtonStyles'
import { HomeMenuPortal } from './HomeMenuPortal'

type FolderHeaderMenuProps = {
  onRename?: () => void
  onDelete?: () => void
}

export function FolderHeaderMenu({ onRename, onDelete }: FolderHeaderMenuProps) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)

  const toggleMenu = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.preventDefault()
    setMenuOpen((v) => !v)
  }

  const menuItemClass =
    'w-full text-left px-3 py-2 text-sm rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100'

  return (
    <div ref={anchorRef} className="shrink-0" data-folder-actions>
      <button
        type="button"
        onClick={toggleMenu}
        className={`h-8 w-7 ${homeCardSecondaryIconButtonClass}`}
        title={t('common.moreActions')}
        aria-label={t('common.moreActions')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <svg className="w-3 h-5" viewBox="0 0 12 20" fill="currentColor" aria-hidden>
          <circle cx="6" cy="3" r="1.5" />
          <circle cx="6" cy="10" r="1.5" />
          <circle cx="6" cy="17" r="1.5" />
        </svg>
      </button>
      <HomeMenuPortal open={menuOpen} anchorRef={anchorRef} onClose={() => setMenuOpen(false)} align="end">
        {onRename ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              onRename()
            }}
            className={menuItemClass}
          >
            {t('home.folders.renameFolder')}
          </button>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              onDelete()
            }}
            className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400"
          >
            {t('home.folders.deleteFolder')}
          </button>
        ) : null}
      </HomeMenuPortal>
    </div>
  )
}
