import { useId, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { DebouncedTextInput } from '@/components/forms'
import CustomDropdown, { type CustomDropdownOption } from '@/components/common/CustomDropdown'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import {
  CONTROL_SYSTEMS,
  type ControlAddressing,
  type ControlDeviceFields,
  type ControlSystem,
  type DomoticaDeviceProps,
  type DomoticaOutputWireProps,
  type Endpoint,
} from '@/types/schema'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { editProperties } from '@/handlers/properties/editProperties'
import { getDomoticaBusContext, getDomoticaBusLabel } from '@/lib/controlLink/domoticaBus'
import {
  buildControlDeviceIndex,
  canLinkControlDevice,
  collectControlLinkEntries,
  CONTROL_LINK_NOTE_SEPARATOR,
  getConnectionDirection,
  rebindControlLink,
  getChannelCapacity,
  getNextFreeChannel,
  issuesForConnection,
  normalizeChannel,
  validateControlDevices,
  type ConnectedEndpointEntry,
  type ControlDeviceEntry,
  type ControlDeviceIssue,
} from '@/lib/controlLink/controlLink'
import {
  getControlButtonAddress,
  getControlButtonCount,
  setControlButtonAddress,
} from '@/lib/controlLink/buttonAddressing'
import { getOutputChannelOptions } from '@/lib/controlLink/controlDevicePicker'
import {
  cancelControlDevicePick,
  startControlDevicePick,
  useControlDevicePickTarget,
} from '@/handlers/controlDeviceCanvasPick'
import { ControlDevicePicker } from './ControlDevicePicker'
import {
  addressKey,
  deviceUsesGroups,
  formatGroups,
  getChannelSystem,
  normalizeGroups,
  parseGroupsInput,
} from '@/lib/controlLink/controlAddress'
import { labelClass } from '../shared/propertiesSharedUtils'

const NONE_VALUE = ''
const inputClass =
  'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500'
const warningClass = 'mt-1 text-xs text-amber-600 dark:text-amber-400'

/**
 * One open/closed state for every domotica group, remembered across selections (and, when
 * storage is available, sessions), so users who never use addressing never see it expanded.
 */
const DOMOTICA_GROUP_STORAGE_KEY = 'condui.properties.domoticaGroupOpen'
const domoticaGroupListeners = new Set<() => void>()
let domoticaGroupOpen = (() => {
  try {
    return globalThis.localStorage?.getItem(DOMOTICA_GROUP_STORAGE_KEY) === '1'
  } catch {
    return false
  }
})()

function setDomoticaGroupOpen(open: boolean) {
  domoticaGroupOpen = open
  try {
    globalThis.localStorage?.setItem(DOMOTICA_GROUP_STORAGE_KEY, open ? '1' : '0')
  } catch {
    // Storage is a convenience only.
  }
  domoticaGroupListeners.forEach((listener) => listener())
}

function useDomoticaGroupOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      domoticaGroupListeners.add(listener)
      return () => domoticaGroupListeners.delete(listener)
    },
    () => domoticaGroupOpen
  )
}

function DomoticaGroup({
  title,
  summary,
  warning,
  children,
}: {
  title: string
  summary?: string
  warning?: boolean
  children: ReactNode
}) {
  const open = useDomoticaGroupOpen()
  return (
    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-left text-sm font-medium text-gray-700 dark:text-gray-200"
        aria-expanded={open}
        onClick={() => setDomoticaGroupOpen(!open)}
      >
        <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        {title}
        {!open && (summary || warning) && (
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-xs font-normal text-gray-500 dark:text-gray-400">
            {summary && <span className="truncate">{summary}</span>}
            {warning && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />}
          </span>
        )}
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  )
}

function useElectricalPanels() {
  const project = useProjectStore((state: ProjectState) => state.currentProject)
  return useMemo(() => (project ? getProjectElectricalPanels(project) : []), [project])
}

function useControlDeviceState() {
  const panels = useElectricalPanels()
  const index = useMemo(() => buildControlDeviceIndex(panels), [panels])
  const issues = useMemo(() => validateControlDevices(panels), [panels])
  return { panels, index, issues }
}

