import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDialog } from '@/hooks/useDialog'
import { usePwaInstallMenu } from '@/hooks/usePwaInstallMenu'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'

/** Keep installation help discoverable even after the browser consumes its install prompt. */
export function OfflineAppMenuItem({ onClose, className, iconClassName }: {
  onClose: () => void
  className: string
  iconClassName: string
}) {
  const { t } = useTranslation()
  const dialog = useDialog()
  const { canShow, triggerInstall } = usePwaInstallMenu()
  if (!canShow) return null
  const install = async () => {
    onClose()
    trackGoogleAnalyticsEvent('pwa_install_click', { source: 'app_menu' })
    const result = await triggerInstall()
    if (result === 'accepted' || result === 'dismissed') return
    const messageKey = result === 'ios_instructions' ? 'iosInstructions'
      : result === 'installed' ? 'installedMessage' : 'browserInstructions'
    dialog.info({
      title: t('menu.offlineApp'),
      message: t(`pwaInstall.${messageKey}`),
      variant: 'info',
    })
  }
  return <button type="button" role="menuitem" className={className} onClick={() => void install()}>
    <Download className={iconClassName} aria-hidden />
    {t('menu.offlineApp')}
  </button>
}
