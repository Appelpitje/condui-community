import { useMemo, useRef, useEffect } from 'react'
import { useInstallationProfile } from '@/hooks/useInstallationProfile'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import CustomDropdown, { type CustomDropdownOption } from '@/components/common/CustomDropdown'
import { DebouncedTextInput, DebouncedTextarea } from '@/components/forms'
import { useEendraadWireSegments } from '@/hooks/eendraad'
import {
  applyCableKindChange,
  getAcWireTypeOptions,
  getDcWireTypeOptions,
  getWireSectionOptions,
} from '@/lib/wires/cableWireTypes'
import { getWireConductorOptions, resolveConductorDropdownValue } from '@/lib/wireConductorOptions'
import {
  POLE_CONFIG_OPTIONS,
  POLE_CONFIG_OPTIONS_MCB,
  POLE_CONFIG_OPTIONS_RCBO,
  POLE_CONFIG_OPTIONS_RCD,
  polesFromConfig,
  polesConfigToDisplay,
} from '@/constants/poleConfig'
import { getProtectionTypeChangePatch } from '@/lib/protectionLabels'
import {
  getProtectionRatingOptions,
  breakingCapacityPatchFromSelectValue,
  getVoltagePolesConfig,
  getBreakerBreakingCapacityOptions,
  protectionBreakingCapacityKaOptions,
  resolveBreakingCapacitySelectValue,
} from '@/lib/protectionDefaults'
import { getProtectionTypeDropdownOptions } from './ProtectionDeviceElectricalFields'
import { editProperties } from '@/handlers/properties/editProperties'
import {
  findSectionWireOverrideWithFeederFallback,
  getSectionRefFromWireSegment,
  type CircuitSectionRef,
} from '@/lib/wires/sectionWireOverrides'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import type {
  CableSpec,
  Circuit,
  Endpoint,
  HvacEnergySource,
  HvacFunction,
  HvacType,
  ProtectionDevice,
  ProtectionType,
  SymbolKey,
  WireSegment,
} from '@/types/schema'
import type { Selection } from '@/types/ui'
import { labelClass, panelStringT, selectClass } from './shared/propertiesSharedUtils'
import {
  ApplianceTypeDropdown,
  LightPointOptionsGrid,
  LightTypeDropdown,
  SocketTypeGrid,
  SwitchTypeDropdown,
} from './editors/EndpointControls'
import {
  hasApplianceTypePicker,
  normalizeSocketSymbol,
  normalizeSwitchSymbol,
} from './editors/endpointControlsUtils'
import {
  getEndpointMultiEditFamily,
  resolveSharedValue,
  type SharedValue,
} from './multiSelectionPropertiesUtils'
import { isModularSocket, STANDARD_SOCKET_COUNTS } from '@/lib/socket/modularSocket'

function MixedDropdown({
  shared,
  options,
  onChange,
}: {
  shared: SharedValue<string>
  options: CustomDropdownOption[]
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const mixed = t('properties.mixedValue', 'Mixed')
  return (
    <CustomDropdown
      value={shared.mixed ? '__mixed__' : shared.value}
      options={options}
      onChange={onChange}
      placeholder={mixed}
      renderValue={(option) =>
        shared.mixed ? (
          <span className="italic text-gray-500 dark:text-gray-400">{mixed}</span>
        ) : (
          option?.label
        )
      }
      className={selectClass}
    />
  )
}

function MixedCheckbox({
  label,
  shared,
  onChange,
}: {
  label: string
  shared: SharedValue<boolean>
  onChange: (value: boolean) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = shared.mixed
  }, [shared.mixed])
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
      <input
        ref={ref}
        type="checkbox"
        checked={!shared.mixed && shared.value}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500 dark:border-gray-600 dark:bg-gray-700"
      />
      <span>{label}</span>
    </label>
  )
}

function MixedTextField({
  label,
  shared,
  onCommit,
}: {
  label: string
  shared: SharedValue<string>
  onCommit: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <DebouncedTextInput
        value={shared.mixed ? '' : (shared.value ?? '')}
        placeholder={shared.mixed ? t('properties.mixedValue', 'Mixed') : ''}
        onCommit={onCommit}
        className={`${selectClass} ${shared.mixed ? 'placeholder:italic' : ''}`}
      />
    </div>
  )
}

function MixedNumberField({
  label,
  shared,
  step,
  onCommit,
}: {
  label: string
  shared: SharedValue<number | undefined>
  step?: number
  onCommit: (value: number | undefined) => void
}) {
  const { t } = useTranslation()
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <DebouncedTextInput
        type="number"
        min="0"
        step={String(step ?? 1)}
        value={shared.mixed ? '' : String(shared.value ?? '')}
        placeholder={shared.mixed ? t('properties.mixedValue', 'Mixed') : ''}
        onCommit={(value) => {
          const parsed = value === '' ? undefined : Number(value)
          onCommit(Number.isFinite(parsed as number) ? parsed : undefined)
        }}
        className={`${selectClass} ${shared.mixed ? 'placeholder:italic' : ''}`}
      />
    </div>
  )
}

