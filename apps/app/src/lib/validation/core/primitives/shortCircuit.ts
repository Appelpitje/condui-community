import { registerPrimitive } from './registry'
import type { CheckContext, CheckResult, Offender, ProtectionDevice, TrunkDevice } from './common'
import {
  getPanelFeedProjection,
  i18n,
  projectInstallation,
  projectPanels,
  validationCircuitCode,
  validationProtectionLabel,
  isPanelPlacementCarrierCircuit,
} from './common'
import { defaultVoltagesForSystem, normalizeNominalVoltageSystem } from '@/constants/nominalVoltage'
import { isHouseholdInstallation } from '@/lib/installationProfile'
import { isOvercurrentProtectionType } from '@/lib/protectionKind'
import { isSpecialistProtectionCurve } from '@/lib/protectionCurves'
import {
  buildCircuitCablePathIndex,
  type CircuitCablePath,
} from '@/lib/shortCircuit/circuitCablePaths'
import {
  instantaneousTripCurrentA,
  maximumProtectedLengthM,
} from '@/lib/shortCircuit/minimumShortCircuit'
import type { Installation } from '@/types/schema'

/** AREI 5.3.5.5.e: household overcurrent devices after the connection device. */
const HOUSEHOLD_MIN_BREAKING_CAPACITY_KA = 3
/** AREI 5.3.5.5.e: the connection device ("beschermingsinrichting voor aansluiting"). */
const HOUSEHOLD_CONNECTION_DEVICE_MIN_BREAKING_CAPACITY_KA = 6

function formatAmps(ka: number): string {
  return String(Math.round(ka * 1000))
}

function isStructuralCarrier(protection: ProtectionDevice): boolean {
  return protection.directPanelFeeder === true || protection.directDcBusFeeder === true
}

/**
 * Household boards: every AC overcurrent device on the board needs a breaking capacity of at
 * least 3000 A. Devices without an entered breaking capacity are skipped.
 */
function householdBoardBreakingCapacity(context: CheckContext): CheckResult {
  const { scope, query, project } = context
  if (scope.type !== 'board') return { passed: true }
  if (!isHouseholdInstallation(projectInstallation(project))) return { passed: true }
  const panel = query.getPanelById(scope.id)
  if (!panel) return { passed: true }

  const low = panel.protections.filter(
    (protection) =>
      !isStructuralCarrier(protection) &&
      protection.dcBusId == null &&
      isOvercurrentProtectionType(protection.type) &&
      protection.breakingCapacityKa != null &&
      protection.breakingCapacityKa < HOUSEHOLD_MIN_BREAKING_CAPACITY_KA
  )
  if (low.length === 0) return { passed: true }

  const labels = low.map((protection) => validationProtectionLabel(protection.label)).join(', ')
  return {
    passed: false,
    offenders: low.map((protection) => ({
      kind: 'protection' as const,
      id: protection.id,
      viewHint: 'eendraad' as const,
    })),
    message: i18n.t('validation.primitives.householdBoardBreakingCapacity.message', {
      labels,
      defaultValue: `Breaking capacity below 3000 A: ${labels}`,
    }),
    details: i18n.t('validation.primitives.householdBoardBreakingCapacity.details', {
      defaultValue:
        'In household installations, overcurrent devices after the connection device need a breaking capacity of at least 3000 A.',
    }),
  }
}

/**
 * Household supply: overcurrent devices before the energy meter are the network operator's
 * connection device and need at least 6000 A; devices after the meter need at least 3000 A.
 */
