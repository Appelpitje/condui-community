import { registerPrimitive } from './registry'
import { getDerivedWiresForValidation } from '../../derivedWiresForValidation'
import { isBelgianInstallation } from './earthing'
import { i18n, projectInstallation } from './common'
import type { CheckContext, CheckResult } from './common'

function undergroundCableConduit(context: CheckContext): CheckResult {
  if (context.scope.type !== 'circuit' || !isBelgianInstallation(projectInstallation(context.project)))
    return { passed: true }
  // Manufacturer guidance: https://www.nexans.be/nl/services-and-solutions/Smart-tools/FAQ/FAQ-cable-laying.html
  const segments = getDerivedWiresForValidation(context.query)?.byCircuit.get(context.scope.id) ?? []
  const affected = segments.some((segment) => segment.circuitId === context.scope.id &&
    segment.wireRoute === 'ground' && segment.inTube !== true &&
    (segment.cable.kind === 'XVB' || segment.cable.kind === 'XGB'))
  if (!affected) return { passed: true }
  return {
    passed: false,
    offenders: [{ kind: 'circuit', id: context.scope.id, viewHint: 'eendraad' }],
    message: i18n.t('validation.primitives.undergroundCable.message'),
    details: i18n.t('validation.primitives.undergroundCable.details'),
  }
}

registerPrimitive('undergroundCableConduit', undergroundCableConduit)
