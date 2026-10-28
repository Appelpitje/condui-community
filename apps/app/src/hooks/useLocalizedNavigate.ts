import { useCallback } from 'react'
import { useNavigate, type NavigateOptions } from 'react-router-dom'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  buildLocalizedAppPath,
  normalizeSupportedLanguage,
  resolveDomainDefaultLanguage,
} from '@/utils/languageRouting'

export function useLocalizedPath() {
  const storedLanguage = useSettingsStore((state) => state.language)
  const language =
    normalizeSupportedLanguage(storedLanguage) ??
    resolveDomainDefaultLanguage(
      typeof window !== 'undefined' ? window.location.hostname : '',
    )

  return useCallback(
    (pathWithoutLanguage: string) => buildLocalizedAppPath(pathWithoutLanguage, language),
    [language],
  )
}

export function useLocalizedNavigate() {
  const navigate = useNavigate()
  const localizedPath = useLocalizedPath()

  return useCallback(
    (pathWithoutLanguage: string, options?: NavigateOptions) => {
      void navigate(localizedPath(pathWithoutLanguage), options)
    },
    [localizedPath, navigate],
  )
}
