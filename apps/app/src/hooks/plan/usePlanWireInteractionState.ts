import { useState } from 'react'
import { usePointerPreview } from '@/hooks/usePointerPreview'

export function usePlanWireInteractionState() {
  const [dragSourcePlacementId, setDragSourcePlacementId] = useState<string | null>(null)
  const [hoverPlacementId, setHoverPlacementId] = useState<string | null>(null)
  const { pointStore, setPoint } = usePointerPreview()

  return {
    planWireDragSourcePlacementId: dragSourcePlacementId,
    setPlanWireDragSourcePlacementId: setDragSourcePlacementId,
    planWireHoverPlacementId: hoverPlacementId,
    setPlanWireHoverPlacementId: setHoverPlacementId,
    planWirePreviewPointStore: pointStore,
    setPlanWirePreviewPoint: setPoint,
  }
}
