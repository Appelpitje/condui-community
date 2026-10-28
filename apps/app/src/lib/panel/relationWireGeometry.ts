/** Deterministic panel relation guide paths, independent of canvas rendering and interaction. */
import { CELL_H, ROW_GAP, type ModulePlacement } from './panelGridLayout'

export type PanelHierarchyRoute = {
  side: 'left' | 'right'
  corridorY: number
  panelLeftX: number
  panelRightX: number
  panelTopY?: number
  panelBottomY?: number
  feedFromTop: boolean
  panelInset: number
}

const DODGE_MARGIN = 5
const SAME_ROW_SPREAD = 6
/** Margin when routing last-supply → supply panel along left/right side of main panel. */
const SIDE_ROUTE_MARGIN = 4
/** Extra side push used in single-panel mode so corridor lanes sit outside the frame gutter. */
const SINGLE_PANEL_SIDE_EXTRA = 10
/** Small offset before final entry so a short vertical segment remains visible. */
export const FINAL_ENTRY_OFFSET = 6
/** Keep supply-chain input/output ports visually separate on compact modules. */
export const SUPPLY_PORT_SPREAD = 8
/** Bottom-fed WUMP corridor offset so it doesn't overlap WSUD. */
const WUMP_SIDE_OFFSET = 5
/** Offset WINT side-corridor from feed corridors to reduce overlap. */
const INTERNAL_FEED_AVOID_OFFSET = 6
/** Split opposite vertical WINT flows in same side corridor. */
const INTERNAL_BIDIR_CORRIDOR_SPLIT = 4

function routeViaGap(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  gapY: number
): number[] {
  if (fromX === toX) return [fromX, fromY, toX, toY]
  return [fromX, fromY, fromX, gapY, toX, gapY, toX, toY]
}

function routeWithDodge(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  yOff: number
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2

  const exitY = parentPl.y
  const topGapY = parentPl.y - ROW_GAP / 2 + yOff
  const childGapY = childPl.y - ROW_GAP / 2 + yOff
  const entryY = childPl.y

  const needsDodge = childCx >= parentPl.x && childCx <= parentPl.x + parentPl.width

  if (!needsDodge) {
    return [parentCx, exitY, parentCx, topGapY, childCx, topGapY, childCx, entryY]
  }

  const dodgeRight = childCx > parentCx
  const dodgeX = dodgeRight ? parentPl.x + parentPl.width + DODGE_MARGIN : parentPl.x - DODGE_MARGIN

  return [
    parentCx,
    exitY,
    parentCx,
    topGapY,
    dodgeX,
    topGapY,
    dodgeX,
    childGapY,
    childCx,
    childGapY,
    childCx,
    entryY,
  ]
}

/** Wire points from parent to child (for relation wires and drop preview). Exported for auto-parent preview. */
export function getDownstreamWirePoints(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  yOff = 0
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2

  if (childPl.row < parentPl.row) {
    const gapY = parentPl.y - ROW_GAP / 2 + yOff
    return routeViaGap(parentCx, parentPl.y, childCx, childPl.y + childPl.height, gapY)
  }

  if (childPl.row === parentPl.row) {
    const dir = childCx >= parentCx ? 1 : -1
    const gapY = parentPl.y + parentPl.height + ROW_GAP / 2 + yOff
    return routeViaGap(
      parentCx + dir * SAME_ROW_SPREAD,
      parentPl.y + parentPl.height,
      childCx - dir * SAME_ROW_SPREAD,
      childPl.y + childPl.height,
      gapY
    )
  }

  if (childPl.row === parentPl.row + 1) {
    const gapY = parentPl.y + parentPl.height + ROW_GAP / 2 + yOff
    return routeViaGap(parentCx, parentPl.y + parentPl.height, childCx, childPl.y, gapY)
  }

  return routeWithDodge(parentPl, childPl, yOff)
}

/**
 * Internal wiring when source is incoming MCIR feeder:
 * - same row: bottom lane from source to target
 * - different row: snake via nearest side corridor (left half -> left, right half -> right)
 */
