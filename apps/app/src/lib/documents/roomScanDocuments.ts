import { z } from 'zod'
import { roomScanModelSchema, roomScanObservationSchema } from '@/lib/plan/roomScanCapture'

export const roomScanModelDocumentSchema = roomScanModelSchema.extend({
  version: z.literal(1), units: z.literal('meters'),
}).strict()
export const roomScanEvidenceEntrySchema = roomScanObservationSchema.extend({
  target: z.object({ type: z.enum(['endpoint', 'panel']), id: z.string().min(1) }).strict(),
  placementId: z.string().min(1),
  circuitId: z.string().min(1).optional(),
  pos: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
  heightCm: z.number().finite(),
  roomId: z.string().optional(),
  roomName: z.string().optional(),
  rotationDeg: z.number().finite().optional(),
}).strict()
export const roomScanPlacementsDocumentSchema = z.object({
  version: z.literal(1), units: z.literal('meters'),
  entries: z.array(roomScanEvidenceEntrySchema).max(80),
}).strict()
export type RoomScanModelDocument = z.infer<typeof roomScanModelDocumentSchema>
export type RoomScanPlacementsDocument = z.infer<typeof roomScanPlacementsDocumentSchema>
