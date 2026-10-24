import { Fragment, useLayoutEffect, useRef, type ReactNode } from 'react'
import type Konva from 'konva'
import { Group, Line, Rect, Shape } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { buildDiagramOverview } from '@/lib/eendraad/diagramOverview'
import type { LayoutNode } from '@/lib/layout/layoutTree'
import type { BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import { useThemeColors } from '@/lib/theme/hooks'
import { PanelFrame } from './PanelFrame'

export type ForwardOverviewInteraction = (
  targetName: string,
  event: KonvaEventObject<Event>
) => void

/** Transparent proxies need native hit drawing and geometry, but no scene rasterization. */
function OverviewHitTargets({ children }: { children: ReactNode }) {
  const groupRef = useRef<Konva.Group>(null)
  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group) return
    const originalDrawScene = group.drawScene
    const skipScene: Konva.Group['drawScene'] = function (this: Konva.Group) {
      return this
    }
    group.drawScene = skipScene
    return () => {
      if (group.drawScene === skipScene) group.drawScene = originalDrawScene
    }
  }, [])
  return (
    <Group ref={groupRef} name="onewire-overview-hit-targets">
      {children}
    </Group>
  )
}

/** Tiny diagrams retain their topology and named hit proxies without thousands of text/image nodes. */
export function DiagramOverview({
  model,
  panelLayout,
  forward,
  renderAuxiliaryNode,
}: {
  model: NonNullable<ReturnType<typeof buildDiagramOverview>>
  panelLayout: BottomUpPanelLayout
  forward: ForwardOverviewInteraction
  renderAuxiliaryNode: (node: LayoutNode) => ReactNode
}) {
  const colors = useThemeColors()
  const events = (targetName: string) => ({
    onClick: (event: KonvaEventObject<MouseEvent>) => forward(targetName, event),
    onTap: (event: KonvaEventObject<TouchEvent>) => forward(targetName, event),
    onDblClick: (event: KonvaEventObject<MouseEvent>) => forward(targetName, event),
    onDblTap: (event: KonvaEventObject<TouchEvent>) => forward(targetName, event),
    onContextMenu: (event: KonvaEventObject<PointerEvent>) => forward(targetName, event),
  })
  return (
    <PanelFrame panelLayout={panelLayout}>
      <Group name="onewire-diagram-overview">
        <Shape
          name="onewire-overview-topology"
          listening={false}
          perfectDrawEnabled={false}
          sceneFunc={(context) => {
            context.beginPath()
            context.strokeStyle = colors.wireColor
            context.lineWidth = 2
            for (const wire of model.wires) {
              context.moveTo(wire.startPoint.x, wire.startPoint.y)
              context.lineTo(wire.endPoint.x, wire.endPoint.y)
            }
            context.stroke()
            context.beginPath()
            context.strokeStyle = colors.symbolColor
            context.lineWidth = 1
            for (const symbol of model.symbols) {
              context.rect(symbol.x + 5, symbol.y + 5, symbol.width - 10, symbol.height - 10)
            }
            context.stroke()
          }}
        />
        <OverviewHitTargets>
          {model.wires.map((wire) => {
            const bus = wire.type === 'mainBus' || wire.type === 'secondaryBus'
            if (bus && !wire.busSectionId && !wire.wireBusGroup) return null
            return (
              <Line
                key={wire.id}
                name={`wire-${wire.id}`}
                points={[wire.startPoint.x, wire.startPoint.y, wire.endPoint.x, wire.endPoint.y]}
                stroke="transparent"
                strokeWidth={10}
                {...events(`wireHit-${wire.id}`)}
              />
            )
          })}
          {model.symbols.map((symbol) => (
            <Rect
              key={symbol.targetName}
              name={symbol.targetName}
              x={symbol.x}
              y={symbol.y}
              width={symbol.width}
              height={symbol.height}
              fill="transparent"
              {...events(symbol.targetName)}
            />
          ))}
        </OverviewHitTargets>
        {model.auxiliaryNodes.map((node) => (
          <Fragment key={node.id}>{renderAuxiliaryNode(node)}</Fragment>
        ))}
      </Group>
    </PanelFrame>
  )
}
