import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Installation } from '@/types/schema'
import { createDefaultSupplyCable } from '@/lib/electrical/supplyCable'
import {
  DEFAULT_SUPPLY_VOLTAGE_SYSTEM,
  applyNominalVoltageSystem,
} from '@/constants/nominalVoltage'
import { NominalVoltageSystemPicker } from '@/components/properties/NominalVoltageSystemPicker'
import { ConnectionCurrentField } from '@/components/properties/ConnectionCurrentField'
import { DEFAULT_EENDRAAD_INSTALLATION_OPTIONS } from '@/utils/project'
import { DEFAULT_INSTALLATION_PROFILE } from '@/lib/installationProfile'
import {
  clearNewProjectDraft,
  createEmptyNewProjectDraft,
  readNewProjectDraft,
  writeNewProjectDraft,
} from '@/components/home/newProjectDraft'

type CommunityNewProjectDialogProps = {
  isOpen: boolean
  onClose: () => void
  onCreate: (
    name: string,
    installation: Installation,
    yearOfConstruction?: number,
    meterEanCode?: string,
  ) => boolean | Promise<boolean>
}

export default function CommunityNewProjectDialog({
  isOpen,
  onClose,
  onCreate,
}: CommunityNewProjectDialogProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(readNewProjectDraft)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const skipNextDraftWriteRef = useRef(false)
  const { projectName, yearOfConstruction, meterEanCode, address, voltageSystem, connectionCurrentA } = draft

  useEffect(() => {
    if (skipNextDraftWriteRef.current) {
      skipNextDraftWriteRef.current = false
      return
    }
    writeNewProjectDraft(draft)
  }, [draft])

  useEffect(() => {
    if (!isOpen) return
    const frame = requestAnimationFrame(() => nameInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [isOpen])

  const close = () => {
    writeNewProjectDraft(draft)
    onClose()
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const name = projectName.trim()
    if (!name) return

    const year = yearOfConstruction.trim() ? Number.parseInt(yearOfConstruction, 10) : undefined
    if (year !== undefined && (Number.isNaN(year) || year < 1500 || year > 2100)) {
      window.alert(t('project.yearOfConstructionInvalid', 'Please enter a valid year between 1500 and 2100.'))
      return
    }

    const installation: Installation = {
      ...DEFAULT_EENDRAAD_INSTALLATION_OPTIONS,
      installationProfile: DEFAULT_INSTALLATION_PROFILE,
      address,
      connectionCurrentA,
      nominalVoltage: applyNominalVoltageSystem(
        { system: DEFAULT_SUPPLY_VOLTAGE_SYSTEM, uLineToNeutral: 230, uLineToLine: 230 },
        voltageSystem,
      ),
      mainSupply: {
        cable: createDefaultSupplyCable(voltageSystem),
        origin: 'grid',
      },
    }

    setIsSubmitting(true)
    try {
      if (!await onCreate(name, installation, year, meterEanCode.trim() || undefined)) return
      clearNewProjectDraft()
      skipNextDraftWriteRef.current = true
      setDraft(createEmptyNewProjectDraft())
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  const inputClass =
    'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-slate-200 bg-white/95 shadow-2xl backdrop-blur-sm dark:border-gray-700 dark:bg-gray-800/90">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-3 dark:border-gray-700">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{t('project.new')}</h2>
          <button type="button" onClick={close} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <span className="sr-only">{t('common.cancel')}</span>
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('project.name')} *</label>
              <input ref={nameInputRef} type="text" data-testid="new-project-name-input" value={projectName} onChange={(event) => setDraft((current) => ({ ...current, projectName: event.target.value }))} className={inputClass} required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('project.yearOfConstruction', 'Year of construction')}</label>
                <input type="number" min={1500} max={2100} value={yearOfConstruction} onChange={(event) => setDraft((current) => ({ ...current, yearOfConstruction: event.target.value }))} className={inputClass} placeholder="e.g. 1995" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('project.meterEanCode', 'Meter EAN code')}</label>
                <input type="text" value={meterEanCode} onChange={(event) => setDraft((current) => ({ ...current, meterEanCode: event.target.value }))} className={inputClass} placeholder={t('project.meterEanCodePlaceholder', 'e.g. 5412345678901234')} />
              </div>
            </div>
            <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
              <h3 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">{t('installation.title')}</h3>
              <div className="space-y-3">
                <input type="text" value={address.street} onChange={(event) => setDraft((current) => ({ ...current, address: { ...current.address, street: event.target.value } }))} className={inputClass} placeholder={t('installation.street')} />
                <div className="grid grid-cols-2 gap-4">
                  <input type="text" value={address.postalCode} onChange={(event) => setDraft((current) => ({ ...current, address: { ...current.address, postalCode: event.target.value } }))} className={inputClass} placeholder={t('installation.postalCode')} />
                  <input type="text" value={address.city} onChange={(event) => setDraft((current) => ({ ...current, address: { ...current.address, city: event.target.value } }))} className={inputClass} placeholder={t('installation.city')} />
                </div>
                <select value={address.country} onChange={(event) => setDraft((current) => ({ ...current, address: { ...current.address, country: event.target.value as 'BE' | 'FR' | 'NL' } }))} className={inputClass}>
                  <option value="BE">{t('installation.countryBelgium')}</option>
                  <option value="FR">{t('installation.countryFrance', 'France')}</option>
                  <option value="NL">{t('installation.countryNetherlands', 'Netherlands')}</option>
                </select>
              </div>
              <div className="mt-4">
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('installation.voltage')} *</label>
                <NominalVoltageSystemPicker value={voltageSystem} onChange={(next) => setDraft((current) => ({ ...current, voltageSystem: next }))} />
              </div>
              <div className="mt-4">
                <ConnectionCurrentField value={connectionCurrentA} onChange={(connectionCurrentA) => setDraft((current) => ({ ...current, connectionCurrentA }))} />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 gap-3 border-t border-gray-200 px-6 py-3 dark:border-gray-700">
            <button type="button" onClick={close} disabled={isSubmitting} className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">{t('common.cancel')}</button>
            <button type="submit" data-testid="new-project-submit" disabled={isSubmitting} className="flex-1 rounded-md bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700">{t('project.create')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