function householdSupplyBreakingCapacity(context: CheckContext): CheckResult {
  const { scope, query, project } = context
  if (scope.type !== 'board') return { passed: true }
  const installation = projectInstallation(project)
  if (!installation || !isHouseholdInstallation(installation)) return { passed: true }
  const panel = query.getPanelById(scope.id)
  if (!panel?.isMain) return { passed: true }

  const devices = getPanelFeedProjection(installation, projectPanels(project), panel)?.devices ?? []
  const meterIndex = devices.findIndex((device) => device.type === 'energy_meter')

  const offenders: Offender[] = []
  const findings: string[] = []
  devices.forEach((device: TrunkDevice, index) => {
    if (device.type !== 'protection' || !isOvercurrentProtectionType(device.protectionType)) return
    const ka = device.breakingCapacityKa
    if (ka == null) return
    const required =
      meterIndex >= 0 && index < meterIndex
        ? HOUSEHOLD_CONNECTION_DEVICE_MIN_BREAKING_CAPACITY_KA
        : HOUSEHOLD_MIN_BREAKING_CAPACITY_KA
    if (ka >= required) return
    offenders.push({ kind: 'device', id: device.id, viewHint: 'eendraad' })
    findings.push(
      `${validationProtectionLabel(device.label)} (${formatAmps(ka)} A < ${formatAmps(required)} A)`
    )
  })
  if (offenders.length === 0) return { passed: true }

  const list = findings.join(', ')
  return {
    passed: false,
    offenders,
    message: i18n.t('validation.primitives.householdSupplyBreakingCapacity.message', {
      list,
      defaultValue: `Supply breaking capacity too low: ${list}`,
    }),
    details: i18n.t('validation.primitives.householdSupplyBreakingCapacity.details', {
      defaultValue:
        'The connection device before the meter needs at least 6000 A. Overcurrent devices after it need at least 3000 A.',
    }),
  }
}

/**
 * Fault-loop voltage for AREI 5.3.5.5.h: phase-to-neutral when the circuit carries a neutral,
 * otherwise phase-to-phase. A three-pole device on a system with neutral has no neutral.
 */
function faultLoopVoltageV(
  installation: Installation | undefined,
  protection: ProtectionDevice
): number {
  const system = normalizeNominalVoltageSystem(installation?.nominalVoltage?.system ?? '2~')
  const { uLineToNeutral, uLineToLine } = defaultVoltagesForSystem(system)
  const hasNeutralSystem = system === '1N~' || system === '3N~'
  if (!hasNeutralSystem) return uLineToLine
  return protection.polesConfig === '3P' ? uLineToLine : uLineToNeutral
}

const cablePathIndexByQuery = new WeakMap<object, Map<string, CircuitCablePath[]>>()

function circuitCablePaths(context: CheckContext, circuitId: string): CircuitCablePath[] {
  let index = cablePathIndexByQuery.get(context.query)
  if (!index) {
    index = buildCircuitCablePathIndex(context.project)
    cablePathIndexByQuery.set(context.query, index)
  }
  return index.get(circuitId) ?? []
}

