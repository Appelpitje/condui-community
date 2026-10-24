import { editProperties } from '@/handlers/properties/editProperties'
import { useInstallationProfile } from '@/hooks/useInstallationProfile'
import { Eye, EyeOff } from 'lucide-react'
import { DebouncedTextInput } from '@/components/forms'
import CustomDropdown from '@/components/common/CustomDropdown'
import type { CableSpec, CircuitPhaseAssignment, Installation, Panel } from '@/types/schema'
import {
  applyCableKindChange,
  getAcWireTypeOptions,
  getDcWireTypeOptions,
  getGroundWireTypeOptions,
  getWireSectionOptions,
} from '@/lib/wires/cableWireTypes'
import {
  getSupplyWireLengthMForRole,
  isSupplyWireFireClassLabelVisibleForRole,
  isSupplyWireLabelVisibleForRole,
  isSupplyWireLengthLabelVisibleForRole,
  type SupplyWireRole,
} from '@/lib/feedTopology'
import { getWireConductorOptions, resolveConductorDropdownValue } from '@/lib/wireConductorOptions'
import { visibilityToggleClass } from '../shared/propertiesSharedUtils'
import { WireLengthField } from '../shared/propertiesShared'
import { WireRouteAndCableForm, type WireRouteFormState } from '../shared/propertiesShared'
import type { PhaseAssignmentConstraint } from '@/lib/wires/phaseAssignment'
// Supply Wire Properties Component (for supply-to-main-bus wire)
export function SupplyWireProperties({
  installation,
  panels,
  panelId,
  supplyWireRole,
  supplyCable,
  wireDomain = 'AC',
  configuredPhaseAssignment,
  showPhaseLabel,
  phaseConstraint,
  phaseLocked = false,
  onUpdatePhase,
  t,
}: {
  installation: Installation
  panels: Panel[]
  panelId: string
  supplyWireRole: SupplyWireRole
  supplyCable: CableSpec
  onUpdate: (updates: Partial<Installation>) => void
  onUpdateCable?: (cable: CableSpec) => void
  wireDomain?: 'AC' | 'DC'
  configuredPhaseAssignment?: CircuitPhaseAssignment
  effectivePhaseAssignment?: CircuitPhaseAssignment
  showPhaseLabel?: boolean
  phaseConstraint?: PhaseAssignmentConstraint
  phaseLocked?: boolean
  onUpdatePhase?: (
    updates: Partial<Pick<WireRouteFormState, 'phaseAssignment' | 'showPhaseLabel'>>
  ) => void
  t: (key: string, defaultValue?: string) => string
}) {
  const isDC = wireDomain === 'DC'
  const panel = panels.find((p) => p.id === panelId) ?? panels[0]!
  const isSupplyLabelVisible = isSupplyWireLabelVisibleForRole(
    installation,
    panels,
    panel,
    supplyWireRole
  )
  const isFireClassLabelVisible = isSupplyWireFireClassLabelVisibleForRole(
    installation,
    panels,
    panel,
    supplyWireRole
  )
  const supplyWireLengthM = getSupplyWireLengthMForRole(installation, panels, panel, supplyWireRole)
  const isWireLengthLabelVisible = isSupplyWireLengthLabelVisibleForRole(
    installation,
    panels,
    panel,
    supplyWireRole
  )
  const fireClassOptions: Array<NonNullable<CableSpec['fireClass']>> = [
    'Aca',
    'B1ca',
    'B2ca',
    'Cca',
    'Dca',
    'Eca',
    'Fca',
  ]

  const conductorOptions = getWireConductorOptions(isDC)
  const selectedConductorValue = resolveConductorDropdownValue(supplyCable, isDC)

  const wireTypes = isDC
    ? getDcWireTypeOptions(t('wires.other', 'Other'), {
        batteryCable: t('wires.batteryCable', 'Battery cable'),
      })
    : getAcWireTypeOptions(t('wires.other', 'Other'))

  const thicknessOptions = getWireSectionOptions(isDC, installation.installationProfile)

  const applySupplyWire = (set: Record<string, unknown>) =>
    editProperties({
      actions: [{ kind: 'supplyWire', panelId: panel.id, role: supplyWireRole, set: set as never }],
    })
  const handleCableChange = (updates: Partial<CableSpec>) => applySupplyWire({ cable: updates })

  return (
    <div className="space-y-4">
      <span
        className={`shrink-0 inline-flex items-center gap-2 px-2 py-1 text-xs font-medium rounded ${
          isDC
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
            : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
        }`}
        title={t('wires.domainTag', 'Electrical domain')}
      >
        <img
          src={
            isDC
              ? '/symbols/energy-conversion/symbol_DC.svg'
              : '/symbols/energy-conversion/symbol_AC.svg'
          }
          alt=""
          className="h-3.5 w-3.5 shrink-0 object-contain opacity-90 dark:invert dark:opacity-90"
          aria-hidden
        />
        {wireDomain}
      </span>
      {onUpdatePhase && (
        <WireRouteAndCableForm
          state={{
            cable: supplyCable,
            phaseAssignment: configuredPhaseAssignment,
            showPhaseLabel,
            phaseConstraint,
          }}
          onChange={(updates) => {
            const phaseUpdates: Partial<
              Pick<WireRouteFormState, 'phaseAssignment' | 'showPhaseLabel'>
            > = {}
            if (Object.prototype.hasOwnProperty.call(updates, 'phaseAssignment')) {
              phaseUpdates.phaseAssignment = updates.phaseAssignment
            }
            if (Object.prototype.hasOwnProperty.call(updates, 'showPhaseLabel')) {
              phaseUpdates.showPhaseLabel = updates.showPhaseLabel
            }
            onUpdatePhase(phaseUpdates)
          }}
          isDC={isDC}
          phaseSystem={installation.nominalVoltage.system}
          showPhaseAssignment
          phaseOnly
          phaseLocked={phaseLocked}
          t={t}
        />
      )}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('wires.wireTypeLabel', 'Wire type')}
        </label>
        <button
          type="button"
          onClick={() => applySupplyWire({ hideWireLabel: isSupplyLabelVisible })}
          className={visibilityToggleClass(isSupplyLabelVisible)}
          title={
            isSupplyLabelVisible
              ? t('wires.hideLabel', 'Hide Wire Label')
              : t('wires.showLabel', 'Show Wire Label')
          }
          aria-label={
            isSupplyLabelVisible
              ? t('wires.hideLabel', 'Hide Wire Label')
              : t('wires.showLabel', 'Show Wire Label')
          }
        >
          {isSupplyLabelVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2 space-y-1">
            <div className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('wires.type', 'Type')}</div>
            <CustomDropdown
              wrapLabels
              ariaLabel={t('wires.type', 'Type')}
              value={supplyCable.kind}
              onChange={(nextValue) =>
                handleCableChange(applyCableKindChange(supplyCable, nextValue as CableSpec['kind']))
              }
              options={wireTypes.map((type) => ({ value: type.value, label: type.label }))}
              className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('wires.conductors', 'Conductors')}</div>
            <CustomDropdown
              wrapLabels
              ariaLabel={t('wires.conductors', 'Conductors')}
              value={selectedConductorValue}
              onChange={(nextValue) => {
                const selected = conductorOptions.find((opt) => opt.value === nextValue)
                if (selected) {
                  handleCableChange({
                    conductors: selected.conductors,
                    hasPE: selected.hasPE,
                  })
                }
              }}
              options={conductorOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
              className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('wires.thickness', 'Thickness')}</div>
            <CustomDropdown
              wrapLabels
              ariaLabel={t('wires.thickness', 'Thickness')}
              value={String(supplyCable.sectionMm2)}
              onChange={(nextValue) => {
                const value = parseFloat(nextValue)
                if (!isNaN(value) && value > 0) {
                  handleCableChange({ sectionMm2: value })
                }
              }}
              options={thicknessOptions.map((thickness) => ({
                value: String(thickness),
                label: `${thickness} mm²`,
              }))}
              className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            />
          </div>
        </div>
        {supplyCable.kind === 'other' && (
          <DebouncedTextInput
            type="text"
            value={supplyCable.customKind ?? ''}
            onCommit={(v) => {
              const customKind = v.trim() || undefined
              handleCableChange({ customKind })
            }}
            placeholder={t('wires.customTypePlaceholder', 'Custom type name')}
            className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
          />
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('wires.fireClass', 'Brandklasse')}
          </label>
          <button
            type="button"
            disabled={!supplyCable.fireClass || isDC}
            onClick={() => applySupplyWire({ showFireClassLabel: !isFireClassLabelVisible })}
            className={visibilityToggleClass(isFireClassLabelVisible)}
            title={
              isFireClassLabelVisible
                ? t('wires.hideFireClassLabel', 'Hide fire class on one-wire')
                : t('wires.showFireClassLabel', 'Show fire class on one-wire')
            }
            aria-label={
              isFireClassLabelVisible
                ? t('wires.hideFireClassLabel', 'Hide fire class on one-wire')
                : t('wires.showFireClassLabel', 'Show fire class on one-wire')
            }
          >
            {isFireClassLabelVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        </div>
        <CustomDropdown
          value={supplyCable.fireClass ?? ''}
          onChange={(nextValue) => {
            const fireClass = nextValue
              ? (nextValue as NonNullable<CableSpec['fireClass']>)
              : undefined
            applySupplyWire({
              cable: { fireClass },
              ...(!fireClass ? { showFireClassLabel: false } : {}),
            })
          }}
          options={[
            { value: '', label: t('common.none', 'None') },
            ...fireClassOptions.map((fireClass) => ({ value: fireClass, label: fireClass })),
          ]}
          className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
        />
      </div>

      <WireLengthField
        wireLengthM={supplyWireLengthM}
        showWireLengthLabel={isWireLengthLabelVisible ? true : false}
        onChange={(updates) => applySupplyWire(updates)}
        t={t}
      />
    </div>
  )
}

