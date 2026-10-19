import { getCompanionSiteUrl } from '@/utils/mainAppUrl'
import { normalizeSupportedLanguage, type SupportedLanguage } from '@/utils/languageRouting'
import { getLocalizedValidationAreiPath, getValidationAreiHash, getValidationAreiLink } from './validationAreiMapping'
export { getValidationAreiLink } from './validationAreiMapping'
export type { ValidationAreiLink } from './validationAreiMapping'

/** UI links retain local companion-site routing; tool responses use canonical URLs. */
export function getValidationAreiUrl(ruleId: string, language: SupportedLanguage | string): string {
  const normalizedLanguage = normalizeSupportedLanguage(language) ?? 'nl-BE'
  const link = getValidationAreiLink(ruleId)
  const baseUrl = getCompanionSiteUrl('arei', normalizedLanguage)
  const path = getLocalizedValidationAreiPath(link, normalizedLanguage).replace(/^\/+/, '')
  const hash = getValidationAreiHash(link, normalizedLanguage)
  return `${baseUrl}${path}${hash ? `#${hash}` : ''}`
}
