import { conductorMarkGlyphs, conductorMarkShapes, type ConductorMarks } from '@/lib/wires/conductorMarks'

/** Wider than the diagrams so each mark reads at button size. */
const PREVIEW_SPACING = 6.5
/** Half the drawn height; the wire sits on the vertical centre so it lines up with the label. */
const HALF_HEIGHT = 7.5
const PIXELS_PER_UNIT = 1.9

/** The wire's own conductor marks on a short horizontal wire, as the diagrams draw them. */
export function ConductorMarksPreview({ marks }: { marks: ConductorMarks }) {
  const shapes = conductorMarkShapes(conductorMarkGlyphs(marks), PREVIEW_SPACING)
  const halfWire = shapes.length / 2 + 6
  return (
    <svg
      viewBox={`${-halfWire} ${-HALF_HEIGHT} ${halfWire * 2} ${HALF_HEIGHT * 2}`}
      className="shrink-0 overflow-visible"
      style={{ width: `${halfWire * 2 * PIXELS_PER_UNIT}px`, height: `${HALF_HEIGHT * 2 * PIXELS_PER_UNIT}px` }}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1={-halfWire} y1={0} x2={halfWire} y2={0} strokeWidth={1.4} />
      {shapes.lines.map(([x1, y1, x2, y2], index) => (
        <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={1.5} />
      ))}
      {shapes.dots.map((dot, index) => (
        <circle key={index} cx={dot.x} cy={dot.y} r={dot.radius * 1.2} fill="currentColor" stroke="none" />
      ))}
      {shapes.texts.map((text, index) => (
        <text
          key={index}
          x={text.x}
          y={text.y}
          textAnchor="middle"
          fontSize={text.fontSize}
          fill="currentColor"
          stroke="none"
        >
          {text.text}
        </text>
      ))}
    </svg>
  )
}
