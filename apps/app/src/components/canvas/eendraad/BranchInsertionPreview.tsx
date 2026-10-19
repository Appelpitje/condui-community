import { Group, Line } from 'react-konva'
import type { BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'
import type { BranchDropIntent } from '@/lib/layout/branchDropInteraction'
import { getBranchInsertionPreview } from '@/lib/layout/branchInsertionPreview'
import { BoundedCanvasPreview } from '../shared/BoundedCanvasPreview'
import { InsertionPreviewChunk } from './InsertionPreviewChunk'
import { DRAG_PREVIEW_DASH, DRAG_PREVIEW_WIRE_WIDTH } from './canvasSymbols'

export function BranchInsertionPreview({ layout, intent }: {
  layout: BottomUpLayoutResult; intent: BranchDropIntent
}) {
  const geometry = getBranchInsertionPreview(layout, intent)
  if (!geometry) return null
  const { center, size, wire } = geometry
  return <BoundedCanvasPreview>
    <Group name="eendraad-branch-insertion-preview" listening={false}>
      {wire.length > 0 && <Line name="eendraad-preview-added-wire" points={wire}
        stroke="#0284c7" strokeWidth={DRAG_PREVIEW_WIRE_WIDTH} dash={DRAG_PREVIEW_DASH}
        lineCap="round" lineJoin="round" listening={false} />}
      <InsertionPreviewChunk x={center.x - size / 2} y={center.y - size / 2} width={size} height={size} />
    </Group>
  </BoundedCanvasPreview>
}
