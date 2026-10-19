import { z } from 'zod'

/** Keep free-text foreign addresses intact while canonicalizing supported names and codes. */
export function normalizeAddressCountry(country: string): string {
  const trimmed = country.trim()
  const name = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (['belgium', 'belgie', 'belgique', 'belgien', 'belgia'].includes(name)) return 'BE'
  return /^[a-z]{2}$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed
}

export const addressCountrySchema = z.string()
  .describe('Country code, for example BE for Belgium. Belgian names in the supported editor languages are normalized to BE; other country names are preserved and may have no validation rules.')
  .transform(normalizeAddressCountry)
