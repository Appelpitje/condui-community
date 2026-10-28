import type { RefObject } from 'react'
import { Group, Line, Rect, Circle, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Point2, Wall } from '@/types/schema'
import type { PlanView } from '@/stores/uiStore'
import type { Theme } from '@/types/ui'
import type { ToolMode } from '../../plan/PlanImageTools'
import { snapToGrid } from '@/utils/plan/gridSnap'
import { handleDrawWallRect } from '@/handlers/plan/wallDrawing'
import { createQuarterCircleWallCurve, getCurveRenderMaxSegmentLength, getWallPathPoints } from '@/lib/plan/wallCurve'
import type { buildStairGeometry } from './StairRenderer'
import type { getStairRenderMetrics } from '@/lib/plan/stairPlanScale'
import { getPlanGraphicElementAsset } from '@/lib/plan/graphicElements'
import { PlanGraphicElementShape } from './PlanGraphicElementRenderer'

export type FloorPlanInputEvent = KonvaEventObject<MouseEvent | TouchEvent | PointerEvent | DragEvent>
type DraftPointDrag = (tool: 'drawWall' | 'drawStair', index: number, event: FloorPlanInputEvent) => void

interface FloorPlanDrawingPreviewProps {
  activeTool: ToolMode
  wallDrawingState: { currentPoints: Point2[]; isDrawing: boolean; rectStartPoint: Point2 | null; pendingCurve?: boolean }
  currentMousePosition: Point2 | null
  planView: PlanView
  drawStrokeCanvas: number
  drawDashCanvas: number
  stairDrawingPoints: Point2[]
  stairPreviewGeometry: ReturnType<typeof buildStairGeometry> | null
  stairPreviewColor: string
  stairPreviewMetrics: ReturnType<typeof getStairRenderMetrics>
  stairSpiralPreviewActive: boolean
  drawPointRadiusCanvas: number
  beginDraftPointDrag: DraftPointDrag
  moveDraftPointDrag: DraftPointDrag
  endDraftPointDrag: DraftPointDrag
  suppressDraftPointTapUntilRef: RefObject<number>
  commitCurrentStairDrawing: () => void
  activeGeometrySnap: { point: Point2; kind: 'endpoint' | 'line' } | null
  showFirstClickSnapPreview: boolean
  firstClickSnapPreviewRadiusCanvas: number
  activeFloorId: string | null
  commitWallWithUndo: (floorId: string, points: Point2[], curve?: Wall['curve']) => void
  resetDrawingState: () => void
  setActiveTool: (tool: ToolMode) => void
  openingDragPreview: { start: Point2; end: Point2 } | null
  openingDragDimension: { cursor: Point2; widthCm: number } | null
  theme: Theme
  drawHandleRadiusCanvas: number
  fontFamily: string
  rectLockedXMeters: number | null
  rectLockedYMeters: number | null
  canvasPxPerMeter: number
  gridSize: number
  graphicPointerState: { start: Point2; current: Point2; didDrag: boolean } | null
  selectedGraphicAssetId: string
}

