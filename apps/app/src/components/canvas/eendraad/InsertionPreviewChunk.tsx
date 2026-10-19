import { Rect } from 'react-konva'
import { DRAG_PREVIEW_DASH } from './canvasSymbols'

/** Shared appearance; callers own placement and dimensions. */
export function InsertionPreviewChunk({ x, y, width, height, name = 'eendraad-preview-created-symbol' }: {
  x: number; y: number; width: number; height: number; name?: string
}) {
  return <Rect name={name} x={x} y={y} width={width} height={height}
    stroke="#0284c7" strokeWidth={2} dash={DRAG_PREVIEW_DASH} cornerRadius={4}
    fill="rgba(59,130,246,0.10)" listening={false} />
}
