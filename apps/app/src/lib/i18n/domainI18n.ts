import de from '@/locales/de.json'
import pl from '@/locales/pl.json'
import ro from '@/locales/ro.json'
import { createInstance } from 'i18next'
import nlBE from '@/locales/nl-BE.json'
import frBE from '@/locales/fr-BE.json'
import en from '@/locales/en.json'

export const DOMAIN_LANGUAGES = ['nl-BE', 'en', 'fr-BE', 'de', 'pl', 'ro'] as const
export type DomainLanguage = (typeof DOMAIN_LANGUAGES)[number]

/** Normalize browser, project, and test locale values to the catalogs domain code owns. */
export function normalizeDomainLanguage(language: string | null | undefined): DomainLanguage {
  const normalized = language?.trim().replace('_', '-').toLowerCase()
  if (!normalized) return 'nl-BE'
  if (normalized === 'nl' || normalized.startsWith('nl-')) return 'nl-BE'
  if (normalized === 'fr' || normalized.startsWith('fr-')) return 'fr-BE'
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  if (normalized === 'de' || normalized.startsWith('de-')) return 'de'
  if (normalized === 'pl' || normalized.startsWith('pl-')) return 'pl'
  if (normalized === 'ro' || normalized.startsWith('ro-')) return 'ro'
  return 'nl-BE'
}

/**
 * React-free translation instance for domain code shared with web workers.
 * The browser i18n bootstrap and each worker request synchronize its language.
 */
const domainI18n = createInstance()

void domainI18n.init({
  resources: {
    de: { translation: de },
    pl: { translation: pl },
    ro: { translation: ro },
    'nl-BE': { translation: nlBE },
    'fr-BE': { translation: frBE },
    en: { translation: en },
  },
  lng: 'nl-BE',
  fallbackLng: 'nl-BE',
  initAsync: false,
  interpolation: { escapeValue: false },
})

export function setDomainLanguage(language: string | null | undefined): void {
  const normalized = normalizeDomainLanguage(language)
  if (domainI18n.language === normalized) return
  void domainI18n.changeLanguage(normalized)
}

/** A locale-bound translator for deterministic domain-generated labels. */
export function getDomainTranslator(language: string | null | undefined) {
  const locale = language == null ? normalizeDomainLanguage(domainI18n.language) : language
  return domainI18n.getFixedT(normalizeDomainLanguage(locale))
}

export default domainI18n