/** Draft artwork and point handles; the owning drawing mode retains all gesture state. */
export function FloorPlanDrawingPreview({
  activeTool,
  wallDrawingState,
  currentMousePosition,
  planView,
  drawStrokeCanvas,
  drawDashCanvas,
  stairDrawingPoints,
  stairPreviewGeometry,
  stairPreviewColor,
  stairPreviewMetrics,
  stairSpiralPreviewActive,
  drawPointRadiusCanvas,
  beginDraftPointDrag,
  moveDraftPointDrag,
  endDraftPointDrag,
  suppressDraftPointTapUntilRef,
  commitCurrentStairDrawing,
  activeGeometrySnap,
  showFirstClickSnapPreview,
  firstClickSnapPreviewRadiusCanvas,
  activeFloorId,
  commitWallWithUndo,
  resetDrawingState,
  setActiveTool,
  openingDragPreview,
  openingDragDimension,
  theme,
  drawHandleRadiusCanvas,
  fontFamily,
  rectLockedXMeters,
  rectLockedYMeters,
  canvasPxPerMeter,
  gridSize,
  graphicPointerState,
  selectedGraphicAssetId,
}: FloorPlanDrawingPreviewProps) {
  return (
    <>
    {/* Preview line while drawing */}
    {activeTool === 'drawWall' &&
      wallDrawingState.isDrawing &&
      wallDrawingState.currentPoints.length > 0 && (
        <>
          <Line
            points={(() => {
              if (
                wallDrawingState.pendingCurve &&
                wallDrawingState.currentPoints.length === 2 &&
                currentMousePosition
              ) {
                return getWallPathPoints(
                  {
                    points: [...wallDrawingState.currentPoints, currentMousePosition],
                    curve: createQuarterCircleWallCurve(),
                  },
                  getCurveRenderMaxSegmentLength(planView.zoom)
                ).flatMap((point) => [point.x, point.y])
              }
              return [
                ...wallDrawingState.currentPoints.flatMap((point) => [point.x, point.y]),
                ...(currentMousePosition
                  ? [currentMousePosition.x, currentMousePosition.y]
                  : []),
              ]
            })()}
            stroke="#0284c7"
            strokeWidth={drawStrokeCanvas}
            dash={[drawDashCanvas, drawDashCanvas]}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
          {wallDrawingState.pendingCurve &&
            wallDrawingState.currentPoints.length === 2 &&
            currentMousePosition && (
              <Line
                points={[
                  wallDrawingState.currentPoints[0]!.x,
                  wallDrawingState.currentPoints[0]!.y,
                  wallDrawingState.currentPoints[1]!.x,
                  wallDrawingState.currentPoints[1]!.y,
                  currentMousePosition.x,
                  currentMousePosition.y,
                ]}
                stroke="#0284c7"
                strokeWidth={drawStrokeCanvas * 0.75}
                dash={[drawDashCanvas * 0.5, drawDashCanvas * 0.5]}
                opacity={0.55}
                listening={false}
              />
            )}
        </>
      )}

    {/* Stair preview path while drawing */}
    {activeTool === 'drawStair' && stairDrawingPoints.length > 0 && (
      <>
        {stairPreviewGeometry && stairPreviewGeometry.outlinePoints.length >= 6 && (
          <>
            <Line
              points={stairPreviewGeometry.outlinePoints}
              closed
              stroke={stairPreviewColor}
              strokeWidth={stairPreviewMetrics.outlineStroke}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
            {stairPreviewGeometry.spiralPoleRadius && stairPreviewGeometry.spiralCenter && (
              <Circle
                x={stairPreviewGeometry.spiralCenter.x}
                y={stairPreviewGeometry.spiralCenter.y}
                radius={stairPreviewGeometry.spiralPoleRadius}
                stroke={stairPreviewColor}
                strokeWidth={stairPreviewMetrics.outlineStroke}
                fill="rgba(0,0,0,0.001)"
                listening={false}
              />
            )}
            {stairPreviewGeometry.stepLines.map(([start, end], index) => (
              <Line
                key={`stair-preview-step-${index}`}
                points={[start.x, start.y, end.x, end.y]}
                stroke={stairPreviewGeometry.stepLineColors?.[index] ?? stairPreviewColor}
                strokeWidth={stairPreviewMetrics.stepStroke}
                lineCap="round"
                listening={false}
              />
            ))}
          </>
        )}
        {stairDrawingPoints.length > 1 && (
          <Line
            points={stairDrawingPoints.flatMap((p) => [p.x, p.y])}
            stroke="#0284c7"
            strokeWidth={stairPreviewMetrics.arrowStroke}
            dash={[drawDashCanvas, drawDashCanvas]}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
        )}
        {stairDrawingPoints.map((point, index) => (
          <Circle
            key={`stair-preview-point-${index}`}
            name="floor-plan-draft-point"
            x={point.x}
            y={point.y}
            radius={drawPointRadiusCanvas * 0.9}
            fill={index === 0 && stairSpiralPreviewActive ? '#0284c7' : '#334155'}
            stroke="#ffffff"
            strokeWidth={drawStrokeCanvas}
            listening={true}
            draggable
            onDragStart={(e) => beginDraftPointDrag('drawStair', index, e)}
            onDragMove={(e) => moveDraftPointDrag('drawStair', index, e)}
            onDragEnd={(e) => endDraftPointDrag('drawStair', index, e)}
            onTap={(e) => {
              if (Date.now() < suppressDraftPointTapUntilRef.current) {
                e.cancelBubble = true
                return
              }
              // Spiral stair: tap the sole center point to finish.
              if (index === 0 && stairDrawingPoints.length === 1) {
                e.cancelBubble = true
                commitCurrentStairDrawing()
              }
            }}
            onClick={(e) => {
              if (Date.now() < suppressDraftPointTapUntilRef.current) {
                e.cancelBubble = true
                return
              }
              if (index === 0 && stairDrawingPoints.length === 1) {
                e.cancelBubble = true
                commitCurrentStairDrawing()
              }
            }}
          />
        ))}
      </>
    )}

    {/* Always show the exact snapped position of the next stair point. */}
    {activeTool === 'drawStair' && currentMousePosition && (
      <Circle
        x={currentMousePosition.x}
        y={currentMousePosition.y}
        radius={drawPointRadiusCanvas * 0.9}
        fill="#334155"
        stroke="#ffffff"
        strokeWidth={drawStrokeCanvas}
        listening={false}
      />
    )}

    {activeTool === 'drawWall' && activeGeometrySnap && (
      <Circle
        x={activeGeometrySnap.point.x}
        y={activeGeometrySnap.point.y}
        radius={drawPointRadiusCanvas * (activeGeometrySnap.kind === 'endpoint' ? 1.2 : 0.9)}
        fill={activeGeometrySnap.kind === 'endpoint' ? '#22c55e' : '#ffffff'}
        stroke="#22c55e"
        strokeWidth={drawStrokeCanvas * 1.5}
        listening={false}
      />
    )}

    {/* Where the first drawing point will snap (grid + projected snap guides) */}
    {showFirstClickSnapPreview && currentMousePosition && (
      <Circle
        x={currentMousePosition.x}
        y={currentMousePosition.y}
        radius={firstClickSnapPreviewRadiusCanvas}
        fill="#0284c7"
        stroke="#ffffff"
        strokeWidth={drawStrokeCanvas}
        listening={false}
      />
    )}

    {/* Preview points while drawing */}
    {activeTool === 'drawWall' &&
      wallDrawingState.isDrawing &&
      wallDrawingState.currentPoints.map((point, index) => (
        <Circle
          key={`preview-point-${index}`}
          name="floor-plan-draft-point"
          x={point.x}
          y={point.y}
          radius={drawPointRadiusCanvas}
          fill="#0284c7"
          stroke="#ffffff"
          strokeWidth={drawStrokeCanvas}
          listening={true}
          draggable
          onDragStart={(e) => beginDraftPointDrag('drawWall', index, e)}
          onDragMove={(e) => moveDraftPointDrag('drawWall', index, e)}
          onDragEnd={(e) => endDraftPointDrag('drawWall', index, e)}
          onClick={(e) => {
            if (Date.now() < suppressDraftPointTapUntilRef.current) {
              e.cancelBubble = true
              return
            }
            if (activeTool !== 'drawWall') return
            if (!activeFloorId) return
            // Only special-case the very first point: clicking it closes and commits.
            if (index === 0 && wallDrawingState.currentPoints.length >= 3) {
              e.cancelBubble = true
              const first = wallDrawingState.currentPoints[0]!
              const closedPoints = [...wallDrawingState.currentPoints, first]
              commitWallWithUndo(activeFloorId, closedPoints)
              resetDrawingState()
              setActiveTool('drawWall')
              return
            }
          }}
          onTap={(e) => {
            if (Date.now() < suppressDraftPointTapUntilRef.current) {
              e.cancelBubble = true
              return
            }
            if (activeTool !== 'drawWall') return
            if (!activeFloorId) return
            if (index === 0 && wallDrawingState.currentPoints.length >= 3) {
              e.cancelBubble = true
              const first = wallDrawingState.currentPoints[0]!
              const closedPoints = [...wallDrawingState.currentPoints, first]
              commitWallWithUndo(activeFloorId, closedPoints)
              resetDrawingState()
              setActiveTool('drawWall')
              return
            }
          }}
        />
      ))}

    {/* Drag-preview for door/window insertion: appears from pointer-down, commits on release */}
    {openingDragPreview && (
      <Line
        points={[
          openingDragPreview.start.x,
          openingDragPreview.start.y,
          openingDragPreview.end.x,
          openingDragPreview.end.y,
        ]}
        stroke="#0284c7"
        strokeWidth={drawStrokeCanvas}
        dash={[drawDashCanvas, drawDashCanvas]}
        lineCap="round"
        listening={false}
      />
    )}

    {openingDragDimension &&
      (() => {
        const label = `${openingDragDimension.widthCm} cm`
        const fontSize = 13 / planView.zoom
        const paddingX = 8 / planView.zoom
        const paddingY = 4 / planView.zoom
        const approxCharWidth = fontSize * 0.6
        const textWidth = Math.max(24 / planView.zoom, label.length * approxCharWidth)
        const boxWidth = textWidth + paddingX * 2
        const boxHeight = fontSize + paddingY * 2
        const cursorGap = 8 / planView.zoom
        const boxX = openingDragDimension.cursor.x + cursorGap
        const boxY = openingDragDimension.cursor.y - cursorGap - boxHeight

        return (
          <>
            <Rect
              x={boxX}
              y={boxY}
              width={boxWidth}
              height={boxHeight}
              fill={theme.mode === 'dark' ? 'rgba(17,24,39,0.9)' : 'rgba(243,244,246,0.95)'}
              stroke={theme.mode === 'dark' ? '#e5e7eb' : '#111827'}
              strokeWidth={drawStrokeCanvas}
              cornerRadius={drawHandleRadiusCanvas * 0.5}
              listening={false}
            />
            <Text
              x={boxX}
              y={boxY}
              width={boxWidth}
              height={boxHeight}
              align="center"
              verticalAlign="middle"
              text={label}
              fontSize={fontSize}
              fontFamily={fontFamily}
              fill={theme.mode === 'dark' ? '#f9fafb' : '#111827'}
              listening={false}
            />
          </>
        )
      })()}

    {/* Rectangle preview while drawing */}
    {activeTool === 'drawWallRect' &&
      wallDrawingState.rectStartPoint &&
      currentMousePosition &&
      (() => {
        const start = wallDrawingState.rectStartPoint
        let end = snapToGrid(currentMousePosition, gridSize, planView.snapToGrid)
        if (rectLockedXMeters != null) {
          const dx = end.x - start.x
          const signX = dx >= 0 ? 1 : -1
          const targetPxX = rectLockedXMeters * canvasPxPerMeter
          end = {
            ...end,
            x: start.x + signX * targetPxX,
          }
        }
        if (rectLockedYMeters != null) {
          const dy = end.y - start.y
          const signY = dy >= 0 ? 1 : -1
          const targetPxY = rectLockedYMeters * canvasPxPerMeter
          end = {
            ...end,
            y: start.y + signY * targetPxY,
          }
        }
        const points = handleDrawWallRect(start, end, gridSize, planView.snapToGrid)
        if (points.length < 2) return null
        return (
          <Line
            points={points.flatMap((p) => [p.x, p.y])}
            stroke="#0284c7"
            strokeWidth={drawStrokeCanvas}
            dash={[drawDashCanvas, drawDashCanvas]}
            lineCap="round"
            lineJoin="round"
            closed={true}
            listening={false}
          />
        )
      })()}

    {activeTool === 'drawGraphicElement' &&
      graphicPointerState &&
      graphicPointerState.didDrag &&
      (() => {
        const asset = getPlanGraphicElementAsset(selectedGraphicAssetId)
        if (!asset) return null
        const left = Math.min(graphicPointerState.start.x, graphicPointerState.current.x)
        const top = Math.min(graphicPointerState.start.y, graphicPointerState.current.y)
        const width = Math.abs(graphicPointerState.current.x - graphicPointerState.start.x)
        const height = Math.abs(graphicPointerState.current.y - graphicPointerState.start.y)
        if (width <= 1 || height <= 1) return null
        const previewWidth = asset.sizeLocked
          ? asset.defaultWidthMeters * canvasPxPerMeter
          : width
        const previewHeight = asset.sizeLocked
          ? asset.defaultHeightMeters * canvasPxPerMeter
          : height
        return (
          <Group x={left + width / 2} y={top + height / 2} opacity={0.9} listening={false}>
            <PlanGraphicElementShape
              element={{
                kind: asset.kind,
                width: previewWidth,
                height: previewHeight,
              }}
              themeMode={theme.mode}
              strokeColor="#0284c7"
            />
          </Group>
        )
      })()}

    </>
  )
}
