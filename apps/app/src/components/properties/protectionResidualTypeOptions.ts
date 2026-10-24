import type { CustomDropdownOption } from '@/components/common/CustomDropdown'
import type { TFunction } from 'i18next'

/** Application examples aid selection; equipment requirements still decide the type. */
export function getProtectionResidualTypeOptions(
  t: TFunction,
): CustomDropdownOption[] {
  return [
    { value: 'AC', label: t('protections.residualType_AC', 'AC (loads without electronics)'), title: t('protections.residualTypeHelp_AC', 'Sinusoidal AC only. Check whether type AC is permitted for this installation.') },
    { value: 'A', label: t('protections.residualType_A', 'A (household circuits)'), title: t('protections.residualTypeHelp_A', 'AC and pulsating DC. Commonly used for household circuits.') },
    { value: 'F', label: t('protections.residualType_F', 'F (variable-speed appliances)'), title: t('protections.residualTypeHelp_F', 'Also mixed frequencies, for example single-phase motor drives. Follow the equipment requirements.') },
    { value: 'B', label: t('protections.residualType_B', 'B (some EV / PV systems)'), title: t('protections.residualTypeHelp_B', 'Also smooth DC. Not every EV charger or PV inverter requires type B; check equipment requirements and built-in DC leakage protection.') },
  ]
}
