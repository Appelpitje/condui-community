import { registerPrimitive } from './registry'
import type { CheckContext, CheckResult } from './common'
import { i18n, projectInstallation } from './common'
import { isBelgianInstallation } from './earthing'
import { isHouseholdInstallation } from '@/lib/installationProfile'
import { assessRcdOverload } from '../../rcdOverload'

function householdRcdOverloadCoordination(context: CheckContext): CheckResult {
  const installation = projectInstallation(context.project)
  if (context.scope.type !== 'board' || !isBelgianInstallation(installation) || !isHouseholdInstallation(installation)) {
    return { passed: true, coverage: { status: 'skipped', reason: 'not-household-board' } }
  }
  const assessments = assessRcdOverload(context).filter(({ boardId }) => boardId === context.scope.id)
  const offenders = assessments.filter(({ status }) => status === 'overload').map(({ offender }) => offender)
  const incomplete = assessments.filter(({ status }) => status === 'unavailable' || status === 'missing-information')
  const coverage = incomplete.length ? {
    status: incomplete.some(({ status }) => status === 'unavailable') ? 'unavailable' as const : 'missing-information' as const,
    reason: [...new Set(incomplete.map(({ reason }) => reason))].join(';'),
    missingFacts: ['confirmed RCD rating, AC source current/phase and protective path'],
  } : { status: 'passed' as const }
  if (!offenders.length) return { passed: true, coverage }
  return {
    passed: false, offenders,
    message: i18n.t('validation.primitives.feedbackSafety.rcdOverload.message'),
    details: i18n.t('validation.primitives.feedbackSafety.rcdOverload.details'),
    coverage,
  }
}

registerPrimitive('householdRcdOverloadCoordination', householdRcdOverloadCoordination)