export function routeInternalFromPanelBusFeeder(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  mainPanelLeftX: number,
  mainPanelRightX: number,
  feedFromTop: boolean
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2
  const sameRowUseBottomLane = feedFromTop
  const parentExitY = sameRowUseBottomLane ? parentPl.y + parentPl.height : parentPl.y
  const childEntryY = sameRowUseBottomLane ? childPl.y + childPl.height : childPl.y

  if (childPl.row === parentPl.row) {
    const laneY = sameRowUseBottomLane
      ? Math.max(parentExitY, childEntryY) + FINAL_ENTRY_OFFSET
      : Math.min(parentExitY, childEntryY) - FINAL_ENTRY_OFFSET
    return [parentCx, parentExitY, parentCx, laneY, childCx, laneY, childCx, childEntryY]
  }

  const exitsFromBottom = feedFromTop
  const directionalParentExitY = exitsFromBottom ? parentPl.y + parentPl.height : parentPl.y
  const directionalChildEntryY = exitsFromBottom ? childPl.y + childPl.height : childPl.y
  const panelMidX = (mainPanelLeftX + mainPanelRightX) / 2
  const side: 'left' | 'right' = parentCx <= panelMidX ? 'left' : 'right'
  const baseSideX =
    side === 'left'
      ? mainPanelLeftX - (SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA)
      : mainPanelRightX + SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA
  const childBelowParent = childPl.row > parentPl.row
  const directionalSplit = childBelowParent
    ? INTERNAL_BIDIR_CORRIDOR_SPLIT
    : -INTERNAL_BIDIR_CORRIDOR_SPLIT
  const sideX =
    side === 'left'
      ? baseSideX + INTERNAL_FEED_AVOID_OFFSET + directionalSplit
      : baseSideX - INTERNAL_FEED_AVOID_OFFSET + directionalSplit
  let exitLaneY = feedFromTop
    ? directionalParentExitY + FINAL_ENTRY_OFFSET
    : directionalParentExitY - FINAL_ENTRY_OFFSET
  if (exitsFromBottom) {
    exitLaneY = Math.max(exitLaneY, parentPl.y + parentPl.height + ROW_GAP / 2)
  } else {
    exitLaneY = Math.min(exitLaneY, parentPl.y - ROW_GAP / 2)
  }
  const childGapY = exitsFromBottom
    ? childPl.y + childPl.height + ROW_GAP / 2
    : childPl.y - ROW_GAP / 2

  return [
    parentCx,
    directionalParentExitY,
    parentCx,
    exitLaneY,
    sideX,
    exitLaneY,
    sideX,
    childGapY,
    childCx,
    childGapY,
    childCx,
    directionalChildEntryY,
  ]
}

export function routeInternalByFeedDirection(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  mainPanelLeftX: number,
  mainPanelRightX: number,
  feedFromTop: boolean,
  yOff = 0
): number[] {
  // Same-row is the only intentional deviation from global feed direction so wires
  // don't fold over themselves.
  if (childPl.row === parentPl.row) {
    const parentCx = parentPl.x + parentPl.width / 2
    const childCx = childPl.x + childPl.width / 2
    const sameRowUseBottomLane = feedFromTop
    const parentExitY = sameRowUseBottomLane ? parentPl.y + parentPl.height : parentPl.y
    const childEntryY = sameRowUseBottomLane ? childPl.y + childPl.height : childPl.y
    const laneY = sameRowUseBottomLane
      ? Math.max(parentExitY, childEntryY) + FINAL_ENTRY_OFFSET + yOff
      : Math.min(parentExitY, childEntryY) - FINAL_ENTRY_OFFSET + yOff
    return [parentCx, parentExitY, parentCx, laneY, childCx, laneY, childCx, childEntryY]
  }
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2
  const panelMidX = (mainPanelLeftX + mainPanelRightX) / 2
  const side: 'left' | 'right' = parentCx <= panelMidX ? 'left' : 'right'
  const baseSideX =
    side === 'left'
      ? mainPanelLeftX - (SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA)
      : mainPanelRightX + SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA
  const childBelowParent = childPl.row > parentPl.row
  const directionalSplit = childBelowParent
    ? INTERNAL_BIDIR_CORRIDOR_SPLIT
    : -INTERNAL_BIDIR_CORRIDOR_SPLIT
  const sideX =
    side === 'left'
      ? baseSideX + INTERNAL_FEED_AVOID_OFFSET + directionalSplit
      : baseSideX - INTERNAL_FEED_AVOID_OFFSET + directionalSplit

  const exitsFromBottom = feedFromTop
  const parentExitY = exitsFromBottom ? parentPl.y + parentPl.height : parentPl.y
  const childEntryY = exitsFromBottom ? childPl.y + childPl.height : childPl.y
  let exitLaneY = feedFromTop
    ? parentExitY - FINAL_ENTRY_OFFSET + yOff
    : parentExitY + FINAL_ENTRY_OFFSET + yOff
  if (exitsFromBottom) {
    exitLaneY = Math.max(exitLaneY, parentPl.y + parentPl.height + ROW_GAP / 2 + yOff)
  } else {
    exitLaneY = Math.min(exitLaneY, parentPl.y - ROW_GAP / 2 + yOff)
  }
  const childGapY = exitsFromBottom
    ? childPl.y + childPl.height + ROW_GAP / 2 + yOff
    : childPl.y - ROW_GAP / 2 + yOff

  return [
    parentCx,
    parentExitY,
    parentCx,
    exitLaneY,
    sideX,
    exitLaneY,
    sideX,
    childGapY,
    childCx,
    childGapY,
    childCx,
    childEntryY,
  ]
}

