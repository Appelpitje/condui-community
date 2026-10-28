import React from 'react'
import ReactDOM from 'react-dom/client'
import { CommunityErrorBoundary } from '@/editions/community/CommunityErrorBoundary'
import { logger } from '@/lib/logger'
import { registerAppServiceWorker } from '@/lib/pwa/registerAppServiceWorker'
import { completeAppHardReloadNavigation } from '@/lib/pwa/serviceWorkerUpdateReload'
import { resolveInitialThemePreference } from '@/utils/userPreferences'
import './index.css'

export function CommunityBootFailure({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'The application failed to start.'
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-zinc-50 px-6 py-12 text-center text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        Reload the app to continue. Error details are available in your browser console.
      </p>
      <pre className="max-w-xl overflow-auto rounded-md bg-zinc-100 p-3 text-left text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        {message}
      </pre>
      <button
        type="button"
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        onClick={() => window.location.reload()}
      >
        Reload app
      </button>
    </div>
  )
}

const isCompletingHardReload = completeAppHardReloadNavigation()

if (!isCompletingHardReload) {
  registerAppServiceWorker()

  void import('@/lib/symbolImage').then(({ warmSymbolSvgCache }) => {
    void warmSymbolSvgCache({ isDark: resolveInitialThemePreference(['eendra-theme']) === 'dark' })
  })

  const root = document.getElementById('root')!

  void Promise.all([import('./CommunityApp'), import('./i18n').then(({ i18nReady }) => i18nReady)])
    .then(([{ default: CommunityApp }]) => {
      ReactDOM.createRoot(root).render(
        <CommunityErrorBoundary>
          <React.StrictMode>
            <CommunityApp />
          </React.StrictMode>
        </CommunityErrorBoundary>,
      )
    })
    .catch((error: unknown) => {
      logger.error('Condui Community failed to start.', error)
      ReactDOM.createRoot(root).render(<CommunityBootFailure error={error} />)
    })
}
