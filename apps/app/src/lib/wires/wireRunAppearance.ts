import type { CableSpec } from '@/types/schema'
import type { WireRun } from '@/types/projectV2'
import type { WireInstallationSpecification } from './circuitWireSpecifications'
import {
  isProjectDefaultCableAnchor,
  SEEDED_AC_CIRCUIT_CABLE_KIND,
  withProjectDefaultCableKind,
} from './circuitWireDefaults'

/** Compare displayed specifications without merging physical cable/core identities or lengths. */
export function wireRunAppearance(
  run: WireRun,
  anchor: string,
  specification?: WireInstallationSpecification,
  defaultKind: CableSpec['kind'] = SEEDED_AC_CIRCUIT_CABLE_KIND
): string {
  const cable =
    run.followsDefaultCable && defaultKind && isProjectDefaultCableAnchor(anchor)
      ? withProjectDefaultCableKind(run.cable, defaultKind)
      : run.cable
  return JSON.stringify([
    cable.kind,
    cable.customKind?.trim() || undefined,
    cable.conductors,
    cable.sectionMm2,
    cable.hasPE ?? false,
    specification?.fireClass ?? cable.fireClass,
    run.medium ?? 'cable',
    run.material ?? 'copper',
    specification?.route ?? run.route,
    specification?.inTube ?? run.inTube ?? false,
    run.labels?.hideWireLabel ?? false,
    run.labels?.showFireClassLabel ?? !anchor.endsWith(':DC'),
    run.labels?.showWireLengthLabel ?? false,
  ])
}
