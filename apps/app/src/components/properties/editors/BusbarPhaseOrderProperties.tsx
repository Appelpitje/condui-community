import { useTranslation } from 'react-i18next'
import CustomDropdown from '@/components/common/CustomDropdown'
import { editProperties } from '@/handlers/properties/editProperties'
import { getBusbarPhaseOrder } from '@/lib/wires/phaseAssignment'
import type { AcLinePhase, Panel } from '@/types/schema'

export function BusbarPhaseOrderProperties({
  panel,
  ownerId,
  busSectionId,
  readOnly = false,
}: {
  panel: Panel
  ownerId?: string
  busSectionId?: string
  readOnly?: boolean
}) {
  const { t } = useTranslation()
  const order = getBusbarPhaseOrder(panel, ownerId, busSectionId)
  const options = (['L1', 'L2', 'L3'] as AcLinePhase[]).map((phase) => ({
    value: phase,
    label: phase,
  }))
  const updateOrder = (index: number, nextPhase: AcLinePhase) => {
    const next = [...order]
    next[index] = nextPhase
    editProperties({
      actions: [
        { kind: 'busbarPhaseOrder', panelId: panel.id, ownerId, busSectionId, order: next },
      ],
    })
  }

  if (order.length !== 3) return null
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {t('wires.busbarPhaseOrder', 'Busbar phase order')}
      </label>
      <div className="grid grid-cols-3 gap-2">
        {order.map((phase, index) => (
          <CustomDropdown
            disabled={readOnly}
            key={index}
            value={phase}
            onChange={(value) => updateOrder(index, value as AcLinePhase)}
            options={options}
            ariaLabel={`${t('wires.phase', 'Phase')} ${index + 1}`}
          />
        ))}
      </div>
    </div>
  )
}
