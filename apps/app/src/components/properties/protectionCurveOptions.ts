import type { TFunction } from 'i18next'
import type { CustomDropdownOption } from '@/components/common/CustomDropdown'
import { isSpecialistProtectionCurve } from '@/lib/protectionCurves'
import type { CurveType, InstallationProfile } from '@/types/schema'

export function getProtectionCurveOptions(
  curves: readonly (CurveType | '')[],
  profile: InstallationProfile,
  t: TFunction,
): CustomDropdownOption[] {
  return curves.map((curve) => {
    const warn = profile === 'household' && curve !== '' && isSpecialistProtectionCurve(curve)
    return {
      value: curve,
      label: curve ? `${curve}${warn ? ' ⚠' : ''}` : '-',
      ...(warn ? { title: t('protections.specialistCurveWarning') } : {}),
    }
  })
}