/** A specialist characteristic must not silently escape a check because inputs are absent. */
function circuitShortCircuitProtectionVerifiable(context: CheckContext): CheckResult {
  const { scope, query } = context
  if (scope.type !== 'circuit') return { passed: true }
  if (isPanelPlacementCarrierCircuit(query, scope.id)) {
    return { passed: true, coverage: { status: 'skipped', reason: 'panel-placement-carrier-is-not-an-electrical-feed' } }
  }
  const circuit = query.getCircuitById(scope.id)
  const protection = query.getProtectionForCircuit(scope.id)
  if (!circuit) return { passed: true }
  if (!protection || protection.dcBusId != null) {
    return { passed: true, coverage: { status: 'missing-information', reason: 'protective-device-not-modeled', missingFacts: ['upstream protective device'] } }
  }
  if (protection.type !== 'MCB' && protection.type !== 'RCBO') return { passed: true }
  if (!isSpecialistProtectionCurve(protection.curve)) return { passed: true }

  const curve = protection.curve!
  const supportedCurve = instantaneousTripCurrentA(1, curve) != null
  const paths = circuitCablePaths(context, circuit.id)
  const positive = (value: number | undefined): boolean =>
    value != null && Number.isFinite(value) && value > 0
  const complete = supportedCurve && positive(protection.ratingA) && paths.length > 0 &&
    paths.every((path) => path.missingLengthAnchors.length === 0 &&
      path.edges.every((edge) => positive(edge.lengthM) &&
        positive(edge.cable?.sectionMm2 ?? circuit.cable?.sectionMm2)))
  if (complete) return { passed: true, coverage: { status: 'passed' } }

  const missingFacts = [
    ...(!supportedCurve ? ['supported protective-device curve model'] : []),
    ...(!positive(protection.ratingA) ? ['protective-device current rating'] : []),
    ...(paths.length === 0 ? ['modeled cable path'] : []),
    ...(paths.some((path) => path.missingLengthAnchors.length > 0) ? ['complete route length / connected cable anchors'] : []),
    ...(paths.some((path) => path.edges.some((edge) => !positive(edge.lengthM))) ? ['cable edge length'] : []),
    ...(paths.some((path) => path.edges.some((edge) => !positive(edge.cable?.sectionMm2 ?? circuit.cable?.sectionMm2))) ? ['cable cross-section'] : []),
  ]

  return {
    passed: false,
    coverage: {
      status: supportedCurve ? 'missing-information' : 'unavailable',
      reason: supportedCurve
        ? 'short-circuit-protection-could-not-be-verified-from-entered-data'
        : 'unsupported-protection-curve',
      missingFacts,
    },
    offenders: [
      { kind: 'circuit', id: circuit.id, viewHint: 'eendraad' },
      { kind: 'protection', id: protection.id, viewHint: 'eendraad' },
    ],
    message: i18n.t('validation.primitives.circuitShortCircuitProtectionVerifiable.message', {
      circuitCode: validationCircuitCode(circuit.code), curve,
    }),
    details: i18n.t(supportedCurve
      ? 'validation.primitives.circuitShortCircuitProtectionVerifiable.missingData'
      : 'validation.primitives.circuitShortCircuitProtectionVerifiable.unsupportedCurve'),
  }
}

/**
 * AREI 5.3.5.5.h: a fault at the far end of the circuit must still reach the breaker's
 * instantaneous trip current. Only entered lengths are summed, so the result is a lower bound
 * and the check only fails when the circuit is certainly too long.
 */
