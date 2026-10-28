import nlBE from '@/locales/nl-BE.json'

export const DOMAIN_LANGUAGES = ['nl-BE', 'en', 'fr-BE', 'de', 'pl', 'ro'] as const
export type DomainLanguage = (typeof DOMAIN_LANGUAGES)[number]

export type LocaleCatalog = { symbols: Record<string, unknown> } & Record<string, unknown>

/** Normalize browser, project, and test locale values to the catalogs the app ships. */
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
 * Each catalog is ~250 KB. Only the fallback language is bundled; the others become
 * separate chunks so a session downloads just the language it uses.
 */
const catalogLoaders: Record<Exclude<DomainLanguage, 'nl-BE'>, () => Promise<{ default: LocaleCatalog }>> = {
  en: () => import('@/locales/en.json'),
  'fr-BE': () => import('@/locales/fr-BE.json'),
  de: () => import('@/locales/de.json'),
  pl: () => import('@/locales/pl.json'),
  ro: () => import('@/locales/ro.json'),
}

const loadedCatalogs = new Map<DomainLanguage, LocaleCatalog>([['nl-BE', nlBE]])
const pendingCatalogs = new Map<DomainLanguage, Promise<LocaleCatalog>>()

/** The catalog when it is already in memory, so synchronous callers can use it immediately. */
export function getLoadedLocaleCatalog(language: DomainLanguage): LocaleCatalog | undefined {
  return loadedCatalogs.get(language)
}

export function loadLocaleCatalog(language: DomainLanguage): Promise<LocaleCatalog> {
  const loaded = loadedCatalogs.get(language)
  if (loaded) return Promise.resolve(loaded)
  const pending = pendingCatalogs.get(language)
  if (pending) return pending
  const promise = catalogLoaders[language as Exclude<DomainLanguage, 'nl-BE'>]()
    .then((module) => {
      loadedCatalogs.set(language, module.default)
      return module.default
    })
    .finally(() => pendingCatalogs.delete(language))
  pendingCatalogs.set(language, promise)
  return promise
}

/** Make a catalog available synchronously, e.g. so tests can switch languages without awaiting. */
export function registerLocaleCatalog(language: DomainLanguage, catalog: LocaleCatalog): void {
  loadedCatalogs.set(language, catalog)
}