function sameGroups(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return formatGroups(normalizeGroups(left)) === formatGroups(normalizeGroups(right))
}

function useSystemLabel() {
  const { t } = useTranslation()
  return (system: ControlSystem | undefined) =>
    system ? t(`endpoints.domotica.systems.${system}`, system) : ''
}

/** Warning lines for one connection's issues. */
function ConnectionWarnings({
  issues,
  system,
}: {
  issues: ControlDeviceIssue[]
  system: ControlSystem | undefined
}) {
  const { t } = useTranslation()
  const systemLabel = useSystemLabel()
  const lines = new Set<string>()
  for (const issue of issues) {
    if (issue.kind === 'duplicate-channel') {
      lines.add(t('endpoints.controlLink.duplicateChannel', 'Channel already used'))
    } else if (issue.kind === 'invalid-channel') {
      lines.add(
        t('endpoints.controlLink.invalidChannel', 'Channel does not match the {{system}} format', {
          system: systemLabel(system),
        })
      )
    } else if (issue.kind === 'invalid-group') {
      lines.add(t('endpoints.controlLink.invalidGroup', 'Group {{group}} is not valid', { group: issue.group }))
    }
  }
  return (
    <>
      {[...lines].map((line) => (
        <p key={line} className={warningClass}>
          {line}
        </p>
      ))}
    </>
  )
}

