import { normalizeSupportedLanguage, type SupportedLanguage } from '../../utils/languageRouting.ts'

export interface ValidationAreiLink {
  path: string
  hash?: string
  hashByLanguage?: Partial<Record<SupportedLanguage, string>>
}

const DEFAULT_VALIDATION_AREI_LINK: ValidationAreiLink = {
  path: '/issues',
}

const NL_AREI_PATHS: Record<string, string> = {
  '/issues': '/arei-regels',
  '/issues/protection': '/arei-regels/bescherming',
  '/issues/overcurrent-protection': '/arei-regels/overstroombeveiliging',
  '/issues/breaker-vs-cross-section': '/arei-regels/automaat-vs-kabeldoorsnede',
  '/issues/circuit-structure': '/arei-regels/stroombaanstructuur',
  '/issues/wiring-installation': '/arei-regels/bekabeling-plaatsing',
  '/issues/special-environments': '/arei-regels/bijzondere-omgevingen',
  '/issues/documentation-inspection-responsibility':
    '/arei-regels/documentatie-keuring-verantwoordelijkheid',
}

export const VALIDATION_AREI_LINKS: Record<string, ValidationAreiLink> = {
  'be.areibook1.2025.household-breaking-capacity': {
    path: '/issues/overcurrent-protection', hash: 'overload-short-circuit',
  },
  'be.areibook1.2025.household-supply-breaking-capacity': {
    path: '/issues/overcurrent-protection', hash: 'overload-short-circuit',
  },
  'be.areibook1.2025.maximum-protected-length': {
    path: '/issues/wiring-installation', hash: 'wiring-data',
  },
  'be.areibook1.2025.short-circuit-verification': {
    path: '/issues/overcurrent-protection', hash: 'overload-short-circuit',
  },
  'be.areibook1.2025.supply-mode-paths': {
    path: '/issues/special-environments',
    hash: 'pv_batterij',
  },
  'be.areibook1.2025.supply-conductor-protection-coordination': {
    path: '/issues/overcurrent-protection',
    hash: 'protection-cable',
  },
  'be.areibook1.2025.diagram-sitplan-consistency': {
    path: '/issues/documentation-inspection-responsibility',
    hash: 'schema_soorten',
    hashByLanguage: { de: 'schema_types', pl: 'schema_types', ro: 'schema_types' },
  },
  'be.areibook1.2025.hidden-situation-plan-symbols': {
    path: '/issues/documentation-inspection-responsibility',
    hash: 'schema_soorten',
    hashByLanguage: { de: 'schema_types', pl: 'schema_types', ro: 'schema_types' },
  },
  'be.areibook1.2025.unplaced-situation-plan-symbols': {
    path: '/issues/documentation-inspection-responsibility',
    hash: 'schema_soorten',
    hashByLanguage: { de: 'schema_types', pl: 'schema_types', ro: 'schema_types' },
  },
  'be.areibook1.2025.sources-consistency': {
    path: '/issues/documentation-inspection-responsibility',
    hash: 'schema_eigenschappen',
  },
  'be.areibook1.2025.nonhousehold-board-grounded-network': {
    path: '/issues/protection',
    hash: 'earthing',
  },
  'be.areibook1.2025.installation-earthing': {
    path: '/issues/protection',
    hash: 'earthing',
  },
  'be.areibook1.2025.multiple-earthing-locations': {
    path: '/issues/protection',
    hash: 'earthing',
  },
  'be.areibook1.2025.nonhousehold-board-numbering': {
    path: '/issues/documentation-inspection-responsibility',
    hash: 'schema_eigenschappen',
  },
  'be.areibook1.2025.nonhousehold-circuit-cable-length': {
    path: '/issues/wiring-installation',
    hash: 'wiring-data',
  },
  'be.areibook1.2025.main-rcd': {
    path: '/issues/protection',
    hash: 'main-rcd',
  },
  'be.areibook1.2025.backup-supply-rcd': {
    path: '/issues/protection',
    hash: 'main-rcd',
  },
  'be.areibook1.2025.board-global-isolation': {
    path: '/issues/protection',
    hash: 'protection-checks',
  },
  'be.areibook1.2025.board-local-isolation-hint': {
    path: '/issues/protection',
    hash: 'protection-checks',
  },
  'be.areibook1.2025.duplicate-panel-protection-label': {
    path: '/issues/documentation-inspection-responsibility',
    hash: 'schema_eigenschappen',
  },
  'be.areibook1.2025.control-link-integrity': {
    path: '/issues/documentation-inspection-responsibility',
    hash: 'schema_eigenschappen',
  },
  'be.areibook1.2025.converter-backup-labels': {
    path: '/issues/special-environments',
    hash: 'pv_batterij',
  },
  'be.areibook1.2025.phase-protection-compatibility': {
    path: '/issues/protection',
    hash: 'protection-checks',
  },
  'be.areibook1.2025.overcurrent-upstream': {
    path: '/issues/overcurrent-protection',
    hash: 'protection-cable',
  },
  'be.areibook1.2025.rcd-grouping': {
    path: '/issues/protection',
    hash: 'main-rcd',
  },
  'be.areibook1.2025.rcd-selectivity': {
    path: '/issues/protection',
    hash: 'main-rcd',
  },
  'be.areibook1.2025.bathroom-rcd-30ma': {
    path: '/issues/special-environments',
    hash: 'badkamer',
    hashByLanguage: {
      en: 'bathroom',
      'fr-BE': 'bathroom',
    },
  },
  'be.areibook1.2025.minimum-lighting-circuits': {
    path: '/issues/circuit-structure',
    hash: 'lichtpunten',
  },
  'be.areibook1.2025.max-endpoints-per-circuit': {
    path: '/issues/circuit-structure',
    hash: 'contactdozen',
    hashByLanguage: { de: 'sockets', pl: 'sockets', ro: 'sockets' },
  },
  'be.areibook1.2025.cable-cross-section': {
    path: '/issues/wiring-installation',
    hash: 'wiring-data',
  },
  'be.areibook1.2025.breaker-vs-cross-section': {
    path: '/issues/breaker-vs-cross-section',
    hash: 'protection-cable',
  },
  'be.areibook1.2025.rcd-required-by-circuit-type': {
    path: '/issues/protection',
    hash: 'main-rcd',
  },
  'be.areibook1.2025.minimum-cross-section': {
    path: '/issues/wiring-installation',
    hash: 'protection-cable',
  },
  'be.areibook1.2025.heavy-appliance-dedicated-circuit': {
    path: '/issues/circuit-structure',
    hash: 'vaste_toestellen',
    hashByLanguage: { de: 'fixed_devices', pl: 'fixed_devices', ro: 'fixed_devices' },
  },
  'be.areibook1.2025.fixed-appliance-dedicated-hint': {
    path: '/issues/circuit-structure',
    hash: 'vaste_toestellen',
    hashByLanguage: { de: 'fixed_devices', pl: 'fixed_devices', ro: 'fixed_devices' },
  },
  'be.areibook1.2025.stove-sizing-hint': {
    path: '/issues/circuit-structure',
    hash: 'vaste_toestellen',
    hashByLanguage: { de: 'fixed_devices', pl: 'fixed_devices', ro: 'fixed_devices' },
  },
  'be.areibook1.2025.cascade-protection': {
    path: '/issues/overcurrent-protection',
    hash: 'protection-cable',
  },
  'be.areibook1.2025.switch-load-reference': {
    path: '/issues/circuit-structure',
    hash: 'codes',
  },
  'be.areibook1.2025.switch-sequence': {
    path: '/issues/circuit-structure',
    hash: 'codes',
  },
  'be.areibook1.2025.electrical-domain': {
    path: '/issues/special-environments',
    hash: 'pv_batterij',
  },
  'be.areibook1.2025.dc-cross-section-heuristic': {
    path: '/issues/special-environments',
    hash: 'pv_batterij',
  },
  'be.areibook1.2025.post-main-bus-pe-conductor': {
    path: '/issues/protection',
    hash: 'earthing',
  },
  'be.areibook1.2025.eendraad-orphans': {
    path: '/issues/documentation-inspection-responsibility',
    hash: 'schema_soorten',
    hashByLanguage: { de: 'schema_types', pl: 'schema_types', ro: 'schema_types' },
  },
}