/**
 * Route from last device on supply wire (main panel) to a child in the supply panel:
 * horizontal to left or right side of main panel block, then vertical to child row, then horizontal to child.
 * Only used when parent is last supply trunk device and child is in supply panel.
 */
export function routeLastSupplyToSupplyPanel(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  mainPanelLeftX: number,
  mainPanelRightX: number
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2
  const parentCy = parentPl.y + parentPl.height / 2
  const childCy = childPl.y + childPl.height / 2
  // Adapt to feed orientation/relative vertical direction:
  // if child is below parent, leave from bottom and enter child top; else inverse.
  const childBelowParent = childCy >= parentCy
  const exitY = childBelowParent ? parentPl.y + parentPl.height : parentPl.y
  const entryY = childBelowParent ? childPl.y : childPl.y + childPl.height
  // Short vertical out of parent before turning horizontal (same offset as final entry).
  const exitApproachY = childBelowParent ? exitY + FINAL_ENTRY_OFFSET : exitY - FINAL_ENTRY_OFFSET
  // Horizontal in the gap; tiny last vertical into module.
  const approachY = childBelowParent ? entryY - FINAL_ENTRY_OFFSET : entryY + FINAL_ENTRY_OFFSET
  // Use the side that is closer to the parent module (avoids long detour when parent is narrow).
  const distToLeft = parentCx - (mainPanelLeftX - SIDE_ROUTE_MARGIN)
  const distToRight = mainPanelRightX + SIDE_ROUTE_MARGIN - parentCx
  const useLeft = distToLeft <= distToRight
  const sideX = useLeft ? mainPanelLeftX - SIDE_ROUTE_MARGIN : mainPanelRightX + SIDE_ROUTE_MARGIN
  return [
    parentCx,
    exitY,
    parentCx,
    exitApproachY,
    sideX,
    exitApproachY,
    sideX,
    approachY,
    childCx,
    approachY,
    childCx,
    entryY,
  ]
}

