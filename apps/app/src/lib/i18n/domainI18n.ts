import { createInstance } from 'i18next'
import { logger } from '@/lib/logger'
import {
  DOMAIN_LANGUAGES,
  getLoadedLocaleCatalog,
  loadLocaleCatalog,
  normalizeDomainLanguage,
  type DomainLanguage,
} from '@/lib/i18n/localeCatalogs'

export { DOMAIN_LANGUAGES, normalizeDomainLanguage, type DomainLanguage } from '@/lib/i18n/localeCatalogs'

/**
 * React-free translation instance for domain code shared with web workers.
 * The browser i18n bootstrap and each worker request synchronize its language.
 */
const domainI18n = createInstance()

void domainI18n.init({
  // Every catalog already in memory: nl-BE, or all languages when tests registered them.
  resources: Object.fromEntries(
    DOMAIN_LANGUAGES.flatMap((language) => {
      const catalog = getLoadedLocaleCatalog(language)
      return catalog ? [[language, { translation: catalog }]] : []
    })
  ),
  lng: 'nl-BE',
  fallbackLng: 'nl-BE',
  initAsync: false,
  interpolation: { escapeValue: false },
})

/** Add an in-memory catalog to the instance; false when it still has to be downloaded. */
function attachLoadedCatalog(language: DomainLanguage): boolean {
  if (domainI18n.hasResourceBundle(language, 'translation')) return true
  const catalog = getLoadedLocaleCatalog(language)
  if (!catalog) return false
  domainI18n.addResourceBundle(language, 'translation', catalog)
  return true
}

/** True when the language translates synchronously right now. */
export function isDomainLanguageLoaded(language: string | null | undefined): boolean {
  return attachLoadedCatalog(normalizeDomainLanguage(language))
}

/** Download a language's catalog if needed; afterwards it translates synchronously. */
export async function ensureDomainLanguage(language: string | null | undefined): Promise<DomainLanguage> {
  const normalized = normalizeDomainLanguage(language)
  if (!attachLoadedCatalog(normalized)) {
    await loadLocaleCatalog(normalized)
    attachLoadedCatalog(normalized)
  }
  return normalized
}

let requestedLanguage: DomainLanguage = 'nl-BE'

export function setDomainLanguage(language: string | null | undefined): void {
  const normalized = normalizeDomainLanguage(language)
  requestedLanguage = normalized
  if (domainI18n.language === normalized) return
  if (!attachLoadedCatalog(normalized)) {
    // Keep the previous language until the catalog arrives instead of showing fallback text.
    ensureDomainLanguage(normalized)
      .then(() => {
        if (requestedLanguage === normalized) setDomainLanguage(normalized)
      })
      .catch((error: unknown) => logger.warn('[domainI18n] language load failed:', normalized, error))
    return
  }
  void domainI18n.changeLanguage(normalized)
}

/** A locale-bound translator for deterministic domain-generated labels. */
export function getDomainTranslator(language: string | null | undefined) {
  const locale = normalizeDomainLanguage(language == null ? domainI18n.language : language)
  if (!attachLoadedCatalog(locale)) {
    // Falls back to nl-BE for this call; callers that need the language await ensureDomainLanguage.
    ensureDomainLanguage(locale).catch((error: unknown) =>
      logger.warn('[domainI18n] language load failed:', locale, error)
    )
  }
  return domainI18n.getFixedT(locale)
}

export default domainI18n