// Ground Wire Properties Component (for ground-to-main-bus wire)
export function GroundWireProperties({
  groundCable,
  onUpdate,
  t,
}: {
  groundCable: CableSpec
  onUpdate: (updates: Partial<Installation>) => void
  t: (key: string, defaultValue?: string) => string
}) {
  const wireTypes = getGroundWireTypeOptions(t('wires.other', 'Other'))

  const installationProfile = useInstallationProfile()
  const thicknessOptions = getWireSectionOptions(false, installationProfile)

  const handleCableChange = (updates: Partial<CableSpec>) => {
    onUpdate({
      groundCable: { ...groundCable, ...updates },
    })
  }

  return (
    <div className="space-y-4">
      {/* Wire Type and Thickness - Single line with headers */}
      <div className="space-y-2">
        {/* Headers */}
        <div className="grid grid-cols-2 gap-2 text-xs font-medium text-gray-600 dark:text-gray-400">
          <div>{t('wires.type', 'Type')}</div>
          <div>{t('wires.thickness', 'Thickness')}</div>
        </div>

        {/* Controls */}
        <div className="grid grid-cols-2 gap-2">
          {/* Wire Type */}
          <CustomDropdown
            wrapLabels
            ariaLabel={t('wires.type', 'Type')}
            value={groundCable.kind}
            onChange={(nextValue) =>
              handleCableChange(applyCableKindChange(groundCable, nextValue as CableSpec['kind']))
            }
            options={wireTypes.map((type) => ({ value: type.value, label: type.label }))}
            className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
          />

          {/* Thickness */}
          <CustomDropdown
            wrapLabels
            ariaLabel={t('wires.thickness', 'Thickness')}
            value={String(groundCable.sectionMm2)}
            onChange={(nextValue) => {
              const value = parseFloat(nextValue)
              if (!isNaN(value) && value > 0) {
                handleCableChange({ sectionMm2: value })
              }
            }}
            options={thicknessOptions.map((thickness) => ({
              value: String(thickness),
              label: `${thickness} mm²`,
            }))}
            className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
          />
        </div>
        {groundCable.kind === 'other' && (
          <DebouncedTextInput
            type="text"
            value={groundCable.customKind ?? ''}
            onCommit={(v) => {
              const customKind = v.trim() || undefined
              handleCableChange({ customKind })
            }}
            placeholder={t('wires.customTypePlaceholder', 'Custom type name')}
            className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
          />
        )}
      </div>

      {/* Conductors - fixed to 1G (read-only display) */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('wires.conductors', 'Conductors')}
        </div>
        <div className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-not-allowed">
          1G
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
          {t(
            'wires.earthingConductorsNote',
            'Earthing wire is always single conductor with ground (1G).'
          )}
        </p>
      </div>
    </div>
  )
}