export function routeSupplyPanelTrunkToMainBus(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  mainPanelLeftX: number,
  mainPanelRightX: number,
  preferredSide?: 'left' | 'right' | null,
  corridorY?: number | null,
  feedFromTop = true
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const parentExitX =
    parentCx + (preferredSide === 'left' ? -SUPPLY_PORT_SPREAD : SUPPLY_PORT_SPREAD)
  const childCx = childPl.x + childPl.width / 2
  const exitY = feedFromTop ? parentPl.y + parentPl.height : parentPl.y
  const childGapY = feedFromTop ? childPl.y - ROW_GAP / 2 : childPl.y + childPl.height + ROW_GAP / 2
  const entryY = feedFromTop ? childPl.y : childPl.y + childPl.height
  const side =
    preferredSide ??
    (parentCx - (mainPanelLeftX - SIDE_ROUTE_MARGIN) <=
    mainPanelRightX + SIDE_ROUTE_MARGIN - parentCx
      ? 'left'
      : 'right')
  const sideX =
    side === 'left' ? mainPanelLeftX - SIDE_ROUTE_MARGIN : mainPanelRightX + SIDE_ROUTE_MARGIN
  const exitApproachY = feedFromTop ? exitY + FINAL_ENTRY_OFFSET : exitY - FINAL_ENTRY_OFFSET
  const trunkY = corridorY ?? exitApproachY
  return [
    parentExitX,
    exitY,
    parentExitX,
    exitApproachY,
    sideX,
    exitApproachY,
    sideX,
    trunkY,
    sideX,
    childGapY,
    childCx,
    childGapY,
    childCx,
    entryY,
  ]
}

/**
 * WUMP: Unique supply device -> main protections.
 * Keep this route inside the panel frame and avoid "exit then reverse" movement.
 */
export function routeUniqueSupplyToMainBusInside(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  mainPanelLeftX: number,
  mainPanelRightX: number,
  preferredSide?: 'left' | 'right' | null,
  hierarchyRoute?: PanelHierarchyRoute | null,
  feedFromTop = true
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2
  const side =
    preferredSide ?? (parentCx - mainPanelLeftX <= mainPanelRightX - parentCx ? 'left' : 'right')
  const sideX = hierarchyRoute
    ? side === 'left'
      ? hierarchyRoute.panelLeftX + hierarchyRoute.panelInset / 2
      : hierarchyRoute.panelRightX - hierarchyRoute.panelInset / 2
    : side === 'left'
      ? mainPanelLeftX - (SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA)
      : mainPanelRightX + SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA
  const wumpSideX = side === 'left' ? sideX + WUMP_SIDE_OFFSET : sideX - WUMP_SIDE_OFFSET

  // WUMP should keep paths simple:
  // - top-feed panels: always leave MUNQ from bottom
  // - bottom-feed panels: always leave MUNQ from top
  // - avoid side-corridor detours for local fanout; use corridor for deeper targets.
  const exitY = feedFromTop ? parentPl.y + parentPl.height : parentPl.y
  const exitApproachY = feedFromTop ? exitY + ROW_GAP / 2 : exitY - ROW_GAP / 2
  const childRowIsSameOrFurtherInFeedDirection = feedFromTop
    ? childPl.row >= parentPl.row
    : childPl.row <= parentPl.row
  const childGapY = feedFromTop ? childPl.y - ROW_GAP / 2 : childPl.y + childPl.height + ROW_GAP / 2
  const entryY = feedFromTop ? childPl.y : childPl.y + childPl.height

  // If the source approach is already the target row opening, branch into the
  // module immediately. Going out to a side passage and returning on this same
  // horizontal lane only creates a U-turn and cannot avoid any row content.
  if (Math.abs(exitApproachY - childGapY) < 0.5) {
    return [parentCx, exitY, parentCx, exitApproachY, childCx, childGapY, childCx, entryY]
  }

  // Bottom-fed special case:
  // when target is on a lower row than source, keep trunk in side corridor,
  // then branch at the target row gap and feed from the bottom.
  if (!feedFromTop && childPl.row > parentPl.row) {
    return [
      parentCx,
      exitY,
      parentCx,
      exitApproachY,
      wumpSideX,
      exitApproachY,
      wumpSideX,
      childGapY,
      childCx,
      childGapY,
      childCx,
      entryY,
    ]
  }

  if (childRowIsSameOrFurtherInFeedDirection) {
    if (feedFromTop) {
      // For deeper targets, route via side corridor to avoid crossing through intermediate rows/modules.
      if (childPl.row > parentPl.row + 1) {
        const trunkY = Math.max(exitApproachY, childGapY)
        return [
          parentCx,
          exitY,
          parentCx,
          exitApproachY,
          sideX,
          exitApproachY,
          sideX,
          trunkY,
          childCx,
          trunkY,
          childCx,
          entryY,
        ]
      }
      if (childPl.row === parentPl.row) {
        // Same-row fanout: stay in bottom lane and feed neighbour from below.
        const laneY = exitApproachY
        const entryY = childPl.y + childPl.height
        return [parentCx, exitY, parentCx, laneY, childCx, laneY, childCx, entryY]
      }
      // Downstream row fanout: drop from source, then run across child row gap.
      const laneY = Math.max(exitApproachY, childGapY)
      return [parentCx, exitY, parentCx, laneY, childCx, laneY, childCx, entryY]
    }

    if (childPl.row !== parentPl.row) {
      return [
        parentCx,
        exitY,
        parentCx,
        exitApproachY,
        wumpSideX,
        exitApproachY,
        wumpSideX,
        childGapY,
        childCx,
        childGapY,
        childCx,
        entryY,
      ]
    }
    if (childPl.row === parentPl.row) {
      // Bottom-feed mirror: same-row fanout from top lane.
      const laneY = exitApproachY
      const entryY = childPl.y
      return [parentCx, exitY, parentCx, laneY, childCx, laneY, childCx, entryY]
    }
  }

  // Only use side lane when target is opposite feed direction (rare, drag/edit states).
  const trunkY = feedFromTop
    ? Math.max(exitApproachY, childGapY)
    : Math.min(exitApproachY, childGapY)
  const corridorX = feedFromTop ? sideX : wumpSideX
  return [
    parentCx,
    exitY,
    parentCx,
    exitApproachY,
    corridorX,
    exitApproachY,
    corridorX,
    trunkY,
    childCx,
    trunkY,
    childCx,
    entryY,
  ]
}