function BatchHeader({ count }: { count: number }) {
  const { t } = useTranslation()
  return (
    <p className="text-xs text-gray-500 dark:text-gray-400">
      {t('properties.selectedCount', '{{count}} items selected', { count })}
    </p>
  )
}

function ProtectionMultiEditor({ protections }: { protections: ProtectionDevice[] }) {
  const installationProfile = useInstallationProfile()
  const { t } = useTranslation()
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)
  const apply = (makePatch: (item: ProtectionDevice) => Partial<ProtectionDevice>) =>
    editProperties({
      edits: protections.map((item) => ({
        kind: 'protection',
        ids: [item.id],
        set: makePatch(item),
      })),
    })
  const stringField = (key: keyof ProtectionDevice) =>
    resolveSharedValue(protections.map((item) => String(item[key] ?? '')))
  const numberField = (key: keyof ProtectionDevice) =>
    resolveSharedValue(protections.map((item) => item[key] as number | undefined))
  const type = stringField('type')
  const allTypesMatch = (types: ProtectionType[]) =>
    protections.every((item) => types.includes(item.type))
  const showPoles = allTypesMatch(['RCD', 'RCBO', 'MCB', 'SPD', 'ROTATING_SWITCH'])
  const showNumericPoles = protections.every(
    (item) => !['RCD', 'RCBO', 'MCB', 'SPD', 'ROTATING_SWITCH'].includes(item.type)
  )
  const poleOptionsFor = (type: ProtectionType) =>
    type === 'RCD'
      ? POLE_CONFIG_OPTIONS_RCD
      : type === 'RCBO'
        ? POLE_CONFIG_OPTIONS_RCBO
        : type === 'MCB' || type === 'SPD'
          ? POLE_CONFIG_OPTIONS_MCB
          : POLE_CONFIG_OPTIONS
  const sharedPoleOptions = poleOptionsFor(protections[0]!.type).filter((option) =>
    protections.every((item) => poleOptionsFor(item.type).includes(option))
  )
  const ratingOptionsFor = (type: ProtectionType) =>
    getProtectionRatingOptions(type, installationProfile)
  const allRatingDropdown = protections.every((item) => ratingOptionsFor(item.type) !== null)
  const allRatingNumber = protections.every((item) => ratingOptionsFor(item.type) === null)
  const sharedRatingOptions = (ratingOptionsFor(protections[0]!.type) ?? []).filter((option) =>
    protections.every((item) => ratingOptionsFor(item.type)?.includes(option))
  )
  const showCurve = allTypesMatch(['MCB', 'RCBO'])
  const showResidual = allTypesMatch(['RCD', 'RCBO'])
  const sharedSensitivityOptions = [10, 30, 100, 300, 500].filter((value) =>
    protections.every((item) => item.type === 'RCD' || value !== 500)
  )
  const allSpd = allTypesMatch(['SPD'])
  const allBreakers = allTypesMatch(['MCB', 'RCBO'])
  const showBreakingCapacity = allSpd || allBreakers
  const showDeviceNotes = protections.every((item) => !item.circuits?.length)
  const typeOptions = useMemo(() => getProtectionTypeDropdownOptions(panelStringT(t), 'panel'), [t])
  return (
    <div className="space-y-4">
      <BatchHeader count={protections.length} />
      <div>
        <label className={labelClass}>{t('protections.type', 'Type')}</label>
        <MixedDropdown
          shared={type}
          options={typeOptions}
          onChange={(value) =>
            apply((item) => ({
              type: value as ProtectionType,
              ...getProtectionTypeChangePatch(
                item,
                value as ProtectionType,
                item.polesConfig ?? getVoltagePolesConfig(currentProject)
              ),
            }))
          }
        />
      </div>
      <div>
        <label className={labelClass}>{t('protections.label', 'Label')}</label>
        <DebouncedTextInput
          value={stringField('label').mixed ? '' : (stringField('label').value ?? '')}
          placeholder={stringField('label').mixed ? t('properties.mixedValue', 'Mixed') : ''}
          onCommit={(value) => apply(() => ({ label: value }))}
          className={`${selectClass} ${stringField('label').mixed ? 'placeholder:italic' : ''}`}
        />
      </div>
      {showPoles && (
        <div>
          <label className={labelClass}>{t('protections.polesConfig', 'Pole configuration')}</label>
          <MixedDropdown
            shared={resolveSharedValue(
              protections.map((item) => polesConfigToDisplay(item.polesConfig))
            )}
            options={[
              { value: '', label: '-' },
              ...sharedPoleOptions.map((value) => ({ value, label: value })),
            ]}
            onChange={(value) =>
              apply(() => ({
                polesConfig: (value || undefined) as ProtectionDevice['polesConfig'],
                poles: value ? polesFromConfig(value) : undefined,
              }))
            }
          />
        </div>
      )}
      {showNumericPoles && (
        <div>
          <label className={labelClass}>{t('protections.poles', 'Poles')}</label>
          <DebouncedTextInput
            type="number"
            min="1"
            step="1"
            value={numberField('poles').mixed ? '' : String(numberField('poles').value ?? '')}
            placeholder={numberField('poles').mixed ? t('properties.mixedValue', 'Mixed') : ''}
            onCommit={(value) => apply(() => ({ poles: value ? Number(value) : undefined }))}
            className={`${selectClass} ${numberField('poles').mixed ? 'placeholder:italic' : ''}`}
          />
        </div>
      )}
      {allRatingDropdown && (
        <div>
          <label className={labelClass}>{t('protections.rating', 'Rated current')} (A)</label>
          <MixedDropdown
            shared={resolveSharedValue(protections.map((item) => String(item.ratingA ?? '')))}
            options={[
              ...(protections.every((item) => item.type === 'RCD')
                ? [{ value: '', label: '-' }]
                : []),
              ...sharedRatingOptions.map((rating) => ({
                value: String(rating),
                label: `${rating} A`,
              })),
            ]}
            onChange={(value) => apply(() => ({ ratingA: value ? Number(value) : undefined }))}
          />
        </div>
      )}
      {allRatingNumber && (
        <div>
          <label className={labelClass}>{t('protections.rating', 'Rated current')} (A)</label>
          <DebouncedTextInput
            type="number"
            min="1"
            step="1"
            value={numberField('ratingA').mixed ? '' : String(numberField('ratingA').value ?? '')}
            placeholder={numberField('ratingA').mixed ? t('properties.mixedValue', 'Mixed') : ''}
            onCommit={(value) => apply(() => ({ ratingA: value ? Number(value) : undefined }))}
            className={`${selectClass} ${numberField('ratingA').mixed ? 'placeholder:italic' : ''}`}
          />
        </div>
      )}
      {showCurve && (
        <div>
          <label className={labelClass}>{t('protections.curve', 'Tripping curve')}</label>
          <MixedDropdown
            shared={stringField('curve')}
            options={['', 'B', 'C', 'D', 'F', 'K', 'MA', 'Z'].map((value) => ({
              value,
              label: value || '-',
            }))}
            onChange={(value) =>
              apply(() => ({ curve: (value || undefined) as ProtectionDevice['curve'] }))
            }
          />
        </div>
      )}
      {showBreakingCapacity && (
        <div>
          <label className={labelClass}>
            {t('protections.breakingCapacity', 'Breaking capacity')}
          </label>
          <MixedDropdown
            shared={resolveSharedValue(
              protections.map((item) =>
                allSpd
                  ? String(item.breakingCapacityKa ?? '')
                  : resolveBreakingCapacitySelectValue(
                      item.breakingCapacityOption,
                      item.breakingCapacityKa
                    )
              )
            )}
            options={
              allSpd
                ? protectionBreakingCapacityKaOptions(true).map((kA) => ({
                    value: String(kA),
                    label: `${kA} kA`,
                  }))
                : getBreakerBreakingCapacityOptions(installationProfile).map(({ value, label }) => ({ value, label }))
            }
            onChange={(value) => {
              if (allSpd) {
                apply(() => ({
                  breakingCapacityKa: value ? Number(value) : undefined,
                  breakingCapacityOption: undefined,
                }))
                return
              }
              const patch = breakingCapacityPatchFromSelectValue(value)
              apply(
                () =>
                  patch ?? {
                    breakingCapacityKa: undefined,
                    breakingCapacityOption: undefined,
                  }
              )
            }}
          />
        </div>
      )}
      {showResidual && (
        <>
          <div>
            <label className={labelClass}>{t('protections.sensitivity', 'Sensitivity')} (mA)</label>
            <MixedDropdown
              shared={resolveSharedValue(
                protections.map((item) =>
                  String(item.sensitivityMa ?? (item.type === 'RCBO' ? 300 : ''))
                )
              )}
              options={[
                ...(protections.every((item) => item.type === 'RCD')
                  ? [{ value: '', label: '-' }]
                  : []),
                ...sharedSensitivityOptions.map((value) => ({
                  value: String(value),
                  label: `${value} mA`,
                })),
              ]}
              onChange={(value) =>
                apply(() => ({ sensitivityMa: value ? Number(value) : undefined }))
              }
            />
          </div>
          <div>
            <label className={labelClass}>
              {t('protections.residualCurrentType', 'Residual current type')}
            </label>
            <MixedDropdown
              shared={resolveSharedValue(
                protections.map((item) => item.residualCurrentType ?? 'A')
              )}
              options={[
                { value: 'AC', label: t('protections.residualType_AC', 'AC (sinusoidal)') },
                { value: 'A', label: t('protections.residualType_A', 'A (pulsating DC)') },
                { value: 'F', label: t('protections.residualType_F', 'F (mixed frequency)') },
                { value: 'B', label: t('protections.residualType_B', 'B (smooth DC)') },
              ]}
              onChange={(value) =>
                apply(() => ({
                  residualCurrentType: value as ProtectionDevice['residualCurrentType'],
                }))
              }
            />
          </div>
        </>
      )}
      {showDeviceNotes && (
        <div>
          <label className={labelClass}>{t('protections.description', 'Description')}</label>
          <DebouncedTextarea
            value={stringField('notes').mixed ? '' : (stringField('notes').value ?? '')}
            placeholder={stringField('notes').mixed ? t('properties.mixedValue', 'Mixed') : ''}
            onCommit={(value) => apply(() => ({ notes: value }))}
            rows={3}
            className={`${selectClass} resize-none ${stringField('notes').mixed ? 'placeholder:italic' : ''}`}
          />
        </div>
      )}
    </div>
  )
}

