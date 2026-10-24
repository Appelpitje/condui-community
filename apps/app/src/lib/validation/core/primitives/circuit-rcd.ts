import { registerPrimitive } from './registry'
import type {
  CheckContext,
  CheckResult,
  Issue,
  ValidationProject,
  InstallationQueryAPI,
  Panel,
} from './common'
import { isHouseholdInstallation } from '@/lib/installationProfile'
import {
  i18n,
  isPanelPlacementCarrierCircuit,
  projectPanels,
  projectInstallation,
  validationCircuitCode,
} from './common'
import { isBelgianInstallation } from './earthing'
import { resolveEffectiveEarthingSystem } from '@/lib/panel/panelEarthingSync'
import type { ResidualCurrentType } from '@/types/schema'
import { circuitUpstreamProtections } from '../../upstreamProtection'

const FIXED_LOAD_ONLY_CIRCUIT_KINDS = new Set([
  'fixed_appliance',
  'boiler',
  'heating',
  'stove',
  'hvac',
])

function normalizeForFuzzyMatch(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s_/\\\-.,;:()[\]{}'"“”‘’`~!?@#$%^&*+=|<>]+/g, ' ')
    .trim()
}

function findPanelOwningCircuit(panels: Panel[], circuitId: string): Panel | undefined {
  for (const panel of panels) {
    if (panel.circuits.some((c) => c.id === circuitId)) return panel
    if (panel.protections.some((p) => p.circuits?.some((c) => c.id === circuitId))) return panel

    const child = findPanelOwningCircuit(panel.subPanels, circuitId)
    if (child) return child
  }

  return undefined
}

type RcdProtectionDetails = {
  sensitivityMa?: number
  residualCurrentType?: ResidualCurrentType
}

function getRcdProtectionDetailsForCircuit(
  query: InstallationQueryAPI,
  project: ValidationProject,
  circuitId: string
): RcdProtectionDetails[] {
  return circuitUpstreamProtections({ query, project, scope: { type: 'circuit', id: circuitId } }, circuitId)
    .filter((device) => device.type === 'RCD' || device.type === 'RCBO').map((device) => ({
    sensitivityMa: device.sensitivityMa,
    residualCurrentType: device.residualCurrentType,
  }))
}

function unknownRcdSensitivity(circuitId: string, circuitCode: string, panelKey: string): CheckResult {
  return {
    passed: false,
    offenders: [{ kind: 'circuit', id: circuitId, viewHint: 'eendraad' }],
    mergeBucket: `${panelKey}:unknown-sensitivity`,
    coverage: {
      status: 'missing-information',
      reason: 'upstream-rcd-sensitivity-not-entered',
      missingFacts: ['upstream RCD/RCBO residual-current sensitivity (mA)'],
    },
    message: i18n.t('validation.primitives.circuitHasRcdProtection.sensitivityMissing.message', {
      circuitCode: validationCircuitCode(circuitCode),
    }),
    details: i18n.t('validation.primitives.circuitHasRcdProtection.sensitivityMissing.details'),
    remediation: i18n.t('validation.primitives.circuitHasRcdProtection.sensitivityMissing.remediation'),
  }
}

/**
 * Enforce that certain circuit types have 30 mA RCD/RCBO protection.
 *
 * Requires 30 mA protection for the household circuits named in 4.2.4.3(b),
 * plus EV charging circuits under 7.22.4.1, including protection against
 * disruptive DC components under 5.3.5.3(f):
 * - lighting;
 * - general-purpose sockets (not a socket dedicated to a modeled fixed load);
 * - washers, dryers and dishwashers;
 * - EV charging circuits.
 *
 * We consider both panel-level RCD/RCBO devices and the owning root panel's
 * supply feed devices as valid protection for the circuit.
 */