function circuitWithinMaximumProtectedLength(context: CheckContext): CheckResult {
  const { scope, query, project } = context
  if (scope.type !== 'circuit') return { passed: true }
  if (isPanelPlacementCarrierCircuit(query, scope.id)) {
    return { passed: true, coverage: { status: 'skipped', reason: 'panel-placement-carrier-is-not-an-electrical-feed' } }
  }
  const circuit = query.getCircuitById(scope.id)
  if (!circuit) return { passed: true }
  const protection = query.getProtectionForCircuit(scope.id)
  if (!protection || protection.dcBusId != null) return { passed: true }
  if (protection.type !== 'MCB' && protection.type !== 'RCBO') return { passed: true }
  const tripCurrentA = instantaneousTripCurrentA(protection.ratingA, protection.curve)
  if (tripCurrentA == null) {
    return {
      passed: true,
      coverage: {
        status: 'missing-information',
        reason: 'protective-device-rating-or-trip-curve-unavailable',
        missingFacts: [
          ...(!protection.ratingA || protection.ratingA <= 0 ? ['protective-device current rating'] : []),
          ...(!protection.curve ? ['protective-device trip curve'] : []),
        ],
      },
    }
  }

  const voltageV = faultLoopVoltageV(projectInstallation(project), protection)
  const paths = circuitCablePaths(context, circuit.id)
  let worst: { path: CircuitCablePath; maxLengthM: number; sectionMm2: number } | undefined
  for (const path of paths) {
    const sectionMm2 = path.minSectionMm2 ?? circuit.cable?.sectionMm2
    if (!sectionMm2 || path.knownLengthM <= 0) continue
    const material = path.edges.some((edge) => edge.material === 'aluminium')
      ? 'aluminium'
      : 'copper'
    const maxLengthM = maximumProtectedLengthM({ voltageV, sectionMm2, material, tripCurrentA })
    if (maxLengthM == null || path.knownLengthM <= maxLengthM) continue
    if (!worst || path.knownLengthM - maxLengthM > worst.path.knownLengthM - worst.maxLengthM) {
      worst = { path, maxLengthM, sectionMm2 }
    }
  }
  const missingFacts = [
    ...(paths.length === 0 ? ['modeled cable path'] : []),
    ...(paths.some((path) => path.missingLengthAnchors.length > 0) ? ['complete route length / connected cable anchors'] : []),
    ...(paths.some((path) => path.edges.some((edge) => !edge.lengthM || edge.lengthM <= 0)) ? ['cable edge length'] : []),
    ...(paths.some((path) => path.edges.some((edge) => !(path.minSectionMm2 ?? circuit.cable?.sectionMm2 ?? edge.cable?.sectionMm2))) ? ['cable cross-section'] : []),
    ...(query.getCableSegments(circuit.id).length === 0 || query.getCableSegments(circuit.id).some((segment) => !query.getInstallationMethod(segment)) ? ['cable installation method'] : []),
    ...(paths.some((path) => path.edges.some((edge) => !edge.material && !edge.cable?.kind)) ? ['conductor material'] : []),
    ...(!projectInstallation(project)?.nominalVoltage?.system ? ['nominal voltage system'] : []),
  ]
  if (!worst) {
    return {
      passed: true,
      ...(missingFacts.length > 0 ? {
        coverage: {
          status: 'missing-information' as const,
          reason: 'known-data-does-not-prove-protected-length-compliance',
          missingFacts,
        },
      } : {}),
    }
  }

  const circuitCode = validationCircuitCode(circuit.code)
  const lengthM = Math.round(worst.path.knownLengthM)
  const maxLengthM = Math.floor(worst.maxLengthM)
  const curve = protection.curve ?? ''
  const ratingA = protection.ratingA ?? 0
  return {
    passed: false,
    ...(missingFacts.length > 0 ? {
      coverage: {
        status: 'failed' as const,
        reason: 'known-cable-length-exceeds-protected-maximum-with-some-data-incomplete',
        missingFacts,
      },
    } : {}),
    offenders: [
      { kind: 'circuit', id: circuit.id, viewHint: 'eendraad' },
      { kind: 'protection', id: protection.id, viewHint: 'eendraad' },
    ],
    message: i18n.t('validation.primitives.circuitWithinMaximumProtectedLength.message', {
      circuitCode,
      lengthM,
      maxLengthM,
      defaultValue: `Circuit ${circuitCode}: ${lengthM} m of cable exceeds the protected length of ${maxLengthM} m`,
    }),
    details: i18n.t('validation.primitives.circuitWithinMaximumProtectedLength.details', {
      curve,
      ratingA,
      sectionMm2: worst.sectionMm2,
      tripCurrentA: Math.round(tripCurrentA),
      maxLengthM,
      defaultValue: `A short circuit at the far end must still trip the ${curve}${ratingA} instantly (${Math.round(tripCurrentA)} A). With ${worst.sectionMm2} mm² that allows at most ${maxLengthM} m. Use a larger section, a shorter route, or a lower rating or curve.`,
    }),
  }
}

registerPrimitive('householdBoardBreakingCapacity', householdBoardBreakingCapacity)
registerPrimitive('householdSupplyBreakingCapacity', householdSupplyBreakingCapacity)
registerPrimitive('circuitWithinMaximumProtectedLength', circuitWithinMaximumProtectedLength)
registerPrimitive('circuitShortCircuitProtectionVerifiable', circuitShortCircuitProtectionVerifiable)
