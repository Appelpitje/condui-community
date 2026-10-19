import { useMemo } from 'react'
import { useProjectStore } from '@/stores/projectStore'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'

/** Board/junction symbol lookups do not depend on floor-plan drawing geometry. */
export function usePlanSymbolElectricalProject(
  enabled: boolean
): ProjectWithOptionalV2Electrical | null {
  const electrical = useProjectStore((state) =>
    enabled ? state.currentProject?.disciplines.electrical : null
  )
  return useMemo(() => (electrical ? { disciplines: { electrical } } : null), [electrical])
}
