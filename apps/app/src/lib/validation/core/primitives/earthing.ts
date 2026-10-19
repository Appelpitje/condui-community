import { registerPrimitive } from './registry'
import type { CheckContext, CheckResult } from './common'
import { i18n, projectInstallation, projectPanels } from './common'
import {
  collectEarthingStems,
  findCanonicalEarthingBoard,
} from '@/lib/eendraad/panelGround'

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

registerPrimitive('installationHasEarthing', installationHasEarthing)
registerPrimitive('installationHasSingleEarthingLocation', installationHasSingleEarthingLocation)
