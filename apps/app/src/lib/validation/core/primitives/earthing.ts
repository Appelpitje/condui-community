import { registerPrimitive } from './registry'
import type { CheckContext, CheckResult, Circuit, Offender, Panel, ProtectionDevice } from './common'
import { i18n, projectInstallation, projectPanels, validationProtectionLabel } from './common'
import {
  collectEarthingStems,
  findCanonicalEarthingBoard,
} from '@/lib/eendraad/panelGround'
import { isHouseholdInstallation } from '@/lib/installationProfile'
import { resolveEffectiveEarthingSystem } from '@/lib/panel/panelEarthingSync'
import { walkPanels } from '@/lib/panel/panelTree'
import { computeAreiCircuitEndpointLimitCount } from '@/lib/validation/areiCircuitEndpointCount'
import type { Installation } from '@/types/schema'

function installationHasEarthing(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult {
  const { scope, project } = context
  if (scope.type !== 'board') return { passed: true, coverage: { status: 'skipped', reason: 'rule-requires-board-scope' } }

  const panels = projectPanels(project)
  const main = findCanonicalEarthingBoard(panels)
  if (!main || main.id !== scope.id) return { passed: true, coverage: { status: 'skipped', reason: 'not-canonical-earthing-board' } }

  if (collectEarthingStems(panels, projectInstallation(project)).length > 0) {
    return { passed: true, coverage: { status: 'passed' } }
  }

  return {
    passed: false,
    offenders: [{ kind: 'board', id: main.id, viewHint: 'eendraad' }],
    message: i18n.t('validation.primitives.installationHasEarthing.message', {
      defaultValue: 'Installation has no earthing',
    }),
    details: i18n.t('validation.primitives.installationHasEarthing.details', {
      defaultValue:
        'No earth electrode is shown on any board. This can be valid, but most installations need one earthing point.',
    }),
  }
}

function installationHasSingleEarthingLocation(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult {
  const { scope, project } = context
  if (scope.type !== 'board') return { passed: true, coverage: { status: 'skipped', reason: 'rule-requires-board-scope' } }

  const panels = projectPanels(project)
  const main = findCanonicalEarthingBoard(panels)
  if (!main || main.id !== scope.id) return { passed: true, coverage: { status: 'skipped', reason: 'not-canonical-earthing-board' } }

  const stems = collectEarthingStems(panels, projectInstallation(project))
  if (stems.length < 2) return { passed: true, coverage: { status: 'passed' } }

  const offenders = stems.map((stem) => ({
    kind: 'board' as const,
    id: stem.kind === 'panel' ? stem.panelId : main.id,
    viewHint: 'eendraad' as const,
  }))

  return {
    passed: false,
    offenders,
    message: i18n.t('validation.primitives.installationHasSingleEarthingLocation.message', {
      defaultValue: 'Earthing is shown on more than one board',
    }),
    details: i18n.t('validation.primitives.installationHasSingleEarthingLocation.details', {
      defaultValue:
        'The installation has earth electrodes on separate boards. Confirm this is intended; typically there is a single earthing point.',
    }),
  }
}

/** AREI 4.2.3.2: household earth electrodes stay below 100 ohm. */
const HOUSEHOLD_MAX_EARTH_RESISTANCE_OHM = 100
/** AREI 4.2.4.3(b): above 30 ohm, two high-sensitivity RCDs with at most 16 outlets each. */
const HOUSEHOLD_SPLIT_RCD_EARTH_RESISTANCE_OHM = 30
const HOUSEHOLD_SPLIT_RCD_MAX_OUTLETS = 16
/** AREI 4.2.4.4(d): non-household limits for dry non-conductive rooms and for other rooms. */
const NON_HOUSEHOLD_MAX_EARTH_RESISTANCE_DRY_OHM = 500
const NON_HOUSEHOLD_MAX_EARTH_RESISTANCE_OTHER_OHM = 250

function formatOhm(value: number): string {
  return String(Math.round(value * 10) / 10)
}

export function isBelgianInstallation(installation: Installation | undefined): boolean {
  const country = installation?.address?.country
  return !country || country === 'BE'
}

/** Earthing arrangement at the origin; Belgian household installations without one are TT. */
export function mainEarthingIsTt(panels: Panel[], installation: Installation | undefined): boolean {
  const main = findCanonicalEarthingBoard(panels)
  const earthing = main ? resolveEffectiveEarthingSystem(main, panels) : undefined
  if (isHouseholdInstallation(installation)) return earthing == null || earthing === 'TT'
  return earthing === 'TT'
}

function highSensitivityRcds(panels: Panel[]): ProtectionDevice[] {
  const rcds: ProtectionDevice[] = []
  for (const panel of walkPanels(panels)) {
    for (const protection of panel.protections) {
      if (protection.type !== 'RCD' && protection.type !== 'RCBO') continue
      if (protection.sensitivityMa == null || protection.sensitivityMa > 30) continue
      rcds.push(protection)
    }
  }
  return rcds
}

function outletEquivalentsBehindRcd(rcd: ProtectionDevice, panels: Panel[]): number {
  const rcboCircuitIds = new Set<string>()
  for (const panel of walkPanels(panels)) {
    for (const protection of panel.protections) {
      if (protection.type !== 'RCBO' || protection.id === rcd.id) continue
      for (const circuit of protection.circuits ?? []) rcboCircuitIds.add(circuit.id)
    }
  }
  return (rcd.circuits ?? [])
    .filter((circuit: Circuit) => !circuit.subCircuitIds?.length && !rcboCircuitIds.has(circuit.id))
    .reduce(
      (total: number, circuit: Circuit) =>
        total + computeAreiCircuitEndpointLimitCount(circuit).endpointCount,
      0
    )
}

const householdSplitRcdDetails = () =>
  i18n.t('validation.primitives.earthResistanceWithinLimits.householdSplitRcd.details', {
    defaultValue:
      'Above 30 Ω, a domestic installation needs at least two high-sensitivity RCDs (30 mA), each with at most 16 socket outlets or equivalent fixed appliances.',
  })

/**
 * AREI 4.2.3.2, 4.2.4.3(b) and 4.2.4.4(d): earth-electrode resistance limits. Runs once on
 * the canonical earthing board when a resistance is entered.
 */
function earthResistanceWithinLimits(context: CheckContext): CheckResult {
  const { scope, project } = context
  if (scope.type !== 'board') return { passed: true }
  const panels = projectPanels(project)
  const main = findCanonicalEarthingBoard(panels)
  if (!main || main.id !== scope.id) return { passed: true }
  const installation = projectInstallation(project)
  if (!isBelgianInstallation(installation)) return { passed: true }
  if (!mainEarthingIsTt(panels, installation)) {
    return { passed: true, coverage: { status: 'skipped', reason: 'earth-resistance-limits-apply-to-tt' } }
  }
  const resistance = installation?.earthResistanceOhm
  if (resistance == null || resistance <= 0) {
    return {
      passed: true,
      coverage: {
        status: 'missing-information',
        reason: 'earth-resistance-not-entered',
        missingFacts: ['earth electrode resistance'],
      },
    }
  }
  const ohm = formatOhm(resistance)
  const board: Offender[] = [{ kind: 'board', id: main.id, viewHint: 'eendraad' }]

  if (!isHouseholdInstallation(installation)) {
    if (resistance <= NON_HOUSEHOLD_MAX_EARTH_RESISTANCE_OTHER_OHM) {
      return { passed: true, coverage: { status: 'passed' } }
    }
    const dryOnly = resistance <= NON_HOUSEHOLD_MAX_EARTH_RESISTANCE_DRY_OHM
    return {
      passed: false,
      offenders: board,
      message: dryOnly
        ? i18n.t('validation.primitives.earthResistanceWithinLimits.nonHouseholdDryOnly.message', {
            ohm,
            defaultValue: `Earth resistance ${ohm} Ω is only allowed in dry, non-conductive rooms`,
          })
        : i18n.t('validation.primitives.earthResistanceWithinLimits.nonHouseholdTooHigh.message', {
            ohm,
            defaultValue: `Earth resistance ${ohm} Ω is above 500 Ω`,
          }),
      details: i18n.t('validation.primitives.earthResistanceWithinLimits.nonHousehold.details', {
        defaultValue:
          'With residual-current protection in a non-domestic installation, the earth resistance may not exceed 500 Ω in dry rooms with non-conductive floors and walls (AD1, BB1, BC1) and 250 Ω in other rooms.',
      }),
    }
  }

  if (resistance >= HOUSEHOLD_MAX_EARTH_RESISTANCE_OHM) {
    return {
      passed: false,
      offenders: board,
      message: i18n.t('validation.primitives.earthResistanceWithinLimits.householdTooHigh.message', {
        ohm,
        defaultValue: `Earth resistance ${ohm} Ω is not below 100 Ω`,
      }),
      details: i18n.t('validation.primitives.earthResistanceWithinLimits.householdTooHigh.details', {
        defaultValue: 'The earth electrode of a domestic installation must have a resistance below 100 Ω.',
      }),
    }
  }
  if (resistance <= HOUSEHOLD_SPLIT_RCD_EARTH_RESISTANCE_OHM) {
    return { passed: true, coverage: { status: 'passed' } }
  }

  const rcds = highSensitivityRcds(panels)
  if (rcds.length < 2) {
    return {
      passed: false,
      offenders: board,
      message: i18n.t('validation.primitives.earthResistanceWithinLimits.householdSplitRcd.message', {
        ohm,
        defaultValue: `Earth resistance ${ohm} Ω needs at least two 30 mA RCDs`,
      }),
      details: householdSplitRcdDetails(),
    }
  }
  const overloaded = rcds.filter(
    (rcd) => outletEquivalentsBehindRcd(rcd, panels) > HOUSEHOLD_SPLIT_RCD_MAX_OUTLETS
  )
  if (overloaded.length === 0) return { passed: true, coverage: { status: 'passed' } }
  const labels = overloaded.map((rcd) => validationProtectionLabel(rcd.label)).join(', ')
  return {
    passed: false,
    offenders: overloaded.map((rcd) => ({
      kind: 'protection' as const,
      id: rcd.id,
      viewHint: 'eendraad' as const,
    })),
    message: i18n.t('validation.primitives.earthResistanceWithinLimits.householdOutlets.message', {
      labels,
      defaultValue: `More than 16 outlets behind: ${labels}`,
    }),
    details: householdSplitRcdDetails(),
  }
}

/** Non-household TT installations need the earth resistance to verify indirect-contact protection. */
function nonHouseholdEarthResistanceEntered(context: CheckContext): CheckResult {
  const { scope, project } = context
  if (scope.type !== 'board') return { passed: true }
  const installation = projectInstallation(project)
  if (isHouseholdInstallation(installation) || !isBelgianInstallation(installation)) {
    return { passed: true }
  }
  const panels = projectPanels(project)
  const main = findCanonicalEarthingBoard(panels)
  if (!main || main.id !== scope.id || !mainEarthingIsTt(panels, installation)) {
    return { passed: true }
  }
  if (installation?.earthResistanceOhm != null && installation.earthResistanceOhm > 0) {
    return { passed: true }
  }
  return {
    passed: false,
    offenders: [{ kind: 'board', id: main.id, viewHint: 'eendraad' }],
    coverage: {
      status: 'missing-information',
      reason: 'earth-resistance-not-entered',
      missingFacts: ['earth electrode resistance'],
    },
    message: i18n.t('validation.primitives.nonHouseholdEarthResistanceEntered.message', {
      defaultValue: 'Earth resistance is not entered',
    }),
    details: i18n.t('validation.primitives.nonHouseholdEarthResistanceEntered.details', {
      defaultValue:
        'In a non-domestic TT installation, the earth resistance decides which RCD sensitivity protects against indirect contact (IΔn × RE ≤ UL).',
    }),
  }
}

registerPrimitive('installationHasEarthing', installationHasEarthing)
registerPrimitive('earthResistanceWithinLimits', earthResistanceWithinLimits)
registerPrimitive('nonHouseholdEarthResistanceEntered', nonHouseholdEarthResistanceEntered)
registerPrimitive('installationHasSingleEarthingLocation', installationHasSingleEarthingLocation)
