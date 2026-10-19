import { registerPrimitive } from './registry'
import type {
  CheckContext,
  CheckResult,
  Issue,
  Offender,
  SitplanMapping,
  Panel,
  InstallationQueryAPI,
  ValidationProject,
} from './common'
import { i18n, VALIDATION_DEBUG, projectPanels } from './common'
import { logger } from '@/lib/logger'
import {
  getAwaitingSituationPlanPlacements,
  getHiddenSituationPlanPlacements,
  type HiddenSituationPlanPlacement,
} from '@/lib/plan/hiddenSituationPlanPlacements'
import { getSymbolById } from '@/lib/symbols'
import { getSituationPlanPlacementIdsHiddenByPanel } from '@/lib/plan/panelPlanPlacementVisibility'

// All placements in a run share this read-only visibility and identifier inventory.
// A new query always gets fresh data, including when its project object is reused.
const placementSnapshots = new WeakMap<
  InstallationQueryAPI,
  {
    project: ValidationProject
    hidden: Set<string>
    mappingByPlacement: Map<string, SitplanMapping>
    endpointByPlacement?: Map<string, string>
  }
>()

function getPlacementSnapshot(context: CheckContext) {
  const { query, project } = context
  const cached = placementSnapshots.get(query)
  if (cached?.project === project) return cached
  const mappingByPlacement = new Map<string, SitplanMapping>()
  for (const mapping of query.getSitplanToEendraadMapping()) {
    // Preserve the first-match semantics of the previous Array.find lookup.
    if (!mappingByPlacement.has(mapping.placementId))
      mappingByPlacement.set(mapping.placementId, mapping)
  }
  const snapshot: NonNullable<ReturnType<typeof placementSnapshots.get>> = {
    project,
    hidden: getSituationPlanPlacementIdsHiddenByPanel(project),
    mappingByPlacement,
  }
  placementSnapshots.set(query, snapshot)
  return snapshot
}

function getEndpointOwningPlacement(
  context: CheckContext,
  placementId: string
): string | undefined {
  const snapshot = getPlacementSnapshot(context)
  if (!snapshot.endpointByPlacement) {
    const owners = new Map<string, string>()
    const visit = (panels: Panel[]) => {
      for (const panel of panels) {
        const circuits = [
          ...panel.circuits,
          ...panel.protections.flatMap((protection) => protection.circuits ?? []),
        ]
        for (const circuit of circuits) {
          for (const endpoint of circuit.endpoints) {
            for (const placement of endpoint.placements) {
              if (!owners.has(placement.id)) owners.set(placement.id, endpoint.id)
            }
          }
        }
        visit(panel.subPanels)
      }
    }
    visit(projectPanels(context.project))
    snapshot.endpointByPlacement = owners
  }
  return snapshot.endpointByPlacement.get(placementId)
}

/**
 * Check if a placement has valid circuit point identifier
 */
function placementHasValidIdentifier(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query } = context
  if (scope.type !== 'placement') {
    return { passed: true }
  }

  const snapshot = getPlacementSnapshot(context)
  if (snapshot.hidden.has(scope.id)) {
    return { passed: true }
  }

  const placement = query.getPlacementById(scope.id)
  if (!placement) {
    return { passed: true } // Placement not found, skip
  }

  const mapping = snapshot.mappingByPlacement.get(scope.id)
  if (mapping?.circuitPointId) return { passed: true }

  const endpointId = mapping?.endpointId ?? getEndpointOwningPlacement(context, scope.id)

  const endpoint = endpointId ? query.getEndpointById(endpointId) : undefined
  const endpointLabel = endpoint?.label ?? endpoint?.symbol ?? endpointId ?? 'unknown endpoint'

  if (process.env.NODE_ENV === 'development' && VALIDATION_DEBUG) {
    // eslint-disable-next-line no-console -- grouped validation primitive traces are debug-flag gated for local rule diagnosis.
    console.group('[Validation Debug] placementHasValidIdentifier', scope.id)

    logger.info('Placement ID:', scope.id)

    logger.info('Floor ID:', placement.floorId)

    logger.info('Endpoint ID:', endpointId)

    logger.info('Endpoint label:', endpointLabel)

    // eslint-disable-next-line no-console -- closes the debug-only validation trace group opened above.
    console.groupEnd()
  }

  const offenders: Offender[] = [
    {
      kind: 'placement',
      id: scope.id,
      viewHint: 'sitplan',
    },
  ]

  if (endpointId) {
    offenders.push({
      kind: 'endpoint',
      id: endpointId,
      viewHint: 'eendraad',
    })
  }

  return {
    passed: false,
    offenders,
    message: i18n.t('validation.primitives.placementHasValidIdentifier.message', {
      endpointLabel,
      placementId: scope.id,
      defaultValue:
        endpointLabel && endpointLabel !== 'unknown endpoint'
          ? `Placement for ${endpointLabel} lacks valid circuit point identifier`
          : `Placement ${scope.id} lacks valid circuit point identifier`,
    }),
    details: i18n.t('validation.primitives.placementHasValidIdentifier.details', {
      endpointLabel,
      placementId: scope.id,
      defaultValue:
        'Every sitplan placement must be associated with an endpoint that has a valid circuit letter and point number (e.g., "A1").',
    }),
  }
}

