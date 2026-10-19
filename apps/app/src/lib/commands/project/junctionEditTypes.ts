import { z } from 'zod'

const id = z.string().min(1).max(200)
const index = z.number().int().nonnegative().max(1000)
const side = z.enum(['top', 'right', 'bottom', 'left'])
const level = z.strictObject({ role: z.enum(['any', 'n', 'pe', 'shield']), ordinal: index })
const core = z.strictObject({ wireAnchor: id, coreId: id, end: z.enum(['source', 'load']) })
const clamp = z.strictObject({
  blockId: id,
  level,
  side: z.enum(['field', 'board']),
  clamp: index,
})
const device = z.strictObject({
  kind: z.enum(['protection', 'trunk_device', 'endpoint']),
  id,
  port: id,
  pole: id,
})
const entry = z.strictObject({ side, index: z.number().int().min(0).max(11) })
const smallIdList = z.array(id).min(1).max(128)

export const junctionEditActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('placeCore'),
    core,
    at: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('clamp'), clamp }),
      z.strictObject({ kind: z.literal('connector'), connectorId: id }),
    ]),
  }),
  z.strictObject({ kind: z.literal('removeCore'), core }),
  z.strictObject({ kind: z.literal('setBoardWire'), clamp, device: device.nullable() }),
  z.strictObject({ kind: z.literal('moveBoxEntry'), wireAnchor: id, entry }),
  z.strictObject({
    kind: z.literal('setBoxEntryCount'),
    side,
    count: z.number().int().min(0).max(12),
  }),
  z.strictObject({ kind: z.literal('addConnector') }),
  z.strictObject({ kind: z.literal('removeConnector'), connectorId: id }),
  z.strictObject({ kind: z.literal('addBlock'), shapeId: id, position: index.optional() }),
  z.strictObject({ kind: z.literal('removeBlocks'), blockIds: smallIdList }),
  z.strictObject({ kind: z.literal('moveBlocks'), blockIds: smallIdList, beforeId: id.nullable() }),
  z.strictObject({ kind: z.literal('addJumper'), blockIds: z.array(id).min(2).max(128), level }),
  z.strictObject({ kind: z.literal('addWireJumper'), from: clamp, to: clamp }),
  z.strictObject({ kind: z.literal('removeCommoning'), commoningId: id }),
  z.strictObject({ kind: z.literal('setGroupBreak'), blockId: id, enabled: z.boolean() }),
  z.strictObject({ kind: z.literal('setBlockShape'), blockIds: smallIdList, shapeId: id }),
  z.strictObject({ kind: z.literal('moveConnections'), blockIds: smallIdList, toBlockId: id }),
  z.strictObject({
    kind: z.literal('placeCable'),
    wireAnchor: id,
    end: z.enum(['source', 'load']),
    startBlockId: id,
  }),
  z.strictObject({
    kind: z.literal('connectCable'),
    wireAnchor: id,
    end: z.enum(['source', 'load']),
    entry: entry.optional(),
  }),
  z.strictObject({ kind: z.literal('autoFill') }),
  z.strictObject({ kind: z.literal('reset') }),
  z.strictObject({ kind: z.literal('markChecked') }),
  z
    .strictObject({
      kind: z.literal('setDescription'),
      title: z.string().max(160).nullable().optional(),
      location: z.string().max(500).nullable().optional(),
      notes: z.string().max(4000).nullable().optional(),
    })
    .refine(
      (value) =>
        value.title !== undefined || value.location !== undefined || value.notes !== undefined
    ),
])

export const junctionEditInputSchema = z.strictObject({
  assetId: id,
  action: junctionEditActionSchema,
})

export type JunctionEditInput = z.infer<typeof junctionEditInputSchema>
export type JunctionEditAction = JunctionEditInput['action']