function circuitHasRcdProtection(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query, project } = context
  if (scope.type !== 'circuit') return { passed: true }

  const circuit = query.getCircuitById(scope.id)
  if (!circuit) return { passed: true }

  const country = projectInstallation(project)?.address?.country
  if (country && country !== 'BE') {
    return { passed: true }
  }

  const kind = query.getCircuitKind(scope.id)
  const household = isHouseholdInstallation(projectInstallation(project))
  const endpointsById = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  const socketsDedicatedToFixedLoads = new Set<string>()
  for (const branch of circuit.branches ?? []) {
    const branchEndpoints = (branch.endpointIds ?? [])
      .map((id) => endpointsById.get(id))
      .filter((endpoint): endpoint is NonNullable<typeof endpoint> => endpoint != null)
    if (!branchEndpoints.some((endpoint) => endpoint.type === 'fixed_appliance')) continue
    for (const endpoint of branchEndpoints) {
      if (endpoint.type === 'socket') socketsDedicatedToFixedLoads.add(endpoint.id)
    }
  }
  const hasGeneralPurposeSocket = circuit.endpoints.some(
    (endpoint) => endpoint.type === 'socket' && !socketsDedicatedToFixedLoads.has(endpoint.id),
  )
  // Some legacy projects do not persist branch membership. The derived kind still
  // tells us that a circuit containing only fixed appliances (and their possible
  // dedicated connection socket) is not a general-purpose socket circuit. Keep
  // explicit branch topology authoritative when it is available so a genuinely
  // mixed circuit with an extra socket remains subject to the 30 mA rule.
  const hasCompleteBranchTopology =
    (circuit.branches?.length ?? 0) > 0 &&
    circuit.endpoints.every((endpoint) =>
      circuit.branches?.some((branch) => branch.endpointIds.includes(endpoint.id)),
    )
  const fixedLoadOnlyWithoutBranches =
    !hasCompleteBranchTopology && FIXED_LOAD_ONLY_CIRCUIT_KINDS.has(kind)
  const hasGeneralPurposeSocketForRule =
    hasGeneralPurposeSocket && !fixedLoadOnlyWithoutBranches
  const hasNamedLaundryAppliance = circuit.endpoints.some(
    (endpoint) =>
      endpoint.symbol === 'washer' ||
      endpoint.symbol === 'dryer' ||
      endpoint.symbol === 'dishwasher',
  )
  const needsRcd =
    kind === 'ev' ||
    (household &&
      (kind === 'lighting' || hasGeneralPurposeSocketForRule || hasNamedLaundryAppliance))
  if (!needsRcd) return { passed: true }

  const rcdProtections = getRcdProtectionDetailsForCircuit(query, project, scope.id)
  const allRcdsSensitivity = rcdProtections
    .map((rcd) => rcd.sensitivityMa)
    .filter((sensitivity): sensitivity is number => sensitivity != null)
  const owningPanel = findPanelOwningCircuit(projectPanels(project), scope.id)
  const panelKey = owningPanel?.id ?? 'unknown-panel'

  if (rcdProtections.length === 0) {
    return {
      passed: false,
      offenders: [{ kind: 'circuit', id: circuit.id, viewHint: 'eendraad' }],
      // Panel + violation shape only: same upstream fix (e.g. add/select 30 mA RCD) applies to every affected circuit on this board.
      mergeBucket: `${panelKey}:missing`,
      message: i18n.t('validation.primitives.circuitHasRcdProtection.missing.message', {
        circuitCode: validationCircuitCode(circuit.code),
        defaultValue: `Circuit ${circuit.code} requires RCD/RCBO protection (30 mA), but none was found upstream`,
      }),
      details: i18n.t('validation.primitives.circuitHasRcdProtection.missing.details', {
        circuitCode: validationCircuitCode(circuit.code),
        defaultValue:
          'Lighting, general-purpose socket, washer, dryer, dishwasher and EV charging circuits require 30 mA residual-current protection. Add an RCD or RCBO upstream or route this circuit through an existing 30 mA device.',
      }),
    }
  }

  const has30mA = allRcdsSensitivity.some((s) => s <= 30)
  if (!has30mA && rcdProtections.some((rcd) => rcd.sensitivityMa == null)) {
    return unknownRcdSensitivity(circuit.id, circuit.code, panelKey)
  }
  if (has30mA) {
    if (kind !== 'ev') return { passed: true }

    const hasIntegratedDcResidualProtection = circuit.endpoints.filter((endpoint) => endpoint.symbol === 'ev').every(
      (endpoint) =>
        endpoint.evChargerProps?.integratedDcResidualProtection === true,
    )
    const hasTypeBRcd = rcdProtections.some(
      (rcd) => rcd.residualCurrentType === 'B' && (rcd.sensitivityMa ?? Number.POSITIVE_INFINITY) <= 30,
    )

    if (hasIntegratedDcResidualProtection || hasTypeBRcd) return { passed: true }

    return {
      passed: false,
      offenders: [{ kind: 'circuit', id: circuit.id, viewHint: 'eendraad' }],
      mergeBucket: `${panelKey}:dc-compatibility`,
      message: i18n.t('validation.primitives.circuitHasRcdProtection.dcCompatibility.message', {
        circuitCode: validationCircuitCode(circuit.code),
        defaultValue: `EV charging circuit ${circuit.code} has 30 mA RCD protection, but no protection against disruptive DC fault current was identified`,
      }),
      details: i18n.t('validation.primitives.circuitHasRcdProtection.dcCompatibility.details', {
        circuitCode: validationCircuitCode(circuit.code),
        defaultValue:
          'AREI 7.22.4.1 and 5.3.5.3(f) require the charging point to remain protected against disruptive DC components. Use a Type B RCD, or mark the charger as having coordinated built-in DC residual-current protection/detection (such as 6 mA DC detection).',
      }),
    }
  }

  const detectedSensitivities = Array.from(new Set(allRcdsSensitivity)).sort((a, b) => a - b)
  const detectedSensitivitiesLabel = detectedSensitivities.map((s) => `${s} mA`).join(', ')

  return {
    passed: false,
    offenders: [{ kind: 'circuit', id: circuit.id, viewHint: 'eendraad' }],
    mergeBucket: `${panelKey}:sensitivity`,
    message: i18n.t('validation.primitives.circuitHasRcdProtection.sensitivity.message', {
      circuitCode: validationCircuitCode(circuit.code),
      defaultValue: `Circuit ${circuit.code} is protected by RCD(s), but none have 30 mA sensitivity`,
    }),
    details: i18n.t('validation.primitives.circuitHasRcdProtection.sensitivity.details', {
      circuitCode: validationCircuitCode(circuit.code),
      detectedSensitivities: detectedSensitivitiesLabel,
      defaultValue:
        `Lighting, general-purpose socket, washer, dryer, dishwasher and EV charging circuits require 30 mA residual-current protection. ` +
        `Detected upstream RCD sensitivities for this circuit: ${detectedSensitivitiesLabel || 'none'}. ` +
        'Adjust the sensitivity of the upstream RCD/RCBO for this circuit to 30 mA or route it through a 30 mA device.',
    }),
  }
}