export function getValidationAreiLink(ruleId: string): ValidationAreiLink {
  return Object.prototype.hasOwnProperty.call(VALIDATION_AREI_LINKS, ruleId)
    ? VALIDATION_AREI_LINKS[ruleId]!
    : DEFAULT_VALIDATION_AREI_LINK
}

export function getLocalizedValidationAreiPath(link: ValidationAreiLink, language: SupportedLanguage): string {
  return language === 'nl-BE' ? NL_AREI_PATHS[link.path] ?? link.path : link.path
}

export function getValidationAreiHash(link: ValidationAreiLink, language: SupportedLanguage): string | undefined {
  return link.hashByLanguage?.[language] ?? link.hash
}

/** Canonical public URL, independent of the browser host or a running companion site. */
export function getCanonicalValidationAreiUrl(ruleId: string, requestedLanguage: string): string {
  const language = normalizeSupportedLanguage(requestedLanguage) ?? 'en'
  const link = getValidationAreiLink(ruleId)
  const prefix = language === 'nl-BE' ? 'nl' : language === 'fr-BE' ? 'fr' : language
  const hash = getValidationAreiHash(link, language)
  return `https://arei.condui.be/${prefix}${getLocalizedValidationAreiPath(link, language)}${hash ? `#${hash}` : ''}`
}