function EndpointMultiEditor({ endpoints }: { endpoints: Endpoint[] }) {
  const { t } = useTranslation()
  const apply = (makePatch: (item: Endpoint) => Partial<Endpoint>) =>
    editProperties({
      edits: endpoints.map((item) => ({
        kind: 'endpoint',
        ids: [item.id],
        set: makePatch(item),
      })),
    })
  const shared = <T,>(read: (item: Endpoint) => T) => resolveSharedValue(endpoints.map(read))
  const first = endpoints[0]!
  const patchNested = <
    K extends
      | 'socketProps'
      | 'lightPointProps'
      | 'fixedApplianceProps'
      | 'hvacProps'
      | 'solarPanelProps'
      | 'batteryProps',
  >(
    _item: Endpoint,
    key: K,
    patch: Partial<NonNullable<Endpoint[K]>>
  ) => ({ [key]: patch }) as Partial<Endpoint>
  const allSolarPanels = endpoints.every((item) => item.symbol === 'solar_panel')
  const allBatteries = endpoints.every((item) => item.symbol === 'battery')
  const allModularSockets = endpoints.every(isModularSocket)
  const socketCountOptions = allModularSockets ? [1, 2] : STANDARD_SOCKET_COUNTS
  return (
    <div className="space-y-4">
      <BatchHeader count={endpoints.length} />
      {first.type === 'socket' && (
        <SocketTypeGrid
          currentSymbol={normalizeSocketSymbol(first.symbol)}
          mixed={shared((item) => normalizeSocketSymbol(item.symbol)).mixed}
          onChangeSymbol={(symbol) => apply(() => ({ symbol }))}
        />
      )}
      {first.type === 'light_point' && (
        <LightTypeDropdown
          value={(first.symbol ?? 'light_point') as SymbolKey}
          onChangeSymbol={(symbol) => apply(() => ({ symbol }))}
        />
      )}
      {first.type === 'switch' && (
        <SwitchTypeDropdown
          value={normalizeSwitchSymbol(first.symbol)}
          onChangeSymbol={(symbol) => apply(() => ({ symbol }))}
        />
      )}
      {endpoints.every(hasApplianceTypePicker) && (
        <ApplianceTypeDropdown
          value={first.symbol ?? 'fixed_appliance_generic'}
          onChangeSymbol={(symbol) => apply(() => ({ symbol }))}
        />
      )}
      <div>
        <label className={labelClass}>{t('endpoints.label', 'Label')}</label>
        <DebouncedTextInput
          value={
            shared((item) => item.label).mixed ? '' : (shared((item) => item.label).value ?? '')
          }
          placeholder={
            shared((item) => item.label).mixed ? t('properties.mixedValue', 'Mixed') : ''
          }
          onCommit={(value) => apply(() => ({ label: value }))}
          className={`${selectClass} ${shared((item) => item.label).mixed ? 'placeholder:italic' : ''}`}
        />
      </div>
      {first.type === 'socket' && (
        <>
          <div>
            <label className={labelClass}>{t('endpoints.socketCount', 'Socket count')}</label>
            <MixedDropdown
              shared={shared((item) => String(item.socketProps?.socketCount ?? 1))}
              options={socketCountOptions.map((value) => ({ value: String(value), label: String(value) }))}
              onChange={(value) =>
                apply((item) =>
                  patchNested(item, 'socketProps', {
                    socketCount: Number(value) <= 1 ? undefined : Number(value),
                  })
                )
              }
            />
          </div>
          {!allModularSockets && (
            <>
              <div className="space-y-2">
                <label className={labelClass}>{t('endpoints.socketOptions', 'Socket options')}</label>
                <div>
                  <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                    {t('endpoints.socketSwitchOption', 'Switch')}
                  </label>
                  <MixedDropdown
                    shared={shared((item) =>
                      item.socketProps?.switchOverlayLock
                        ? 'switch_lock'
                        : item.socketProps?.switchOverlay
                          ? 'switch'
                          : 'none'
                    )}
                    options={[
                      { value: 'none', label: t('endpoints.socketSwitchNone', 'None') },
                      {
                        value: 'switch',
                        label: t('endpoints.socketSwitchOverlay', 'Socket with two-pole switch'),
                      },
                      {
                        value: 'switch_lock',
                        label: t(
                          'endpoints.socketSwitchOverlayLock',
                          'Socket with two-pole lockable switch'
                        ),
                      },
                    ]}
                    onChange={(value) =>
                      apply((item) =>
                        isModularSocket(item)
                          ? {}
                          : patchNested(item, 'socketProps', {
                              switchOverlay: value === 'switch',
                              switchOverlayLock: value === 'switch_lock',
                            })
                      )
                    }
                  />
                </div>
              </div>
              <MixedCheckbox
                label={t('endpoints.waterproof', 'Waterproof')}
                shared={shared((item) => !!item.socketProps?.waterproof)}
                onChange={(value) =>
                  apply((item) =>
                    isModularSocket(item)
                      ? {}
                      : patchNested(item, 'socketProps', { waterproof: value })
                  )
                }
              />
            </>
          )}
        </>
      )}
      {first.type === 'light_point' && (
        <>
          {first.symbol === 'light_point' && (
            <LightPointOptionsGrid
              safety={shared((item) => !!item.lightPointProps?.safety).value ?? false}
              decentral={shared((item) => !!item.lightPointProps?.decentral).value ?? false}
              switch1p={shared((item) => !!item.lightPointProps?.switch1p).value ?? false}
              onWall={shared((item) => !!item.lightPointProps?.onWall).value ?? false}
              mixed={{
                safety: shared(
                  (item) => !!item.lightPointProps?.safety && !item.lightPointProps?.decentral
                ).mixed,
                decentral: shared((item) => !!item.lightPointProps?.decentral).mixed,
                switch1p: shared((item) => !!item.lightPointProps?.switch1p).mixed,
                onWall: shared((item) => !!item.lightPointProps?.onWall).mixed,
              }}
              onChange={() => undefined}
              onToggle={(key) => {
                const active = shared((item) =>
                  key === 'safety'
                    ? !!item.lightPointProps?.safety && !item.lightPointProps?.decentral
                    : !!item.lightPointProps?.[key]
                )
                const next = active.mixed ? true : !active.value
                apply((item) => {
                  const props = { ...(item.lightPointProps ?? {}) }
                  if (key === 'onWall') props.onWall = next
                  else if (key === 'switch1p') {
                    props.switch1p = next
                    if (next) {
                      props.safety = false
                      props.decentral = false
                      props.autonomous = false
                    }
                  } else if (key === 'safety') {
                    props.safety = next
                    props.decentral = false
                    props.autonomous = false
                    if (next) props.switch1p = false
                  } else {
                    props.decentral = next
                    props.autonomous = false
                    props.safety = next
                    if (next) props.switch1p = false
                  }
                  return { lightPointProps: props }
                })
              }}
            />
          )}
          {first.symbol === 'light_point' && (
            <MixedCheckbox
              label={t('endpoints.waterproof', 'Waterproof')}
              shared={shared((item) => !!item.lightPointProps?.waterproof)}
              onChange={(value) =>
                apply((item) => patchNested(item, 'lightPointProps', { waterproof: value }))
              }
            />
          )}
        </>
      )}
      {first.symbol === 'boiler' && (
        <MixedCheckbox
          label={t('endpoints.accumulating', 'Accumulating')}
          shared={shared((item) => !!item.fixedApplianceProps?.accumulating)}
          onChange={(value) =>
            apply((item) => patchNested(item, 'fixedApplianceProps', { accumulating: value }))
          }
        />
      )}
      {first.symbol === 'heating' && (
        <>
          <MixedCheckbox
            label={t('endpoints.accumulationHeating', 'Accumulation heating')}
            shared={shared((item) => !!item.fixedApplianceProps?.accumulationHeating)}
            onChange={(value) =>
              apply((item) =>
                patchNested(item, 'fixedApplianceProps', {
                  accumulationHeating: value,
                  ...(value ? {} : { withFan: false }),
                })
              )
            }
          />
          {endpoints.every((item) => !!item.fixedApplianceProps?.accumulationHeating) && (
            <MixedCheckbox
              label={t('endpoints.withFan', 'With fan')}
              shared={shared((item) => !!item.fixedApplianceProps?.withFan)}
              onChange={(value) =>
                apply((item) => patchNested(item, 'fixedApplianceProps', { withFan: value }))
              }
            />
          )}
        </>
      )}
      {first.symbol === 'furnace' && (
        <>
          <div>
            <label className={labelClass}>
              {t('endpoints.hvac.energySource', 'Energy source')}
            </label>
            <MixedDropdown
              shared={shared((item) => item.hvacProps?.energySource ?? 'none')}
              options={['electricity', 'gas_fan', 'gas_atmospheric', 'liquid', 'solid', 'none'].map(
                (value) => ({ value, label: t(`endpoints.hvac.energy_${value}`, value) })
              )}
              onChange={(value) =>
                apply((item) =>
                  patchNested(item, 'hvacProps', { energySource: value as HvacEnergySource })
                )
              }
            />
          </div>
          <div>
            <label className={labelClass}>{t('endpoints.hvac.type', 'Heating type')}</label>
            <MixedDropdown
              shared={shared((item) => item.hvacProps?.hvacType ?? 'none')}
              options={['heat_exchange', 'cogeneration', 'tap_spiral', 'boiler', 'none'].map(
                (value) => ({ value, label: t(`endpoints.hvac.type_${value}`, value) })
              )}
              onChange={(value) =>
                apply((item) => patchNested(item, 'hvacProps', { hvacType: value as HvacType }))
              }
            />
          </div>
          <div>
            <label className={labelClass}>{t('endpoints.hvac.function', 'Function')}</label>
            <MixedDropdown
              shared={shared((item) => item.hvacProps?.hvacFunction ?? 'none')}
              options={['none', 'heat', 'cool', 'heat_cool'].map((value) => ({
                value,
                label: t(`endpoints.hvac.function_${value}`, value),
              }))}
              onChange={(value) =>
                apply((item) =>
                  patchNested(item, 'hvacProps', { hvacFunction: value as HvacFunction })
                )
              }
            />
          </div>
        </>
      )}
      {allSolarPanels && (
        <div className="space-y-2 border-t border-gray-200 pt-2 dark:border-gray-700">
          <MixedNumberField
            label={t('endpoints.solarPanel.wattage', 'Wattage (Wp)')}
            shared={shared((item) => item.solarPanelProps?.wattageW ?? 1000)}
            onCommit={(value) =>
              apply((item) => patchNested(item, 'solarPanelProps', { wattageW: value }))
            }
          />
          <MixedNumberField
            label={t('endpoints.solarPanel.voltage', 'Voltage (V)')}
            shared={shared((item) => item.solarPanelProps?.voltageV)}
            onCommit={(value) =>
              apply((item) => patchNested(item, 'solarPanelProps', { voltageV: value }))
            }
          />
          <MixedTextField
            label={t('endpoints.certification.brand', 'Brand')}
            shared={shared((item) => item.solarPanelProps?.brand ?? '')}
            onCommit={(value) =>
              apply((item) =>
                patchNested(item, 'solarPanelProps', { brand: value, synergrid: undefined })
              )
            }
          />
          <MixedTextField
            label={t('endpoints.certification.model', 'Model')}
            shared={shared((item) => item.solarPanelProps?.model ?? '')}
            onCommit={(value) =>
              apply((item) =>
                patchNested(item, 'solarPanelProps', { model: value, synergrid: undefined })
              )
            }
          />
        </div>
      )}
      {allBatteries && (
        <div className="space-y-2 border-t border-gray-200 pt-2 dark:border-gray-700">
          <MixedNumberField
            label={t('endpoints.battery.voltage', 'Voltage (V)')}
            shared={shared((item) => item.batteryProps?.voltageV ?? 48)}
            onCommit={(value) =>
              apply((item) => patchNested(item, 'batteryProps', { voltageV: value }))
            }
          />
          <MixedNumberField
            label={t('endpoints.battery.capacity', 'Capacity (kWh)')}
            shared={shared((item) => item.batteryProps?.capacityKWh ?? 5)}
            step={0.1}
            onCommit={(value) =>
              apply((item) => patchNested(item, 'batteryProps', { capacityKWh: value }))
            }
          />
          <MixedTextField
            label={t('endpoints.certification.brand', 'Brand')}
            shared={shared((item) => item.batteryProps?.brand ?? '')}
            onCommit={(value) =>
              apply((item) =>
                patchNested(item, 'batteryProps', { brand: value, synergrid: undefined })
              )
            }
          />
          <MixedTextField
            label={t('endpoints.certification.model', 'Model')}
            shared={shared((item) => item.batteryProps?.model ?? '')}
            onCommit={(value) =>
              apply((item) =>
                patchNested(item, 'batteryProps', { model: value, synergrid: undefined })
              )
            }
          />
          <MixedNumberField
            label={t('endpoints.battery.powerKw', 'Power (kW)')}
            shared={shared((item) => item.batteryProps?.powerKw)}
            step={0.1}
            onCommit={(value) =>
              apply((item) =>
                patchNested(item, 'batteryProps', { powerKw: value, synergrid: undefined })
              )
            }
          />
        </div>
      )}
      <div>
        <label className={labelClass}>{t('endpoints.notes', 'Notes')}</label>
        <DebouncedTextarea
          value={
            shared((item) => item.notes ?? '').mixed
              ? ''
              : (shared((item) => item.notes ?? '').value ?? '')
          }
          placeholder={
            shared((item) => item.notes ?? '').mixed ? t('properties.mixedValue', 'Mixed') : ''
          }
          onCommit={(value) => apply(() => ({ notes: value }))}
          rows={3}
          className={`${selectClass} resize-none ${shared((item) => item.notes ?? '').mixed ? 'placeholder:italic' : ''}`}
        />
      </div>
    </div>
  )
}

