import validationI18n, { ensureDomainLanguage, setDomainLanguage } from '@/lib/i18n/domainI18n'

export function setValidationLanguage(language: string | null | undefined): void {
  setDomainLanguage(language)
}

/** Download the language's catalog if needed, then select it for synchronous validation. */
export async function prepareValidationLanguage(language: string | null | undefined): Promise<void> {
  setDomainLanguage(await ensureDomainLanguage(language))
}

export default validationI18n
