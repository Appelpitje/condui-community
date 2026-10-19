import { z } from 'zod'

/** Curated field-survey tools, shared by the native capture and the atomic importer. */
export const ROOM_SCAN_SYMBOL_IDS = [
  'socket_gnd_child', 'light_point', 'switch', 'switch_impulse', 'switch_dimmer',
  'switch_1p_twoway', 'motion_detector', 'panel_distribution', 'fixed_appliance_generic',
  'smoke_detector', 'light_spot', 'switch_cross', 'light_led', 'light_fluorescent',
] as const
export type RoomScanSymbolId = typeof ROOM_SCAN_SYMBOL_IDS[number]
export const ROOM_SCAN_PRIMARY_SYMBOLS: readonly RoomScanSymbolId[] = ['socket_gnd_child', 'light_point', 'switch']

const coordinate = z.number().finite().min(-10_000).max(10_000)
export const roomScanPoint3Schema = z.object({ x: coordinate, y: coordinate, z: coordinate }).strict()
export const roomScanObservationSchema = z.object({
  id: z.string().min(1).max(100),
  symbolId: z.enum(ROOM_SCAN_SYMBOL_IDS),
  position: roomScanPoint3Schema,
  normal: roomScanPoint3Schema,
  quantity: z.number().int().min(1).max(4).default(1),
  photoDataUrl: z.string().max(160_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/).optional(),
}).strict()
export const roomScanModelPartSchema = z.object({
  id: z.string().min(1).max(100),
  category: z.string().max(80).optional(),
  confidence: z.string().max(20).optional(),
  kind: z.enum(['wall', 'door', 'window', 'opening', 'floor', 'object']),
  transform: z.array(z.number().finite().min(-10_000).max(10_000)).length(16),
  dimensions: z.object({
    x: z.number().finite().nonnegative().max(1_000),
    y: z.number().finite().nonnegative().max(1_000),
    z: z.number().finite().nonnegative().max(1_000),
  }).strict(),
}).strict()
export const roomScanModelSchema = z.object({
  parts: z.array(roomScanModelPartSchema).max(3_000),
  /** Apple's complete captured-room JSON, retained as source data, never executed. */
  capturedRoomJson: z.string().max(3_000_000),
}).strict()
export type RoomScanObservation = z.infer<typeof roomScanObservationSchema>
export type RoomScanModel = z.infer<typeof roomScanModelSchema>
export type RoomScanPoint3 = z.infer<typeof roomScanPoint3Schema>

export function roomScanCircuitGroup(symbolId: RoomScanSymbolId): 'sockets' | 'lighting' | 'equipment' | 'panel' {
  if (symbolId === 'socket_gnd_child') return 'sockets'
  if (symbolId === 'panel_distribution') return 'panel'
  if (symbolId === 'fixed_appliance_generic' || symbolId === 'smoke_detector') return 'equipment'
  return 'lighting'
}

export function isRoomScanWallFixture(symbolId: RoomScanSymbolId): boolean {
  return !['light_point', 'light_spot', 'light_led', 'light_fluorescent', 'smoke_detector'].includes(symbolId)
}
