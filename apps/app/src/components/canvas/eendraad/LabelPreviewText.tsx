import { useContext, type ComponentProps } from 'react'
import { Group, Rect, Text } from 'react-konva'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import { LabelPreviewContext, type LabelPreviewSection } from './labelPreviewContext'

/** Preview-only emphasis; normal drawings retain their original label geometry. */
export function LabelPreviewText({
  section,
  maximumWidth,
  ...props
}: ComponentProps<typeof Text> & { section?: LabelPreviewSection; maximumWidth?: number }) {
  const preview = useContext(LabelPreviewContext)
  if (!preview || !section) return <Text {...props} />
  const fontSize = (props.fontSize ?? 11) * 1.5
  const textWidth = measureSymbolLabelTextWidth(
    props.text ?? '',
    props.fontFamily ?? 'Arial',
    fontSize,
    props.fontStyle === 'bold' ? 'bold' : 'normal'
  )
  const width = maximumWidth ?? Math.max(textWidth, (props.width ?? 0) * 1.5)
  const lineCount = maximumWidth
    ? Math.max(1, Math.ceil(textWidth / maximumWidth))
    : (props.text?.split('\n').length ?? 1)
  const height = fontSize * (props.lineHeight ?? 1) * lineCount
  const outlineWidth = Math.min(textWidth, width)
  // Keep the edge next to the symbol fixed; extra width grows into the label's free space.
  const oldWidth = props.width ?? textWidth / 1.5
  const x =
    (props.x ?? 0) -
    (props.align === 'right'
      ? width - oldWidth
      : props.align === 'center'
        ? (width - oldWidth) / 2
        : 0)
  const y = (props.y ?? 0) - (fontSize - (props.fontSize ?? 11)) / 2
  const highlighted = preview.highlighted === section
  const textX =
    props.align === 'right'
      ? width - textWidth
      : props.align === 'center'
        ? (width - textWidth) / 2
        : 0
  return (
    <Group x={x} y={y} listening={false} name={`label-preview-${section}`}>
      {highlighted ? (
        <Rect
          x={textX - 4}
          y={-3}
          width={outlineWidth + 8}
          height={height + 6}
          stroke="#facc15"
          strokeWidth={2}
          cornerRadius={3}
        />
      ) : null}
      <Text
        {...props}
        x={0}
        y={0}
        width={width}
        fontSize={fontSize}
        wrap={maximumWidth ? 'char' : 'none'}
      />
    </Group>
  )
}