/** Channel and (when the device's system uses them) groups of one connection. */
/** Output channel chips: free, used by another endpoint, or this endpoint's own channel. */
function ChannelChips({
  device,
  endpointId,
  channel,
  onPick,
}: {
  device: ControlDeviceEntry
  endpointId: string
  channel: string | undefined
  onPick: (channel: string) => void
}) {
  const options = getOutputChannelOptions(device)
  if (!options) return null
  const usedBy = new Map<string, string>()
  for (const entry of device.connections) {
    if (entry.bus || entry.direction !== 'output' || entry.endpoint.id === endpointId || entry.channel == null) continue
    usedBy.set(addressKey(entry.channel), entry.endpoint.label.trim() || '?')
  }
  const current = channel != null ? addressKey(channel) : undefined
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {options.map((option) => {
        const key = addressKey(option)
        const owner = usedBy.get(key)
        const isCurrent = key === current
        return (
          <button
            key={option}
            type="button"
            title={owner}
            aria-pressed={isCurrent}
            onClick={() => onPick(option)}
            className={`min-w-7 rounded px-1.5 py-0.5 text-xs tabular-nums ${
              isCurrent
                ? owner
                  ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-400 dark:bg-amber-900/50 dark:text-amber-100'
                  : 'bg-sky-100 text-sky-800 ring-1 ring-sky-400 dark:bg-sky-900/60 dark:text-sky-100'
                : owner
                  ? 'bg-gray-100 text-gray-400 line-through dark:bg-gray-700/60 dark:text-gray-500'
                  : 'border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}

function ControlAddressingInputs({
  endpointId,
  resetKey = endpointId,
  device,
  chipsDevice,
  addressing,
  issues,
  onChange,
  bus = false,
}: {
  endpointId: string
  resetKey?: string
  device: ControlDeviceFields | undefined
  /** Device whose free output channels are offered as chips. */
  chipsDevice?: ControlDeviceEntry
  addressing: ControlAddressing
  issues: ControlDeviceIssue[]
  onChange: (next: ControlAddressing) => void
  bus?: boolean
}) {
  const { t } = useTranslation()
  const channelId = useId()
  const groupsId = useId()
  const showGroups = bus || deviceUsesGroups(device) || normalizeGroups(addressing.groups).length > 0
  const namedFunctions = bus && device?.system !== 'knx' && device?.system !== 'dali'
  return (
    <div className="space-y-2">
      <div>
        <label htmlFor={channelId} className={labelClass}>{t('endpoints.controlLink.channel', 'Channel')}</label>
        <DebouncedTextInput
          id={channelId}
          type="text"
          className={inputClass}
          placeholder={t('endpoints.controlLink.channelPlaceholder', '3, C, Q7')}
          value={normalizeChannel(addressing.channel) ?? ''}
          resetKey={resetKey}
          onCommit={(value) =>
            onChange({ ...addressing, channel: value.trim() === '' ? undefined : value.trim() })
          }
        />
        {chipsDevice && (
          <ChannelChips
            device={chipsDevice}
            endpointId={endpointId}
            channel={normalizeChannel(addressing.channel)}
            onPick={(channel) => onChange({ ...addressing, channel })}
          />
        )}
      </div>
      {showGroups && (
        <div>
          <label htmlFor={groupsId} className={labelClass}>{namedFunctions
            ? t('endpoints.controlLink.functions', 'Functions')
            : t('endpoints.controlLink.groups', 'Groups')}</label>
          <DebouncedTextInput
            id={groupsId}
            type="text"
            className={inputClass}
            placeholder={namedFunctions ? undefined : t('endpoints.controlLink.groupsPlaceholder', '1/1/3, 1/4/3')}
            value={formatGroups(addressing.groups)}
            resetKey={resetKey}
            onCommit={(value) => {
              const groups = namedFunctions ? normalizeGroups(value.split(/[,;\n]+/)) : parseGroupsInput(value)
              if (!sameGroups(groups, addressing.groups)) onChange({ ...addressing, groups })
            }}
          />
        </div>
      )}
      <ConnectionWarnings issues={issues} system={getChannelSystem(device)} />
    </div>
  )
}

/** Advanced per-button fields stay folded away unless the user needs addressing. */
function ControlConnectionAddressFields({
  endpoint,
  endpointId,
  device,
  chipsDevice,
  addressing,
  issues,
  onChange,
  bus = false,
}: {
  endpoint: Endpoint
  endpointId: string
  device: ControlDeviceFields | undefined
  chipsDevice?: ControlDeviceEntry
  addressing: ControlAddressing
  issues: ControlDeviceIssue[]
  onChange: (next: ControlAddressing) => void
  bus?: boolean
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState(0)
  const count = getControlButtonCount(endpoint)
  const isInput = getConnectionDirection(endpoint) === 'input'
  if (!isInput) {
    const inputs = <ControlAddressingInputs {...{ endpointId, device, chipsDevice, addressing, issues, onChange, bus }} />
    return bus ? <details className="rounded-md border border-gray-200 p-2 dark:border-gray-700">
      <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-200">{t('endpoints.controlLink.functions', 'Functions')}</summary>
      <div className="mt-2">{inputs}</div>
    </details> : inputs
  }
  const perButton = count > 1 || !!addressing.buttonAddresses?.length
  const renderButton = (buttonIndex: number) => {
    const value = getControlButtonAddress(addressing, buttonIndex)
    return (
      <ControlAddressingInputs
        endpointId={endpointId}
        resetKey={`${endpointId}:button:${buttonIndex}`}
        device={device}
        bus={bus}
        addressing={value}
        issues={issuesForConnection(issues, endpointId, buttonIndex)}
        onChange={({ channel, groups }) => onChange(perButton
          ? setControlButtonAddress(addressing, buttonIndex, { channel, groups })
          : { ...addressing, channel, groups })}
      />
    )
  }
  if (count === 1 && !bus) return renderButton(0)
  const pageSize = 20
  const pageStart = Math.min(page * pageSize, Math.floor((count - 1) / pageSize) * pageSize)
  const shown = Math.min(pageSize, count - pageStart)
  return (
    <details key={endpointId} className="rounded-md border border-gray-200 p-2 dark:border-gray-700">
      <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-200">
        {t('endpoints.controlLink.buttonAddresses', 'Button addresses')}
      </summary>
      <div className="mt-2 space-y-3">
        {Array.from({ length: shown }, (_, offset) => {
          const index = pageStart + offset
          return (
            <fieldset key={index} className="min-w-0">
              <legend className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-400">
                {t('endpoints.controlLink.buttonNumber', 'Button {{number}}', { number: index + 1 })}
              </legend>
              {renderButton(index)}
            </fieldset>
          )
        })}
        {count > pageSize && (
          <div className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-400">
            <button type="button" disabled={pageStart === 0} onClick={() => setPage(pageStart / pageSize - 1)} className="disabled:opacity-40">
              {t('endpoints.controlLink.previousButtons', 'Previous')}
            </button>
            <span>{pageStart + 1}–{pageStart + shown} / {count}</span>
            <button type="button" disabled={pageStart + shown >= count} onClick={() => setPage(pageStart / pageSize + 1)} className="disabled:opacity-40">
              {t('endpoints.controlLink.nextButtons', 'Next')}
            </button>
          </div>
        )}
      </div>
    </details>
  )
}

/** The existing output string remains standard until its connection is explicitly marked bus. */
function DomoticaStringConnectionFields({
  parent, wire, onChange,
}: {
  parent: Endpoint
  wire: DomoticaOutputWireProps
  onChange: (patch: Partial<DomoticaOutputWireProps>) => void
}) {
  const { t } = useTranslation()
  const systemLabel = useSystemLabel()
  const connectionId = useId()
  const nameId = useId()
  const systemId = useId()
  const bus = wire.connectionType === 'bus'
  const inherited = systemLabel(parent.domoticaProps?.system)
  return <div className="space-y-2">
    <div>
      <label htmlFor={connectionId} className={labelClass}>{t('endpoints.controlLink.connection', 'Connection')}</label>
      <CustomDropdown id={connectionId} ariaLabel={t('endpoints.controlLink.connection', 'Connection')}
        value={bus ? 'bus' : 'standard'}
        onChange={(value) => onChange({ connectionType: value === 'bus' ? 'bus' : undefined })}
        options={[
          { value: 'standard', label: t('endpoints.controlLink.standard', 'Standard') },
          { value: 'bus', label: t('endpoints.controlLink.bus', 'Bus') },
        ]} />
    </div>
    {bus && <>
      <div>
        <label htmlFor={nameId} className={labelClass}>{t('endpoints.controlLink.busName', 'Bus name')}</label>
        <DebouncedTextInput id={nameId} className={inputClass} value={wire.busName ?? ''}
          resetKey={nameId} onCommit={(value) => onChange({ busName: value.trim() || undefined })} />
      </div>
      <div>
        <label htmlFor={systemId} className={labelClass}>{t('endpoints.domotica.system', 'System')}</label>
        <CustomDropdown id={systemId} ariaLabel={t('endpoints.controlLink.busSystem', 'Bus system')}
          value={wire.busSystem ?? ''} onChange={(value) => onChange({ busSystem: (value || undefined) as ControlSystem | undefined })}
          options={[
            { value: '', label: [t('endpoints.controlLink.moduleSystem', 'Module system'), inherited].filter(Boolean).join(' · ') },
            ...CONTROL_SYSTEMS.map((system) => ({ value: system, label: systemLabel(system) })),
          ]} />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input type="checkbox" checked={wire.showBusLabel !== false} onChange={(event) => onChange({ showBusLabel: event.target.checked })} />
        {t('endpoints.controlLink.showBusLabel', 'Show bus label')}
      </label>
    </>}
  </div>
}

/** Shared with selected wire properties; changes reuse properties.edit and its palette entry. */
export function DomoticaOutputConnectionFields({
  parent, outputGroup, outputIndex,
}: {
  parent: Endpoint
  outputGroup: 'control' | 'endpoint'
  outputIndex: number
}) {
  const { t } = useTranslation()
  const wire = (outputGroup === 'control' ? parent.domoticaProps?.controlOutputWires : parent.domoticaProps?.endpointOutputWires)?.[outputIndex] ?? {}
  return <DomoticaGroup title={t('endpoints.controlLink.section', 'Domotics')}
    summary={wire.connectionType === 'bus' ? t('endpoints.controlLink.bus', 'Bus') : undefined}>
    <DomoticaStringConnectionFields key={`${parent.id}:${outputGroup}:${outputIndex}`} parent={parent} wire={wire} onChange={(set) => {
      editProperties({ edits: [{ kind: 'domoticaOutputWire', ids: [parent.id], outputGroup, outputIndex, set }] })
    }} />
  </DomoticaGroup>
}

/** Channel and groups for an endpoint wired to a domotica module. */
export function DomoticaChildAddressFields({
  endpointId,
  endpoint,
  onUpdate,
}: {
  endpointId: string
  endpoint: Endpoint
  onUpdate: (id: string, updates: Partial<Endpoint>) => void
}) {
  const { t } = useTranslation()
  const { panels, index, issues } = useControlDeviceState()
  const identityId = useId()
  const child = endpoint.domoticaChildProps
  if (!child) return null
  const device = index.devices.get(child.parentEndpointId)
  const bus = getDomoticaBusContext(panels, endpoint)
  const parent = device?.endpoint ?? collectControlLinkEntries(panels).find(({ endpoint: candidate }) => candidate.id === child.parentEndpointId)?.endpoint
  const wire = (child.outputGroup === 'control' ? parent?.domoticaProps?.controlOutputWires : parent?.domoticaProps?.endpointOutputWires)?.[child.outputIndex] ?? {}
  const identityIssues = issues.filter((issue) => (issue.kind === 'invalid-bus-device-address' && issue.endpointId === endpointId) ||
    (issue.kind === 'duplicate-bus-device-address' && issue.endpointIds.includes(endpointId)))
  const connectionIssues = issuesForConnection(issues, endpointId)
  const isOutput = getConnectionDirection(endpoint, 'wired') === 'output'
  return (
    <DomoticaGroup
      title={t('endpoints.controlLink.section', 'Domotics')}
      summary={bus ? getDomoticaBusLabel(bus) || t('endpoints.controlLink.bus', 'Bus') : getConnectionDirection(endpoint) === 'input'
        ? getControlButtonAddress(child, 0).channel
        : normalizeChannel(child.channel)}
      warning={connectionIssues.length > 0}
    >
      {parent && <DomoticaStringConnectionFields key={`${parent.id}:${child.outputGroup}:${child.outputIndex}`} parent={parent} wire={wire} onChange={(set) => {
        editProperties({ edits: [{ kind: 'domoticaOutputWire', ids: [parent.id], outputGroup: child.outputGroup, outputIndex: child.outputIndex, set }] })
      }} />}
      {bus && <div className="space-y-2 border-t border-gray-200 pt-2 dark:border-gray-700">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {t('endpoints.controlLink.connectedTo', 'Connected to')} · {parent?.label} · {wire.busName?.trim() || t('endpoints.controlLink.bus', 'Bus')}
        </div>
        <div>
          <label htmlFor={identityId} className={labelClass}>{bus.system === 'qbus' || bus.system === 'loxone'
            ? t('endpoints.controlLink.serialNumber', 'Serial number')
            : t('endpoints.domotica.deviceAddress', 'Device address')}</label>
          <DebouncedTextInput id={identityId} className={inputClass} value={endpoint.busDeviceProps?.deviceAddress ?? ''}
            resetKey={endpointId} onCommit={(value) => onUpdate(endpointId, { busDeviceProps: { ...endpoint.busDeviceProps, deviceAddress: value.trim() || undefined } })} />
          {identityIssues.map((issue) => <p key={issue.kind} className={warningClass}>
            {issue.kind === 'duplicate-bus-device-address'
              ? t('endpoints.controlLink.duplicateDeviceAddress', 'Device address already used on this bus')
              : t('endpoints.domotica.invalidDeviceAddress', 'Address does not match the {{system}} format', { system: bus.system?.toUpperCase() ?? '' })}
          </p>)}
        </div>
      </div>}
      <ControlConnectionAddressFields
        key={endpointId}
        endpoint={endpoint}
        endpointId={endpointId}
        device={bus ? { system: bus.system } : device?.fields}
        chipsDevice={isOutput && !bus ? device : undefined}
        bus={!!bus}
        addressing={child}
        issues={connectionIssues}
        onChange={(addressing) =>
          onUpdate(endpointId, { domoticaChildProps: { ...child, ...addressing } })
        }
      />
    </DomoticaGroup>
  )
}

/**
 * "Operated by" section for a contact (or "Connected to" for a switch or pushbutton): pick a
 * domotica module or relay and the channel on it.
 */
export function ControlLinkOperatedByFields({
  endpointId,
  endpoint,
  onUpdate,
}: {
  endpointId: string
  endpoint: Endpoint
  onUpdate: (id: string, updates: Partial<Endpoint>) => void
}) {
  const { t } = useTranslation()
  const { panels, index, issues } = useControlDeviceState()
  const pickTarget = useControlDevicePickTarget()
  const link = endpoint.controlLink
  const direction = getConnectionDirection(endpoint, 'linked')
  const devices = useMemo(() => [...index.devices.values()].filter((device) =>
    canLinkControlDevice(panels, endpoint, device.endpoint.id)
  ), [index, panels, endpoint])
  const linkedDevice = link ? index.devices.get(link.deviceId) : undefined
  const contextCircuitId = useMemo(
    () => collectControlLinkEntries(panels).find((entry) => entry.endpoint.id === endpointId)?.circuit.id,
    [panels, endpointId]
  )

  const connectionIssues = issuesForConnection(issues, endpointId)
  const summary = linkedDevice
    ? [linkedDevice.endpoint.label.trim() || '?', direction === 'input'
      ? getControlButtonAddress(link, 0).channel
      : normalizeChannel(link?.channel)]
        .filter(Boolean)
        .join(CONTROL_LINK_NOTE_SEPARATOR)
    : undefined

  return (
    <DomoticaGroup
      title={t('endpoints.controlLink.controlSection', 'Control')}
      summary={summary}
      warning={connectionIssues.length > 0 || (link != null && !linkedDevice)}
    >
      <div>
        <label className={labelClass}>
          {direction === 'input'
            ? t('endpoints.controlLink.connectedTo', 'Connected to')
            : t('endpoints.controlLink.operatedBy', 'Operated by')}
        </label>
        <ControlDevicePicker
          value={link?.deviceId}
          devices={devices}
          panels={panels}
          contextCircuitId={contextCircuitId}
          missing={link != null && !linkedDevice}
          onChange={(deviceId) =>
            onUpdate(endpointId, {
              controlLink: rebindControlLink(endpoint, deviceId,
                deviceId ? getNextFreeChannel(panels, deviceId, endpointId, direction) || undefined : undefined),
            })
          }
          onPickOnCanvas={() => startControlDevicePick(endpointId)}
        />
        {pickTarget === endpointId && (
          <p className="mt-1 flex items-center gap-2 text-xs text-sky-700 dark:text-sky-300">
            {t('endpoints.controlLink.pickHint', 'Click a device on the canvas')}
            <button
              type="button"
              className="underline hover:no-underline"
              onClick={() => cancelControlDevicePick()}
            >
              {t('common.cancel', 'Cancel')}
            </button>
          </p>
        )}
      </div>
      {link && (
        <ControlConnectionAddressFields
          key={endpointId}
          endpoint={endpoint}
          endpointId={endpointId}
          device={linkedDevice?.fields}
          chipsDevice={direction === 'output' ? linkedDevice : undefined}
          addressing={link}
          issues={connectionIssues}
          onChange={(addressing) =>
            onUpdate(endpointId, { controlLink: { ...link, ...addressing } })
          }
        />
      )}
      {endpoint.symbol === 'relay' && <RelayOperatedContactsFields endpointId={endpointId} withinGroup />}
    </DomoticaGroup>
  )
}

/** Collapsed domotica group on a domotica module: system, bus address, line, capacity. */
export function ControlDeviceAddressingFields({
  endpointId,
  endpoint,
  onUpdate,
}: {
  endpointId: string
  endpoint: Endpoint
  onUpdate: (id: string, updates: Partial<Endpoint>) => void
}) {
  const { t } = useTranslation()
  const systemLabel = useSystemLabel()
  const { index, issues } = useControlDeviceState()
  const deviceProps: DomoticaDeviceProps = endpoint.domoticaProps ?? {}
  const device = index.devices.get(endpointId)
  const capacity = device ? getChannelCapacity(device) : undefined
  const addressIssue = issues.some(
    (issue) => issue.kind === 'invalid-device-address' && issue.deviceId === endpointId
  )
  const overCapacity = issues.some((issue) => issue.kind === 'over-capacity' && issue.deviceId === endpointId)
  const deviceHasIssues = issues.some((issue) => issue.deviceId === endpointId)
  const summary = [
    deviceProps.system ? systemLabel(deviceProps.system) : undefined,
    capacity && capacity.used > 0 ? `${capacity.used}/${capacity.capacity}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  const update = (fields: Partial<ControlDeviceFields>) =>
    onUpdate(endpointId, { domoticaProps: { ...deviceProps, ...fields } })
  const systemOptions = (unsetLabel: string): CustomDropdownOption[] => [
    { value: NONE_VALUE, label: unsetLabel },
    ...CONTROL_SYSTEMS.map((system) => ({ value: system, label: systemLabel(system) })),
  ]
  const textField = (value: string | undefined) => (value?.trim() ? value.trim() : undefined)

  return (
    <DomoticaGroup
      title={t('endpoints.controlLink.section', 'Domotics')}
      summary={summary || undefined}
      warning={deviceHasIssues}
    >
      <div>
        <label className={labelClass}>{t('endpoints.domotica.system', 'System')}</label>
        <CustomDropdown
          value={deviceProps.system ?? NONE_VALUE}
          onChange={(value) =>
            update({ system: value === NONE_VALUE ? undefined : (value as ControlSystem) })
          }
          options={systemOptions(t('endpoints.domotica.systems.unspecified', 'Not specified'))}
        />
      </div>
      {deviceProps.system && (
        <div>
          <label className={labelClass}>{t('endpoints.domotica.outputSystem', 'Gateway to')}</label>
          <CustomDropdown
            value={deviceProps.outputSystem ?? NONE_VALUE}
            onChange={(value) =>
              update({ outputSystem: value === NONE_VALUE ? undefined : (value as ControlSystem) })
            }
            options={systemOptions(t('endpoints.domotica.outputSystem_none', 'No gateway'))}
          />
        </div>
      )}
      <div>
        <label className={labelClass}>{t('endpoints.domotica.deviceAddress', 'Device address')}</label>
        <DebouncedTextInput
          type="text"
          className={inputClass}
          placeholder={t('endpoints.domotica.deviceAddressPlaceholder', '1.1.12')}
          value={deviceProps.deviceAddress ?? ''}
          resetKey={endpointId}
          onCommit={(value) => update({ deviceAddress: textField(value) })}
        />
        {addressIssue && (
          <p className={warningClass}>
            {t('endpoints.domotica.invalidDeviceAddress', 'Address does not match the {{system}} format', {
              system: systemLabel(deviceProps.system),
            })}
          </p>
        )}
      </div>
      {(getChannelSystem(deviceProps) === 'dali' || deviceProps.line != null) && (
        <div>
          <label className={labelClass}>{t('endpoints.domotica.line', 'Line')}</label>
          <DebouncedTextInput
            type="text"
            className={inputClass}
            value={deviceProps.line ?? ''}
            resetKey={endpointId}
            onCommit={(value) => update({ line: textField(value) })}
          />
        </div>
      )}
      <div>
        <label className={labelClass}>{t('endpoints.domotica.channelCount', 'Channels')}</label>
        <DebouncedTextInput
          type="number"
          min={1}
          className={inputClass}
          placeholder={capacity ? String(capacity.capacity) : undefined}
          value={deviceProps.channelCount != null ? String(deviceProps.channelCount) : ''}
          resetKey={endpointId}
          onCommit={(value) => {
            const parsed = Math.floor(Number(value))
            update({ channelCount: value.trim() !== '' && parsed > 0 ? parsed : undefined })
          }}
        />
        {overCapacity && capacity && (
          <p className={warningClass}>
            {t('endpoints.domotica.overCapacity', '{{used}} of {{capacity}} channels used', {
              used: capacity.used,
              capacity: capacity.capacity,
            })}
          </p>
        )}
      </div>
      <ControlLinkConnectedList deviceId={endpointId} />
    </DomoticaGroup>
  )
}

/** Connections of a relay: contacts it operates on other circuits and the switches that signal it. */
export function RelayOperatedContactsFields({ endpointId, withinGroup = false }: { endpointId: string; withinGroup?: boolean }) {
  const { t } = useTranslation()
  const { index, issues } = useControlDeviceState()
  const device = index.devices.get(endpointId)
  if (device?.kind !== 'relay' || device.connections.length === 0) return null
  const operated = device.connections.filter((entry) => entry.direction === 'output')
  const signalling = device.connections.filter((entry) => entry.direction === 'input')
  const body = (
    <>
      {operated.length > 0 && (
        <ConnectionRows
          title={t('endpoints.controlLink.operates', 'Operates')}
          count={String(operated.length)}
          connections={operated}
          issues={issues}
        />
      )}
      {signalling.length > 0 && (
        <ConnectionRows
          title={t('endpoints.controlLink.inputs', 'Inputs')}
          count={String(signalling.length)}
          connections={signalling}
          issues={issues}
        />
      )}
    </>
  )
  if (withinGroup) return body
  return (
    <DomoticaGroup
      title={t('endpoints.controlLink.controlSection', 'Control')}
      summary={String(device.connections.length)}
      warning={device.connections.some((entry) => issuesForConnection(issues, entry.endpoint.id).length > 0)}
    >{body}</DomoticaGroup>
  )
}

/** One direction of a module's connections; clicking a row selects the endpoint. */
function ConnectionRows({
  title,
  count,
  connections,
  issues,
}: {
  title: string
  count: string
  connections: ConnectedEndpointEntry[]
  issues: ControlDeviceIssue[]
}) {
  const { t } = useTranslation()
  const getCircuitIdentifier = useProjectStore((state: ProjectState) => state.getCircuitIdentifier)
  const setSelection = useUIStore((state) => state.setSelection)
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className={labelClass}>{title}</label>
        <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">{count}</span>
      </div>
      <ul className="space-y-1">
        {connections.map(({ endpoint, circuit, channel, groups, connectionId, buttonIndex, bus }) => {
          const hasIssue = issuesForConnection(issues, endpoint.id, buttonIndex).length > 0
          return (
            <li key={connectionId}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => setSelection({ type: 'endpoint', ids: [endpoint.id] })}
              >
                <span
                  className={`min-w-8 max-w-24 shrink-0 truncate tabular-nums ${hasIssue ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}
                >
                  {channel ?? '–'}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {endpoint.label.trim() || '?'}
                  {bus?.deviceAddress && <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">{bus.deviceAddress}</span>}
                  {buttonIndex != null && <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                    {t('endpoints.controlLink.buttonNumber', 'Button {{number}}', { number: buttonIndex + 1 })}
                  </span>}
                  {groups.length > 0 && (
                    <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                      {formatGroups(groups)}
                    </span>
                  )}
                </span>
                <span
                  className="shrink-0 text-xs text-gray-500 dark:text-gray-400"
                  title={getCircuitIdentifier(circuit.id)}
                >
                  {getCircuitIdentifier(circuit.id)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** A module's connections, outputs (with capacity) and inputs listed separately. */
function ControlLinkConnectedList({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation()
  const { index, issues } = useControlDeviceState()
  const device = index.devices.get(deviceId)
  if (!device || device.connections.length === 0) return null
  const capacity = getChannelCapacity(device)
  const outputs = device.connections.filter((entry) => !entry.bus && entry.direction === 'output')
  const inputs = device.connections.filter((entry) => !entry.bus && entry.direction === 'input')
  const busDevices = device.connections.filter((entry) => entry.bus)

  return (
    <>
      {outputs.length > 0 && (
        <ConnectionRows
          title={t('endpoints.controlLink.outputs', 'Outputs')}
          count={`${capacity.used}/${capacity.capacity}`}
          connections={outputs}
          issues={issues}
        />
      )}
      {inputs.length > 0 && (
        <ConnectionRows
          title={t('endpoints.controlLink.inputs', 'Inputs')}
          count={String(inputs.length)}
          connections={inputs}
          issues={issues}
        />
      )}
      {busDevices.length > 0 && <ConnectionRows
        title={t('endpoints.controlLink.busDevices', 'Bus devices')}
        count={String(new Set(busDevices.map((entry) => entry.endpoint.id)).size)}
        connections={busDevices} issues={issues}
      />}
    </>
  )
}