type WireTarget = {
  circuit: Circuit
  segment: WireSegment
  sectionRef: CircuitSectionRef | null
  state: { cable: CableSpec; inTube?: boolean; wireRoute?: Circuit['wireRoute']; inWall?: boolean }
}

function WireMultiEditor({ selection }: { selection: Selection }) {
  const installationProfile = useInstallationProfile()
  const { t } = useTranslation()
  const segments = useEendraadWireSegments()
  const getCircuitById = useProjectStore((state: ProjectState) => state.getCircuitById)
  const targets = selection.ids
    .map((id): WireTarget | null => {
      const metadata = selection.wireMetadata?.find((item) => item.id === id)
      const segment =
        segments.find((item) => item.id === id) ??
        (metadata
          ? segments.find(
              (item) =>
                item.circuitId === metadata.circuitId &&
                item.panelId === metadata.panelId &&
                item.fromElementId === metadata.fromElementId &&
                item.toElementId === metadata.toElementId
            )
          : undefined)
      if (!segment?.circuitId || segment.isSupplyTrunk || segment.domoticaOutputGroup) return null
      const circuit = getCircuitById(segment.circuitId)
      if (!circuit) return null
      const originVertical =
        segment.type === 'branch'
          ? segments.find(
              (candidate) =>
                candidate.type === 'vertical' &&
                candidate.circuitId === segment.circuitId &&
                candidate.panelId === segment.panelId &&
                Math.abs(candidate.endPoint.y - segment.startPoint.y) < 0.5 &&
                Math.abs(candidate.endPoint.x - segment.startPoint.x) <= 2
            )
          : undefined
      const sectionRef = getSectionRefFromWireSegment(originVertical ?? segment)
      const section = findSectionWireOverrideWithFeederFallback(
        circuit,
        sectionRef,
        segment.feederProtectionId
      )
      const domain = circuit.domainWireOverrides?.[segment.domain ?? 'AC']
      const cable = section?.cable ?? domain?.cable ?? circuit.cable
      const wireRoute = section?.wireRoute ?? domain?.wireRoute ?? circuit.wireRoute
      return {
        circuit,
        segment,
        sectionRef,
        state: {
          cable,
          inTube: section?.inTube ?? domain?.inTube ?? circuit.inTube,
          wireRoute,
          inWall: section?.inWall ?? domain?.inWall ?? circuit.inWall,
        },
      }
    })
    .filter((item): item is WireTarget => !!item)
  if (targets.length !== selection.ids.length)
    return <UnsupportedMultiSelection count={selection.ids.length} />
  const shared = <T,>(read: (target: WireTarget) => T) => resolveSharedValue(targets.map(read))
  const apply = (makePatch: (target: WireTarget) => Partial<WireTarget['state']>) =>
    editProperties({
      wireEdits: targets.map((target) => ({
        circuitId: target.circuit.id,
        sectionRef: target.sectionRef,
        domain: target.segment.domain ?? 'AC',
        set: makePatch(target),
      })),
    })
  const route = shared((target) =>
    target.state.wireRoute === 'wall'
      ? target.state.inWall
        ? 'inWall'
        : 'onWall'
      : (target.state.wireRoute ?? 'none')
  )
  const wireTypeOptionsByTarget = targets.map((target) =>
    target.segment.domain === 'DC'
      ? getDcWireTypeOptions(t('wires.other', 'Other'), {
          batteryCable: t('wires.batteryCable', 'Battery cable'),
        })
      : getAcWireTypeOptions(t('wires.other', 'Other'))
  )
  const sharedWireTypeOptions = wireTypeOptionsByTarget[0]!.filter((option) =>
    wireTypeOptionsByTarget.every((options) =>
      options.some((candidate) => candidate.value === option.value)
    )
  )
  const conductorOptionsByTarget = targets.map((target) =>
    getWireConductorOptions(target.segment.domain === 'DC')
  )
  const sharedConductorOptions = conductorOptionsByTarget[0]!.filter((option) =>
    conductorOptionsByTarget.every((options) =>
      options.some((candidate) => candidate.value === option.value)
    )
  )
  const thicknessOptionsByTarget = targets.map((target) =>
    getWireSectionOptions(target.segment.domain === 'DC', installationProfile)
  )
  const sharedThicknessOptions = thicknessOptionsByTarget[0]!.filter((value) =>
    thicknessOptionsByTarget.every((options) => options.includes(value))
  )
  return (
    <div className="space-y-4">
      <BatchHeader count={targets.length} />
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('wires.routeLabel', 'Wire route')}
          </label>
          {route.mixed && (
            <span className="text-xs italic text-gray-500 dark:text-gray-400">
              {t('properties.mixedValue', 'Mixed')}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(
            [
              ['none', t('wires.routeNone', 'None')],
              ['inWall', t('wires.inWall', 'In wall')],
              ['onWall', t('wires.onWall', 'On wall')],
              ['ground', t('wires.inGround', 'Ground')],
              ['air', t('wires.inAir', 'Air')],
            ] as const
          ).map(([value, label]) => {
            const active = !route.mixed && route.value === value
            return (
              <button
                key={value}
                type="button"
                onClick={() =>
                  apply(() =>
                    value === 'inWall'
                      ? { wireRoute: 'wall', inWall: true }
                      : value === 'onWall'
                        ? { wireRoute: 'wall', inWall: false }
                        : value === 'none'
                          ? { wireRoute: undefined, inWall: false }
                          : { wireRoute: value, inWall: false }
                  )
                }
                className={`flex min-h-12 items-center justify-center rounded-md border-2 px-2 py-2 text-xs font-medium transition-colors ${
                  active
                    ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
                    : 'border-gray-300 text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:text-gray-300'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
      {(() => {
        const tube = shared((target) => !!target.state.inTube)
        return (
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('wires.inTube', 'Tube')}
              </label>
              {tube.mixed && (
                <span className="text-xs italic text-gray-500 dark:text-gray-400">
                  {t('properties.mixedValue', 'Mixed')}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => apply(() => ({ inTube: tube.mixed ? true : !tube.value }))}
              className={`flex flex-col items-center justify-center rounded-md border-2 px-2 py-2 text-xs font-medium transition-colors ${
                !tube.mixed && tube.value
                  ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
                  : 'border-gray-300 text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:text-gray-300'
              }`}
            >
              <span className="h-5 w-5 rounded-full border border-current" />
              <span className="mt-0.5">{t('wires.inTube', 'Tube')}</span>
            </button>
          </div>
        )
      })()}
      <div>
        <label className={labelClass}>{t('wires.type', 'Type')}</label>
        <MixedDropdown
          shared={shared((target) => target.state.cable.kind)}
          options={sharedWireTypeOptions}
          onChange={(value) =>
            apply((target) => ({
              cable: applyCableKindChange(target.state.cable, value as CableSpec['kind']),
            }))
          }
        />
      </div>
      <div>
        <label className={labelClass}>{t('wires.conductors', 'Conductors')}</label>
        <MixedDropdown
          shared={shared((target) =>
            resolveConductorDropdownValue(target.state.cable, target.segment.domain === 'DC')
          )}
          options={sharedConductorOptions}
          onChange={(value) => {
            const option = sharedConductorOptions.find((candidate) => candidate.value === value)
            if (!option) return
            apply((target) => ({
              cable: {
                ...target.state.cable,
                conductors: option.conductors,
                hasPE: option.hasPE,
              },
            }))
          }}
        />
      </div>
      <div>
        <label className={labelClass}>{t('wires.thickness', 'Section')}</label>
        <MixedDropdown
          shared={shared((target) => String(target.state.cable.sectionMm2))}
          options={sharedThicknessOptions.map((value) => ({
            value: String(value),
            label: `${value} mm²`,
          }))}
          onChange={(value) =>
            apply((target) => ({ cable: { ...target.state.cable, sectionMm2: Number(value) } }))
          }
        />
      </div>
    </div>
  )
}

export function UnsupportedMultiSelection({ count }: { count: number }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/20">
      <p className="text-sm text-gray-700 dark:text-gray-300">
        {t('properties.multiSelectUnsupported', 'These items cannot be edited together.')}
      </p>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {t('properties.selectedCount', '{{count}} items selected', { count })}
      </p>
    </div>
  )
}

export function MultiSelectionPropertiesEditor({ selection }: { selection: Selection }) {
  const protections = useProjectStore(
    useShallow((state: ProjectState) =>
      selection.type === 'protection'
        ? selection.ids
            .map((id) => state.getProtectionById(id))
            .filter((item): item is ProtectionDevice => !!item)
        : []
    )
  )
  const endpoints = useProjectStore(
    useShallow((state: ProjectState) =>
      selection.type === 'endpoint'
        ? selection.ids
            .map((id) => state.getEndpointById(id))
            .filter((item): item is Endpoint => !!item)
        : []
    )
  )
  const placementEndpoints = useProjectStore(
    useShallow((state: ProjectState) => {
      if (selection.type !== 'placement') return []
      const byId = new Map<string, Endpoint>()
      for (const placementId of selection.ids) {
        const endpointId = state.getPlacementById(placementId)?.endpointId
        const endpoint = endpointId ? state.getEndpointById(endpointId) : undefined
        if (endpoint) byId.set(endpoint.id, endpoint)
      }
      return [...byId.values()]
    })
  )
  if (selection.type === 'protection' && protections.length === selection.ids.length)
    return <ProtectionMultiEditor protections={protections} />
  if (selection.type === 'endpoint' && endpoints.length === selection.ids.length) {
    const families = new Set(endpoints.map(getEndpointMultiEditFamily))
    if (families.size === 1 && !families.has(null))
      return <EndpointMultiEditor endpoints={endpoints} />
  }
  if (selection.type === 'placement' && placementEndpoints.length > 0) {
    const families = new Set(placementEndpoints.map(getEndpointMultiEditFamily))
    const allPlacementsResolved = selection.ids.every((id) => {
      const placement = useProjectStore.getState().getPlacementById(id)
      return (
        !!placement?.endpointId &&
        !!useProjectStore.getState().getEndpointById(placement.endpointId)
      )
    })
    if (allPlacementsResolved && families.size === 1 && !families.has(null))
      return <EndpointMultiEditor endpoints={placementEndpoints} />
  }
  if (selection.type === 'wire') return <WireMultiEditor selection={selection} />
  return <UnsupportedMultiSelection count={selection.ids.length} />
}
