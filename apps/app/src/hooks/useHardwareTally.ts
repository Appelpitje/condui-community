import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/stores/projectStore'
import { buildHardwareTally } from '@/lib/tally/buildHardwareTally'
import { useCableRouteEstimation } from '@/components/cableRouting/useCableRouteEstimation'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'

/** Shared quantities for the tally and its export, including the same optional plan estimates. */
export function useHardwareTally(includePlanEstimates = true, skipSupplyPanel = false) {
  const { t } = useTranslation()
  const project = useProjectStore((s) => s.currentProject)
  const cableRoutes = useCableRouteEstimation(includePlanEstimates && isCableRoutesEnabled())
  const estimatedLengthByAnchor = useMemo(
    () =>
      cableRoutes &&
      new Map(
        cableRoutes.routes
          .filter((route) => route.highM > 0)
          .map((route) => [route.anchor, route.highM] as const)
      ),
    [cableRoutes]
  )
  return useMemo(
    () =>
      buildHardwareTally(
        project,
        (key, options) => {
          if (typeof options === 'string') return t(key, options)
          return options ? t(key, options) : t(key)
        },
        { estimatedLengthByAnchor, skipSupplyPanel }
      ),
    [project, t, estimatedLengthByAnchor, skipSupplyPanel]
  )
}
