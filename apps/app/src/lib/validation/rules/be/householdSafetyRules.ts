import type { RuleDef, ScopeType } from '../../core/types'

const definitions: Array<[string, string, ScopeType, string, Record<string, unknown>?]> = [
  ['rcd-waveform', 'householdRcdWaveform', 'board', 'rcdType'],
  ['breaking-capacity-known', 'householdBreakingCapacityKnown', 'board', 'breakingCapacity'],
  ['earthing-separator', 'installationHasEarthingSeparator', 'board', 'earthingSeparator'],
  ['socket-safety', 'householdSocketSafety', 'circuit', 'socketSafety'],
  ['socket-protection', 'householdSocketProtection', 'circuit', 'socketProtection'],
  ['cable-placement-known', 'circuitCableSpecifications', 'circuit', 'placement'],
  [
    'cable-fire-class-known',
    'circuitCableSpecifications',
    'circuit',
    'fireClass',
    { field: 'fireClass' },
  ],
  ['ev-upstream-dc-coordination', 'evUpstreamDcCoordination', 'board', 'evCoordination'],
  ['rcd-overload-coordination', 'householdRcdOverloadCoordination', 'board', 'rcdOverload'],
]

const sections: Record<string, string> = {
  rcdType: '§ 5.3.5.3',
  breakingCapacity: '§ 5.3.5.5(e)',
  earthingSeparator: '§ 5.4.3.5',
  socketSafety: '§ 5.3.5.2',
  socketProtection: '§ 5.3.5.2',
  placement: '§ 3.1.2.2',
  evCoordination: '§ 5.3.5.3(f), § 7.22.4.1',
  rcdOverload: '§ 4.4.1, § 5.3.5.3',
}

/** Completeness warnings are separate from known electrical violations. */
export const householdSafetyRules: RuleDef[] = definitions.map(
  ([id, name, scope, key, params]) => ({
    id: `be.areibook1.2025.${id}`,
    title: id,
    severity: ['rcdType', 'socketSafety', 'socketProtection', 'rcdOverload'].includes(key) ? 'error' : 'warning',
    appliesTo: [scope],
    checks: [{ name, ...(params ? { params } : {}) }],
    message: `validation.primitives.feedbackSafety.${key}.message`,
    details: `validation.primitives.feedbackSafety.${key}.details`,
    citations: sections[key]
      ? [
          {
            code: 'AREI',
            title: 'Algemeen Reglement op de Elektrische Installaties',
            section: sections[key],
          },
        ]
      : [],
    tags: ['safety', 'completeness'],
  })
)