/**
 * AREI Book 1 (2025) — Rooms containing a bath and/or shower:
 * Circuits feeding these rooms must be protected by a high/very high sensitivity
 * residual current device (commonly 30 mA).
 *
 * We cannot reliably detect room type from geometry, so we use a heuristic:
 * If the circuit notes mention bathroom/bath/shower terms (in any language),
 * then enforce 30 mA RCD/RCBO protection.
 *
 * Notes mentioning only "toilet/WC" do NOT trigger this rule by themselves.
 */
function wetRoomRequires30mAFromCircuitNotes(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query, project } = context
  if (scope.type !== 'circuit') return { passed: true }

  const circuit = query.getCircuitById(scope.id)
  if (!circuit) return { passed: true }

  const country = projectInstallation(project)?.address?.country
  if (country && country !== 'BE') return { passed: true }

  const notes = circuit.notes?.trim()
  if (!notes) return { passed: true }

  const norm = normalizeForFuzzyMatch(notes)

  const toiletOnlyTerms = /\b(wc|toilet|toiletten|toilettes)\b/i
  const bathroomTerms: Array<{ id: string; re: RegExp }> = [
    // Dutch
    { id: 'badkamer', re: /\b(badkamer|douchekamer|bad\s*en\s*douche)\b/i },
    // French
    { id: 'salle_de_bain', re: /\b(salle\s+de\s+bain(s)?|piece\s+d\s*eau|piece\s+d\s*['’]eau)\b/i },
    { id: 'douche', re: /\b(douche|baignoire)\b/i },
    // English
    { id: 'bathroom', re: /\b(bath\s*room|bathroom|wet\s*room|shower)\b/i },
  ]

  const matched = bathroomTerms.filter((t) => t.re.test(norm)).map((t) => t.id)
  if (matched.length === 0) {
    // If the note is about toilets only, do not treat this as a wet room signal.
    if (toiletOnlyTerms.test(norm)) return { passed: true }
    return { passed: true }
  }

  const rcds = getRcdProtectionDetailsForCircuit(query, project, scope.id)
  if (rcds.some((rcd) => rcd.sensitivityMa != null && rcd.sensitivityMa <= 30)) {
    return { passed: true }
  }
  if (rcds.some((rcd) => rcd.sensitivityMa == null)) {
    const panel = findPanelOwningCircuit(projectPanels(project), circuit.id)
    return unknownRcdSensitivity(circuit.id, circuit.code, panel?.id ?? 'unknown-panel')
  }

  return {
    passed: false,
    offenders: [{ kind: 'circuit', id: circuit.id, viewHint: 'eendraad' }],
    message: i18n.t('validation.primitives.wetRoomRequires30mAFromCircuitNotes.message', {
      circuitCode: validationCircuitCode(circuit.code),
      defaultValue: `Circuit ${circuit.code} appears to feed a bathroom (notes), but has no 30 mA RCD/RCBO protection`,
    }),
    details: i18n.t('validation.primitives.wetRoomRequires30mAFromCircuitNotes.details', {
      circuitCode: validationCircuitCode(circuit.code),
      matched: matched.join(', '),
      defaultValue:
        'This rule was triggered because the circuit notes contain bathroom/bath/shower keywords. AREI requires circuits supplying rooms with a bath and/or shower to be protected by high/very high sensitivity residual current protection (typically 30 mA). Add an upstream 30 mA RCD or use an RCBO with 30 mA sensitivity for this circuit.',
    }),
  }
}

/** AREI table 2.3: conventional touch-voltage limit UL for dry conditions (BB1). */
const CONVENTIONAL_TOUCH_VOLTAGE_LIMIT_V = 50

/**
 * AREI 4.2.4.4(b, d): in a non-household TT installation, automatic disconnection relies on
 * residual-current protection with IΔn × RE ≤ UL. Circuits without any RCD path are reported
 * because overcurrent devices alone cannot disconnect in time on a TT earth electrode.
 */
function nonHouseholdTtIndirectContact(context: CheckContext): CheckResult {
  const { scope, query, project } = context
  if (scope.type !== 'circuit') return { passed: true }
  const installation = projectInstallation(project)
  if (isHouseholdInstallation(installation) || !isBelgianInstallation(installation)) {
    return { passed: true }
  }
  if (isPanelPlacementCarrierCircuit(query, scope.id)) return { passed: true }
  const circuit = query.getCircuitById(scope.id)
  if (!circuit || circuit.endpoints.length === 0 || circuit.subCircuitIds?.length) {
    return { passed: true }
  }
  const panels = projectPanels(project)
  const owningPanel = findPanelOwningCircuit(panels, scope.id)
  if (!owningPanel || resolveEffectiveEarthingSystem(owningPanel, panels) !== 'TT') {
    return { passed: true, coverage: { status: 'skipped', reason: 'tt-indirect-contact-rule-requires-tt-board' } }
  }

  const rcds = getRcdProtectionDetailsForCircuit(query, project, scope.id)
  const offenders = [{ kind: 'circuit' as const, id: circuit.id, viewHint: 'eendraad' as const }]
  const circuitCode = validationCircuitCode(circuit.code)
  if (rcds.length === 0) {
    return {
      passed: false,
      offenders,
      mergeBucket: `${owningPanel.id}:missing`,
      message: i18n.t('validation.primitives.nonHouseholdTtIndirectContact.missing.message', {
        circuitCode,
        defaultValue: `Circuit ${circuitCode} has no residual-current protection on a TT network`,
      }),
      details: i18n.t('validation.primitives.nonHouseholdTtIndirectContact.missing.details', {
        defaultValue:
          'On a TT network, overcurrent devices alone do not disconnect an earth fault in time. Protect the circuit with an RCD or RCBO, or use class II equipment, SELV or electrical separation.',
      }),
    }
  }

  const resistance = installation?.earthResistanceOhm
  const sensitivities = rcds
    .map((rcd) => rcd.sensitivityMa)
    .filter((value): value is number => value != null && value > 0)
  if (resistance == null || resistance <= 0 || sensitivities.length === 0) {
    return {
      passed: true,
      coverage: {
        status: 'missing-information',
        reason: 'earth-resistance-or-rcd-sensitivity-unknown',
        missingFacts: ['earth electrode resistance', 'RCD sensitivity (mA)'],
      },
    }
  }
  const sensitivityMa = Math.min(...sensitivities)
  const touchVoltageV = (sensitivityMa / 1000) * resistance
  if (touchVoltageV <= CONVENTIONAL_TOUCH_VOLTAGE_LIMIT_V) {
    return { passed: true, coverage: { status: 'passed' } }
  }
  const maxSensitivityMa = Math.floor((CONVENTIONAL_TOUCH_VOLTAGE_LIMIT_V / resistance) * 1000)
  return {
    passed: false,
    offenders,
    mergeBucket: `${owningPanel.id}:insensitive:${sensitivityMa}`,
    message: i18n.t('validation.primitives.nonHouseholdTtIndirectContact.insensitive.message', {
      circuitCode,
      sensitivityMa,
      defaultValue: `Circuit ${circuitCode}: ${sensitivityMa} mA RCD is not sensitive enough for the earth resistance`,
    }),
    details: i18n.t('validation.primitives.nonHouseholdTtIndirectContact.insensitive.details', {
      sensitivityMa,
      ohm: String(Math.round(resistance * 10) / 10),
      maxSensitivityMa,
      defaultValue: `IΔn × RE must not exceed 50 V. With ${Math.round(resistance * 10) / 10} Ω, use an RCD of at most ${maxSensitivityMa} mA. In wet conditions (BB2) the limit is 25 V.`,
    }),
  }
}

registerPrimitive('circuitHasRcdProtection', circuitHasRcdProtection)
registerPrimitive('nonHouseholdTtIndirectContact', nonHouseholdTtIndirectContact)
registerPrimitive('wetRoomRequires30mAFromCircuitNotes', wetRoomRequires30mAFromCircuitNotes)