/**
 * Shared strip → frame corridor → target row gap → module top (hierarchy / merged boards).
 * Used for WSPM and WSUD so both land on the DIN preview the same way.
 */
function routeSharedSupplyThroughHierarchyCorridor(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  hierarchyRoute: PanelHierarchyRoute
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2
  const sideX =
    hierarchyRoute.side === 'left'
      ? hierarchyRoute.panelLeftX + hierarchyRoute.panelInset / 2
      : hierarchyRoute.panelRightX - hierarchyRoute.panelInset / 2
  const childGapY = hierarchyRoute.feedFromTop
    ? childPl.y - ROW_GAP / 2
    : childPl.y + childPl.height + ROW_GAP / 2
  const exitY = hierarchyRoute.feedFromTop ? parentPl.y + parentPl.height : parentPl.y
  const exitLaneY = hierarchyRoute.feedFromTop
    ? exitY + FINAL_ENTRY_OFFSET
    : exitY - FINAL_ENTRY_OFFSET
  const entryY = hierarchyRoute.feedFromTop ? childPl.y : childPl.y + childPl.height
  const gateX = (hierarchyRoute.panelLeftX + hierarchyRoute.panelRightX) / 2
  const borderY = hierarchyRoute.feedFromTop
    ? (hierarchyRoute.panelTopY ?? hierarchyRoute.corridorY)
    : (hierarchyRoute.panelBottomY ?? hierarchyRoute.corridorY)
  const TOP_INNER_LANE_OFFSET = 26
  const BOTTOM_INNER_LANE_OFFSET = 10
  const innerLaneY = hierarchyRoute.feedFromTop
    ? (hierarchyRoute.panelTopY ?? borderY) + TOP_INNER_LANE_OFFSET
    : (hierarchyRoute.panelBottomY ?? borderY) - BOTTOM_INNER_LANE_OFFSET

  return [
    parentCx,
    exitY,
    parentCx,
    exitLaneY,
    gateX,
    exitLaneY,
    gateX,
    hierarchyRoute.corridorY,
    gateX,
    borderY,
    gateX,
    innerLaneY,
    sideX,
    innerLaneY,
    sideX,
    childGapY,
    childCx,
    childGapY,
    childCx,
    entryY,
  ]
}

export function routeSharedSupplyToMainPanel(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  hierarchyRoute: PanelHierarchyRoute
): number[] {
  return routeSharedSupplyThroughHierarchyCorridor(parentPl, childPl, hierarchyRoute)
}

