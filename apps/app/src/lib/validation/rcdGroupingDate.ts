import type { ProtectionDevice, TrunkDevice } from '@/types/schema'
import {
  getExplicitInstallationDate,
  getExplicitInstallYear,
  type InstallDateEntity,
} from '@/lib/installDates'
import { getScopeEntityPath } from './core/date-resolver'
import type { CheckContext } from './core/types'

/** The eight-final-circuit rule entered into force on 1 June 2023. */
export function hasLegacyRcdGroupingDate(
  context: CheckContext,
  device?: ProtectionDevice | TrunkDevice
): boolean {
  const entities: InstallDateEntity[] = getScopeEntityPath(context.project, context.scope).map(
    (entry) => entry.entity
  )
  if (device) entities.push(device)
  let date: string | undefined
  let year: number | undefined
  for (const entity of entities) {
    const explicitYear = getExplicitInstallYear(entity)
    if (explicitYear == null) continue
    year = explicitYear
    date = getExplicitInstallationDate(entity)
  }
  // Construction year is not evidence of the electrical installation's age.
  return date != null ? date < '2023-06-01' : year != null && year < 2023
}
