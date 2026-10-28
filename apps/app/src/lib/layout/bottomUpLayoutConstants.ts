// Layout constants (bottom-up, but Y increases DOWNWARD on screen)
// Supply is at bottom (high Y), everything grows UP (lower Y values)
export const LAYOUT_CONSTANTS = {
  // Vertical spacing (from bottom, supply has high Y, going UP means decreasing Y)
  SUPPLY_Y: 800, // Supply at bottom (high Y value)
  MAIN_BUS_Y: 700, // Main bus above supply (lower Y)
  MCB_Y_OFFSET: 25, // MCB sits on vertical branch slightly up from main bus (going UP = subtract)
  PROTECTION_Y: 700, // Base Y for MCB calculation (will be mainBusY - MCB_Y_OFFSET)
  RCD_VERTICAL_OFFSET: 50, // Vertical distance from main bus to RCD symbol (going UP = subtract)
  RCD_TRUNK_OFFSET: 100, // Vertical distance from main bus to RCD trunk (above RCD, going UP = subtract)
  TRUNK_Y_SPACING: 120, // Spacing between trunk levels (going UP = subtract)
  BRANCH_START_OFFSET: 80, // Vertical spacing from MCB to first endpoint branch (going UP = subtract) - DOUBLED
  ENDPOINT_BRANCH_SPACING: 50, // Vertical spacing between endpoint horizontal branches (going UP = subtract)

  // Horizontal circuit spacing is derived from painted envelopes relative to
  // each circuit's trunk anchor. The same packer recursively lays out secondary
  // bus children. Their envelopes already include painted-ink safety margins,
  // so adjacent boxes can touch without an additional outer gutter.
  LEFT_MARGIN: 30,
  /** Extra gap between already padded circuit envelopes. */
  CIRCUIT_ENVELOPE_GUTTER: 0,
  /**
   * Floor for top-level main-bus circuit column width (applied before advancing `currentX`).
   * Nested secondary-bus columns do not use this floor.
   */
  CIRCUIT_MIN_WIDTH: 40,
  TRUNK_PADDING: 20,
  BRANCH_LEAD_IN: 20, // Space before first endpoint on branch (was 80, now 1/4)
  ENDPOINT_HORIZONTAL_SPACING: 30, // Between endpoints on same branch
  /** Extra gap between socket and fixed appliance (0 = same spacing as between switch and socket) */
  APPLIANCE_AFTER_SOCKET_GAP: 0,
  SUPPLY_RIGHT_FRAME_PADDING: 40,
  SUPPLY_LEFT_OFFSET: 30, // Offset from left edge of main bus for supply symbol
  SUPPLY_MAX_OFFSET: 150, // Maximum distance from left edge of main bus

  // Element dimensions
  SYMBOL_SIZE: 30,
  PROTECTION_WIDTH: 60,
  RCD_WIDTH: 60,
  BUS_THICKNESS: 5, // Thick line for main bus and trunks
  SECONDARY_BUS_EXTENSION: 15, // Extension left and right for secondary bus bars (wider start/end pads)
  DC_BUS_MIN_WIDTH: 48,
  /** Small visual lead before the incoming wire's first DC-bus branch. */
  DC_BUS_LEFT_EXTENSION: 3,
  DC_BUS_BRANCH_LEAD_IN: 24,
  /** Short visible lead between a supply converter's side port and a left-growing DC bus. */
  SUPPLY_DC_BUS_CONNECTION_LEAD: 24,
  /** Dedicated first column for a panel that shares a secondary bus with nested protections. */
  SECONDARY_BUS_PANEL_COLUMN_WIDTH: 70,
  /** Extra vertical clearance above nested protections for a panel on the same secondary bus. */
  SECONDARY_BUS_PANEL_VERTICAL_OFFSET: 110,
  /** Feeder length from a nested, panel-only protection to its panel symbol. */
  NESTED_PANEL_FEEDER_VERTICAL_OFFSET: 110,
  /** Vertical gap between last endpoint branch and secondary bus when circuit has both endpoints and subcircuits */
  SECONDARY_BUS_ABOVE_ENDPOINTS_GAP: 50,
  BRANCH_LINE_WIDTH: 2, // Thin line for branches
  MIN_MAIN_BUS_WIDTH: 60, // Minimum main bus width when panel has no circuits

  // Endpoint chain layout
  LABEL_OFFSET: 20, // Offset for branch labels (to the left)

  // Trunk devices (energy meters etc. on vertical wire)
  TRUNK_DEVICE_SPACING: 30, // Extra vertical space added for each trunk device on the vertical wire
  TRUNK_DEVICE_MCB_GAP: 70, // Distance from MCB center to trunk device center (was BRANCH_START_OFFSET/2 = 40)

  // Supply wire layout (main panel only)
  SUPPLY_VERTICAL_DROP: 60, // Vertical drop from main bus before bending right
  SUPPLY_DEVICE_SPACING: 60, // Horizontal spacing between devices on the supply wire (+20% vs branch spacing for readability)
  // A direct backup protection needs a wider converter-side span so the W03
  // cable label and its route glyphs fit without crowding either symbol.
  SUPPLY_DIRECT_CONVERTER_PROTECTION_SPACING: 80,
  // The switched inverter lanes carry phase, cable and device metadata on both
  // sides of the converter, so keep the changeover rectangle deliberately open.
  SUPPLY_CHANGEOVER_LANE_OFFSET: 66,
  SUPPLY_CHANGEOVER_RENDER_SIZE: 20,
  SUPPLY_CHANGEOVER_ELBOW_LEAD: 18,
  SUPPLY_CHANGEOVER_SLOT_LENGTH: 68,
  SUPPLY_CHANGEOVER_BRANCH_DEVICE_SPACING: 66,
  // Reserve a clean span for an enclosure-boundary marker and the adjacent
  // wire label between the selector and its first load-side device.
  SUPPLY_CHANGEOVER_LOAD_BOUNDARY_CLEARANCE: 30,
  SUPPLY_CHANGEOVER_GRID_SOURCE_LEAD: 24,
  SUPPLY_CHANGEOVER_VERTICAL_EXPANSION: 22,
  SUPPLY_VERTICAL_LEG_DEVICE_SPACING: 44,
  // Give the direct inverter input lane enough vertical room for protection
  // labels and inline modular devices around the converter.
  SUPPLY_DIRECT_CONVERTER_OFFSET: 91,
  // Two vertical input-leg devices fit the compact inverter lane. Each further
  // device grows the entire inverter-to-grid-rail span by one modest symbol slot.
  SUPPLY_DIRECT_CONVERTER_INPUT_LEG_EXPANSION: 30,
  // Keep the direct backup branch clear of the main-bus supply drop. This is
  // intentionally wider than one normal supply-device step because endpoint
  // symbols and protection labels also occupy the left side of this lane.
  SUPPLY_DIRECT_CONVERTER_BACKUP_LEFT_CLEARANCE: 90,
  // DC branches need room for wire labels plus inverter/battery/solar metadata.
  // This also doubles the rise before the upper solar branch turns right.
  SUPPLY_CONVERTER_DC_SLOT_LENGTH: 90,
  // The first occupied device can sit closer to the converter than an empty
  // drop slot; subsequent devices retain the normal one-wire spacing.
  SUPPLY_CONVERTER_DC_FIRST_DEVICE_OFFSET: 72,
  // Only the first DC device needs the expanded clearance from the inverter.
  // Devices after it keep the normal one-wire spacing.
  SUPPLY_CONVERTER_DC_DEVICE_SPACING: 45,
  SUPPLY_DC_BUS_BRANCH_DEVICE_SPACING: 58,
  SUPPLY_DC_BUS_BRANCH_MIN_SPACING: 72,
  SUPPLY_DC_BUS_BRANCH_LABEL_GAP: 14,
  SUPPLY_DC_BUS_TERMINAL_GAP: 12,
  SUPPLY_DC_BUS_SIDE_TERMINAL_TRIM: 36,
  PROTECTION_LABEL_GAP: 5,
} as const

/** WireSegment paints main buses as 6 px round-capped lines. */
export const MAIN_BUS_RENDER_STROKE_WIDTH = 6

export const SUPPLY_TOP_LABEL_FONT_SIZE = 8
export const SUPPLY_TOP_LABEL_LINE_SPACING = 2
export const SUPPLY_TOP_LABEL_OFFSET_FROM_SYMBOL = 5
export const SUPPLY_METADATA_CALLOUT_DEVICE_TOP_EXTRA = 25
export const SUPPLY_METADATA_CALLOUT_INVERTER_TOP_EXTRA = 37

export const SUPPLY_FRAME_TOP_CONTENT_GAP = 14

export const SUPPLY_VERTICAL_NOTE_BUS_CLEARANCE = 12

export const DETACHED_SUPPLY_MAIN_BUS_TOP_OFFSET = 36

export const SUPPLY_INFO_DEVICE_HORIZONTAL_REACH = 42

export const SUPPLY_VOLTAGE_LABEL_X_OFFSET = LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 + 6

export const SUPPLY_VOLTAGE_LABEL_FONT_SIZE = 12

export const SUPPLY_VOLTAGE_LABEL_PADDING = 6