function routeSharedSupplyDirectToPanelBottom(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  hierarchyRoute: PanelHierarchyRoute
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2
  const exitY = parentPl.y
  const entryY = childPl.y + childPl.height
  return [
    parentCx,
    exitY,
    parentCx,
    hierarchyRoute.corridorY,
    childCx,
    hierarchyRoute.corridorY,
    childCx,
    entryY,
  ]
}

export function routeSharedSupplyToSupplyDevice(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  mainPanelLeftX: number,
  mainPanelRightX: number,
  preferredSide?: 'left' | 'right' | null,
  hierarchyRoute?: PanelHierarchyRoute | null,
  corridorY?: number | null,
  feedFromTop = true
): number[] {
  if (hierarchyRoute) {
    if (!hierarchyRoute.feedFromTop && parentPl.y > childPl.y) {
      return routeSharedSupplyDirectToPanelBottom(parentPl, childPl, hierarchyRoute)
    }
    return routeSharedSupplyThroughHierarchyCorridor(parentPl, childPl, hierarchyRoute)
  }

  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2
  const side =
    preferredSide ?? (parentCx - mainPanelLeftX <= mainPanelRightX - parentCx ? 'left' : 'right')
  const sideX =
    side === 'left'
      ? mainPanelLeftX - (SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA)
      : mainPanelRightX + SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA

  const exitY = feedFromTop ? parentPl.y + parentPl.height : parentPl.y
  const entryY = feedFromTop ? childPl.y : childPl.y + childPl.height
  const exitApproachY = feedFromTop ? exitY + FINAL_ENTRY_OFFSET : exitY - FINAL_ENTRY_OFFSET
  const entryApproachY = feedFromTop ? entryY - FINAL_ENTRY_OFFSET : entryY + FINAL_ENTRY_OFFSET
  const resolvedCorridorY =
    corridorY ?? (parentPl.y + parentPl.height / 2 + childPl.y + childPl.height / 2) / 2

  return [
    parentCx,
    exitY,
    parentCx,
    exitApproachY,
    sideX,
    exitApproachY,
    sideX,
    resolvedCorridorY,
    sideX,
    entryApproachY,
    childCx,
    entryApproachY,
    childCx,
    entryY,
  ]
}

/**
 * WSPF: feeder protection (source board) -> fed panel main-bus protection.
 * This intentionally does NOT reuse WSUD routing:
 * - leave source row lane first (top/bottom by feed direction)
 * - use opposite side corridor from feed side
 * - run via shared hierarchy corridor Y
 * - then enter target with side-corridor -> row-gap -> module entry
 */
