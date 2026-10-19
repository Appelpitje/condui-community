import { normalizeSupportedLanguage } from '@/utils/languageRouting'
import { getCompanionSiteUrl } from '@/utils/mainAppUrl'
import { SYMBOL_ILLUSTRATION_IDS } from '../../../arei/src/lib/symbolIllustrations'

// Read the AREI source directly so gallery help follows edits and translations there.
const sources = import.meta.glob<string>(
  '../../../arei/src/content/arei-content/*/symbols.md',
  { query: '?raw', import: 'default', eager: true },
)
const descriptions = new Map<string, Map<string, string>>()

export function getSymbolReferenceDescription(symbolId: string, language: string): string | undefined {
  const locale = normalizeSupportedLanguage(language) ?? 'nl-BE'
  let catalog = descriptions.get(locale)
  if (!catalog) {
    const source = sources[`../../../arei/src/content/arei-content/${locale}/symbols.md`] ?? ''
    catalog = new Map()
    for (const match of source.matchAll(/^### \[([^\]]+)\][^\n]*\n([\s\S]*?)(?=^#{1,3} |(?![\s\S]))/gm)) {
      if (match[1] && match[2]) catalog.set(match[1], match[2].trim().replaceAll('{{brand}}', 'Condui'))
    }
    descriptions.set(locale, catalog)
  }
  return catalog.get(symbolId)
}

export function getSymbolReferenceUrl(symbolId: string, language: string): string {
  const locale = normalizeSupportedLanguage(language) ?? 'nl-BE'
  const path = locale === 'nl-BE' ? 'symbolen' : 'symbols'
  return `${getCompanionSiteUrl('arei', locale)}${path}/?open=${encodeURIComponent(symbolId)}`
}

export function hasSymbolReferenceIllustration(symbolId: string): boolean {
  return SYMBOL_ILLUSTRATION_IDS.has(symbolId)
}
