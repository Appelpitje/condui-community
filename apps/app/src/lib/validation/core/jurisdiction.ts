import { normalizeAddressCountry } from '@/lib/properties/addressCountry'

/** Resolve the ruleset jurisdiction, defaulting projects without a country to Belgium. */
export function getValidationJurisdiction(country: string | null | undefined): string {
  return (country && normalizeAddressCountry(country)) || 'BE'
}