export function routeMainProtectionToSecondaryPanelFeed(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  mainPanelLeftX: number,
  mainPanelRightX: number,
  preferredFeedSide?: 'left' | 'right' | null,
  sourceHierarchyRoute?: PanelHierarchyRoute | null,
  targetHierarchyRoute?: PanelHierarchyRoute | null,
  corridorY?: number | null,
  sourceFeedFromTop = true,
  targetFeedFromTop = true
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2
  const sourceFeedSide =
    sourceHierarchyRoute?.side ??
    preferredFeedSide ??
    (parentCx - mainPanelLeftX <= mainPanelRightX - parentCx ? 'left' : 'right')
  const sourceExitSide: 'left' | 'right' = sourceFeedSide === 'left' ? 'right' : 'left'
  const targetEntrySide =
    targetHierarchyRoute?.side ??
    preferredFeedSide ??
    (childCx - mainPanelLeftX <= mainPanelRightX - childPl.x ? 'left' : 'right')
  const sourceSideX = sourceHierarchyRoute
    ? sourceExitSide === 'left'
      ? sourceHierarchyRoute.panelLeftX + sourceHierarchyRoute.panelInset / 2
      : sourceHierarchyRoute.panelRightX - sourceHierarchyRoute.panelInset / 2
    : sourceExitSide === 'left'
      ? mainPanelLeftX - (SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA)
      : mainPanelRightX + SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA
  const targetSideX = targetHierarchyRoute
    ? targetEntrySide === 'left'
      ? targetHierarchyRoute.panelLeftX + targetHierarchyRoute.panelInset / 2
      : targetHierarchyRoute.panelRightX - targetHierarchyRoute.panelInset / 2
    : targetEntrySide === 'left'
      ? mainPanelLeftX - (SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA)
      : mainPanelRightX + SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA
  const exitY = sourceFeedFromTop ? parentPl.y + parentPl.height : parentPl.y
  const exitLaneY = sourceFeedFromTop ? exitY + FINAL_ENTRY_OFFSET : exitY - FINAL_ENTRY_OFFSET
  const derivedGapMidY = resolvePanelGapMidY(sourceHierarchyRoute, targetHierarchyRoute, null)
  const trunkY =
    derivedGapMidY ??
    corridorY ??
    targetHierarchyRoute?.corridorY ??
    sourceHierarchyRoute?.corridorY ??
    (parentPl.y + parentPl.height / 2 + childPl.y + childPl.height / 2) / 2
  const childGapY = targetFeedFromTop
    ? childPl.y - ROW_GAP / 2
    : childPl.y + childPl.height + ROW_GAP / 2
  const entryY = targetFeedFromTop ? childPl.y : childPl.y + childPl.height
  const sourceGateX =
    sourceHierarchyRoute != null
      ? (sourceHierarchyRoute.panelLeftX + sourceHierarchyRoute.panelRightX) / 2
      : parentCx
  const targetGateX =
    targetHierarchyRoute != null
      ? (targetHierarchyRoute.panelLeftX + targetHierarchyRoute.panelRightX) / 2
      : childCx
  const sourceBorderY = sourceFeedFromTop
    ? sourceHierarchyRoute?.panelBottomY
    : sourceHierarchyRoute?.panelTopY
  const targetBorderY = targetFeedFromTop
    ? targetHierarchyRoute?.panelTopY
    : targetHierarchyRoute?.panelBottomY
  // Dedicated border lanes inside panel padding (avoid title overlap on top lane).
  const TOP_INNER_LANE_OFFSET = 26
  const BOTTOM_INNER_LANE_OFFSET = 10
  const sourceInnerLaneY = sourceHierarchyRoute
    ? sourceFeedFromTop
      ? (sourceHierarchyRoute.panelBottomY ?? 0) - BOTTOM_INNER_LANE_OFFSET
      : (sourceHierarchyRoute.panelTopY ?? 0) + TOP_INNER_LANE_OFFSET
    : exitLaneY
  const targetInnerLaneY = targetHierarchyRoute
    ? targetFeedFromTop
      ? (targetHierarchyRoute.panelTopY ?? 0) + TOP_INNER_LANE_OFFSET
      : (targetHierarchyRoute.panelBottomY ?? 0) - BOTTOM_INNER_LANE_OFFSET
    : childGapY

  // Edge-row exception: if source exits toward the closest border row, skip
  // side-corridor detour and head straight to the center gate.
  const sourceBypassSideCorridor = Math.abs(exitY - sourceInnerLaneY) <= CELL_H + ROW_GAP

  const points: number[] = [parentCx, exitY, parentCx, exitLaneY]
  if (sourceBypassSideCorridor) {
    points.push(sourceGateX, exitLaneY, sourceGateX, sourceBorderY ?? sourceInnerLaneY)
  } else {
    points.push(
      sourceSideX,
      exitLaneY,
      sourceSideX,
      sourceInnerLaneY,
      sourceGateX,
      sourceInnerLaneY,
      sourceGateX,
      sourceBorderY ?? sourceInnerLaneY
    )
  }
  points.push(
    sourceGateX,
    trunkY,
    targetGateX,
    trunkY,
    targetGateX,
    targetBorderY ?? targetInnerLaneY
  )
  const directTargetRoute = [
    targetGateX,
    targetBorderY ?? targetInnerLaneY,
    targetGateX,
    childGapY,
    childCx,
    childGapY,
    childCx,
    entryY,
  ]
  const targetBypassSideCorridor = childPl.width === 0 && childPl.height === 0
  if (targetBypassSideCorridor) {
    points.push(...directTargetRoute.slice(2))
  } else {
    points.push(
      targetGateX,
      targetInnerLaneY,
      targetSideX,
      targetInnerLaneY,
      targetSideX,
      childGapY,
      childCx,
      childGapY,
      childCx,
      entryY
    )
  }
  return points
}

