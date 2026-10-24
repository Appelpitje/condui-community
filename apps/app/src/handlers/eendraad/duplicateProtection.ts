import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { createUiDropBehaviorHooks } from './uiDropBehaviorHooks'

export function duplicateProtection(options: {
  protectionId: string
  copyCircuitContents?: boolean
  mainBusPlacement?: { panelId: string; mainBusInsertIndex: number }
  gridPlacement?: { panelId: string; row: number; col: number }
  dropTarget?: DropTarget
  label?: string
  ownerDocument?: Document
}): string | null {
  const { activeFloorId, viewportCenter } = createUiDropBehaviorHooks(
    options.ownerDocument
  ).getSitplanTarget()
  const sitplanTarget = { activeFloorId, viewportCenter }
  const outcome = runProjectCommand(
    'electrical.duplicateProtection',
    {
      protectionId: options.protectionId,
      copyCircuitContents: options.copyCircuitContents,
      mainBusPlacement: options.mainBusPlacement,
      gridPlacement: options.gridPlacement,
      dropTarget: options.dropTarget,
      sitplanTarget,
    },
    { label: options.label ?? 'duplicate circuit' }
  )
  return outcome?.results[0]?.select?.find((ref) => ref.kind === 'protection')?.id ?? null
}
