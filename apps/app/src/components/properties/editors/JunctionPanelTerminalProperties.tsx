import { updateJunctionPanelTerminalProperties } from '@/handlers/properties/editProperties'
import { useTranslation } from 'react-i18next'
import { DebouncedNumberInput, DebouncedTextInput } from '@/components/forms'
import { getJunctionPanelTerminal } from '@/lib/junctionPanel/grid'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'

export function JunctionPanelTerminalProperties({ ownerDeviceId }: { ownerDeviceId: string }) {
  const { t } = useTranslation()
  // getTrunkDeviceById returns a fresh wrapper object. Selecting that wrapper directly makes
  // useSyncExternalStore see a new snapshot on every read and can trigger an update-depth loop.
  // The device record itself is stable until the project store actually changes.
  const device = useProjectStore(
    (state: ProjectState) => state.getTrunkDeviceById(ownerDeviceId)?.device
  )
  const update = updateJunctionPanelTerminalProperties
  if (!device) return null
  const terminal = getJunctionPanelTerminal(device)

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('common.label', 'Label')}
        </label>
        <DebouncedTextInput
          value={terminal.label}
          onCommit={(label) => update(ownerDeviceId, { label: label.trim() || terminal.label })}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('terminalStrip.pinCount', 'Pin count')}
        </label>
        <DebouncedNumberInput
          type="number"
          min="2"
          max="999"
          step="1"
          value={terminal.pinCount}
          minValue={2}
          maxValue={999}
          fallbackValue={terminal.pinCount}
          resetKey={terminal.id}
          onCommit={(pinCount) =>
            update(ownerDeviceId, {
              pinCount: Math.round(pinCount),
            })
          }
          className="w-24 rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
      </div>
    </div>
  )
}