export function resolvePanelGapMidY(
  sourceRoute: PanelHierarchyRoute | null | undefined,
  targetRoute: PanelHierarchyRoute | null | undefined,
  fallback: number | null
): number | null {
  const sourceTop = sourceRoute?.panelTopY
  const sourceBottom = sourceRoute?.panelBottomY
  const targetTop = targetRoute?.panelTopY
  const targetBottom = targetRoute?.panelBottomY
  if (sourceTop == null || sourceBottom == null || targetTop == null || targetBottom == null) {
    return fallback
  }
  if (targetTop >= sourceBottom) return (sourceBottom + targetTop) / 2
  if (sourceTop >= targetBottom) return (targetBottom + sourceTop) / 2
  return ((sourceTop + sourceBottom) / 2 + (targetTop + targetBottom) / 2) / 2
}

export function resolveSinglePanelStubY(
  route: PanelHierarchyRoute | null | undefined,
  feedFromTop: boolean,
  mode: 'incoming' | 'outgoing',
  fallback: number | null
): number | null {
  const top = route?.panelTopY
  const bottom = route?.panelBottomY
  if (top == null || bottom == null) return fallback
  const STUB_MARGIN = 8
  const shouldUseTop = mode === 'incoming' ? feedFromTop : !feedFromTop
  return shouldUseTop ? top - STUB_MARGIN : bottom + STUB_MARGIN
}

export function routeWspfOutgoingStub(
  sourcePl: ModulePlacement,
  sourceRoute: PanelHierarchyRoute | null,
  preferredFeedSide?: 'left' | 'right' | null,
  sourceFeedFromTop = true,
  corridorY?: number | null
): number[] {
  const parentCx = sourcePl.x + sourcePl.width / 2
  const sourceFeedSide = sourceRoute?.side ?? preferredFeedSide ?? 'left'
  const sourceExitSide: 'left' | 'right' = sourceFeedSide === 'left' ? 'right' : 'left'
  const sourceExitX = sourceRoute
    ? sourceExitSide === 'left'
      ? sourceRoute.panelLeftX + sourceRoute.panelInset / 2
      : sourceRoute.panelRightX - sourceRoute.panelInset / 2
    : sourceExitSide === 'left'
      ? sourcePl.x - (SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA)
      : sourcePl.x + sourcePl.width + SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA
  const exitY = sourceFeedFromTop ? sourcePl.y + sourcePl.height : sourcePl.y
  const exitLaneY = sourceFeedFromTop ? exitY + FINAL_ENTRY_OFFSET : exitY - FINAL_ENTRY_OFFSET
  const trunkY = corridorY ?? sourceRoute?.corridorY ?? exitLaneY
  return [parentCx, exitY, parentCx, exitLaneY, sourceExitX, exitLaneY, sourceExitX, trunkY]
}

export function routeWspfIncomingStub(
  targetPl: ModulePlacement,
  targetRoute: PanelHierarchyRoute | null,
  preferredFeedSide?: 'left' | 'right' | null,
  targetFeedFromTop = true,
  corridorY?: number | null
): number[] {
  const childCx = targetPl.x + targetPl.width / 2
  const targetEntrySide = targetRoute?.side ?? preferredFeedSide ?? 'left'
  const targetEntryX = targetRoute
    ? targetEntrySide === 'left'
      ? targetRoute.panelLeftX + targetRoute.panelInset / 2
      : targetRoute.panelRightX - targetRoute.panelInset / 2
    : targetEntrySide === 'left'
      ? targetPl.x - (SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA)
      : targetPl.x + targetPl.width + SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA
  const childGapY = targetFeedFromTop
    ? targetPl.y - ROW_GAP / 2
    : targetPl.y + targetPl.height + ROW_GAP / 2
  const entryY = targetFeedFromTop ? targetPl.y : targetPl.y + targetPl.height
  const trunkY = corridorY ?? targetRoute?.corridorY ?? childGapY
  return [targetEntryX, trunkY, targetEntryX, childGapY, childCx, childGapY, childCx, entryY]
}
