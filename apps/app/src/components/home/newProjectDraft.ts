import {
  DEFAULT_SUPPLY_VOLTAGE_SYSTEM,
  SUPPLY_VOLTAGE_SYSTEMS,
  type SupplyVoltageSystem,
} from '@/constants/nominalVoltage'
import { DEFAULT_INSTALLATION_PROFILE } from '@/lib/installationProfile'
import { DEFAULT_CONNECTION_CURRENT_A } from '@/lib/electrical/supplyConnection'
import type { InstallationProfile } from '@/types/schema'

export const NEW_PROJECT_DRAFT_STORAGE_KEY = 'eendra.newProjectDraft.v1'

export type NewProjectDraft = {
  projectName: string
  yearOfConstruction: string
  meterEanCode: string
  address: {
    street: string
    postalCode: string
    city: string
    country: 'BE' | 'FR' | 'NL'
  }
  voltageSystem: SupplyVoltageSystem
  connectionCurrentA?: number
  installationProfile: InstallationProfile
}

export function createEmptyNewProjectDraft(): NewProjectDraft {
  return {
    projectName: '',
    yearOfConstruction: '',
    meterEanCode: '',
    address: {
      street: '',
      postalCode: '',
      city: '',
      country: 'BE',
    },
    voltageSystem: DEFAULT_SUPPLY_VOLTAGE_SYSTEM,
    connectionCurrentA: DEFAULT_CONNECTION_CURRENT_A,
    installationProfile: DEFAULT_INSTALLATION_PROFILE,
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isSupplyVoltageSystem(value: unknown): value is SupplyVoltageSystem {
  return SUPPLY_VOLTAGE_SYSTEMS.includes(value as SupplyVoltageSystem)
}

export function readNewProjectDraft(): NewProjectDraft {
  const fallback = createEmptyNewProjectDraft()
  if (typeof window === 'undefined') return fallback

  try {
    const raw = window.sessionStorage.getItem(NEW_PROJECT_DRAFT_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const address =
      parsed.address && typeof parsed.address === 'object'
        ? (parsed.address as Record<string, unknown>)
        : {}

    return {
      projectName: stringValue(parsed.projectName),
      yearOfConstruction: stringValue(parsed.yearOfConstruction),
      meterEanCode: stringValue(parsed.meterEanCode),
      address: {
        street: stringValue(address.street),
        postalCode: stringValue(address.postalCode),
        city: stringValue(address.city),
        country: address.country === 'FR' || address.country === 'NL' ? address.country : 'BE',
      },
      voltageSystem: isSupplyVoltageSystem(parsed.voltageSystem)
        ? parsed.voltageSystem
        : DEFAULT_SUPPLY_VOLTAGE_SYSTEM,
      ...(typeof parsed.connectionCurrentA === 'number' && Number.isSafeInteger(parsed.connectionCurrentA) && parsed.connectionCurrentA > 0
        ? { connectionCurrentA: parsed.connectionCurrentA }
        : {}),
      installationProfile:
        parsed.installationProfile === 'non_household'
          ? 'non_household'
          : DEFAULT_INSTALLATION_PROFILE,
    }
  } catch {
    return fallback
  }
}

export function writeNewProjectDraft(draft: NewProjectDraft): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(NEW_PROJECT_DRAFT_STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // Draft persistence is best-effort and must never block project creation.
  }
}

export function clearNewProjectDraft(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(NEW_PROJECT_DRAFT_STORAGE_KEY)
  } catch {
    // Ignore unavailable browser storage.
  }
}
