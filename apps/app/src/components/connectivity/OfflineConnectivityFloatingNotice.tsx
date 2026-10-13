import { useTranslation } from 'react-i18next'
import { WifiOff, X } from 'lucide-react'
import { usePwaOfflineReloadReady } from '@/hooks/usePwaOfflineReloadReady'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'

type OfflineConnectivityFloatingNoticeProps = {
  onDismiss: () => void
  topClassName?: string
}

/** Dismissible offline notice below the top bar; does not affect header layout. */
export function OfflineConnectivityFloatingNotice({
  onDismiss,
  topClassName = 'top-[4.25rem]',
}: OfflineConnectivityFloatingNoticeProps) {
  const { t } = useTranslation()
  const { showDevReloadHint, showProdReloadHint } = usePwaOfflineReloadReady()
  const { isDatabaseOffline } = useOnlineStatus()

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed left-1/2 z-[225] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 ${topClassName}`}
    >
      <div className="pointer-events-auto flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 shadow-lg dark:border-amber-800 dark:bg-amber-950/95 dark:text-amber-100">
        <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 leading-snug">
          <span className="block">{t(isDatabaseOffline ? 'connectivity.databaseOfflineBanner' : 'connectivity.offlineBanner')}</span>
          {!isDatabaseOffline && showDevReloadHint ? (
            <span className="mt-1 block text-xs text-amber-900/90 dark:text-amber-100/90">
              {t('connectivity.offlineReloadDevHint')}
            </span>
          ) : null}
          {!isDatabaseOffline && showProdReloadHint ? (
            <span className="mt-1 block text-xs text-amber-900/90 dark:text-amber-100/90">
              {t('connectivity.offlineReloadNotReady')}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex shrink-0 rounded-md p-1 text-amber-800 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-amber-100 dark:hover:bg-amber-900/60"
          aria-label={t('connectivity.dismissOfflineBanner')}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}