/** Report hidden one-wire symbols once for the whole project. */
function describeSituationPlanDevices(items: HiddenSituationPlanPlacement[]): string {
  return items
    .map((item) => {
      const symbol = item.symbol ? getSymbolById(item.symbol) : undefined
      const typeLabel = symbol
        ? i18n.t(`symbols.${symbol.id}`, { defaultValue: symbol.name })
        : item.symbol
      const label = item.endpointLabel.trim() || typeLabel || item.endpointId
      return `• ${label}${item.circuitLabel ? ` · ${item.circuitLabel}` : ''}`
    })
    .join('\n')
}

/** Board-level checks report once, on the main (or first) panel. */
function isSituationPlanAnchorBoard(context: CheckContext): Panel | null {
  const { scope, project } = context
  if (scope.type !== 'board') return null
  const panels = projectPanels(project)
  const anchorPanel = panels.find((panel) => panel.isMain) ?? panels[0]
  return anchorPanel && scope.id === anchorPanel.id ? anchorPanel : null
}

function hiddenSituationPlanSymbolsAreVisible(context: CheckContext): CheckResult {
  const { project } = context
  const anchorPanel = isSituationPlanAnchorBoard(context)
  if (!anchorPanel) return { passed: true }

  const hidden = getHiddenSituationPlanPlacements(project)
  if (hidden.length === 0) return { passed: true }
  const hiddenDeviceLines = describeSituationPlanDevices(hidden)

  return {
    passed: false,
    offenders: [{ kind: 'board', id: anchorPanel.id, viewHint: 'sitplan' }],
    message: i18n.t('validation.primitives.hiddenSituationPlanSymbolsAreVisible.message', {
      count: hidden.length,
      defaultValue: `${hidden.length} devices are hidden on the situation plan`,
    }),
    details: i18n.t('validation.primitives.hiddenSituationPlanSymbolsAreVisible.details', {
      count: hidden.length,
      devices: hiddenDeviceLines,
      defaultValue: `Hidden devices:\n${hiddenDeviceLines}`,
    }),
  }
}

registerPrimitive('placementHasValidIdentifier', placementHasValidIdentifier)
/** Symbols created while placing plan symbols manually and not put on the plan yet. */
function situationPlanSymbolsArePlaced(context: CheckContext): CheckResult {
  const { project } = context
  const anchorPanel = isSituationPlanAnchorBoard(context)
  if (!anchorPanel) return { passed: true }

  const awaiting = getAwaitingSituationPlanPlacements(project)
  if (awaiting.length === 0) return { passed: true }
  const devices = describeSituationPlanDevices(awaiting)

  return {
    passed: false,
    offenders: [{ kind: 'board', id: anchorPanel.id, viewHint: 'sitplan' }],
    message: i18n.t('validation.primitives.situationPlanSymbolsArePlaced.message', {
      count: awaiting.length,
      defaultValue: `${awaiting.length} devices are not placed on the situation plan yet`,
    }),
    details: i18n.t('validation.primitives.situationPlanSymbolsArePlaced.details', {
      count: awaiting.length,
      devices,
      defaultValue: `Not placed yet:\n${devices}`,
    }),
  }
}

registerPrimitive('hiddenSituationPlanSymbolsAreVisible', hiddenSituationPlanSymbolsAreVisible)
registerPrimitive('situationPlanSymbolsArePlaced', situationPlanSymbolsArePlaced)
