import { registerPlugin } from '@capacitor/core'
import type { TFunction } from 'i18next'
import type { RoomPlanScanResult } from '@/lib/plan/roomPlanImport'
import { ROOM_SCAN_PRIMARY_SYMBOLS, ROOM_SCAN_SYMBOL_IDS } from '@/lib/plan/roomScanCapture'
import { getSymbolById } from '@/lib/symbols'
import { getLocalizedSymbolName } from '@/lib/symbolNames'
export type { RoomPlanScanResult, RoomPlanSurface } from '@/lib/plan/roomPlanImport'

type RoomPlanScanOptions = {
  roomName: string
  includePlacements: boolean
  appearance?: 'light' | 'dark'
  symbols: Array<{ id: string; title: string; image: string; primary: boolean; category?: string; payloadId?: string; quantity?: number; extra: boolean; compactTitle?: string }>
  strings: Record<string, string>
}
type RoomPlanPlugin = {
  isSupported(): Promise<{ supported: boolean }>
  scanRoom(options: RoomPlanScanOptions): Promise<RoomPlanScanResult>
}
export const RoomPlan = registerPlugin<RoomPlanPlugin>('RoomPlan')

/** Native UIKit uses the exact library SVG artwork, rasterized at 3× for its template images. */
async function nativeSymbolImage(source: string): Promise<string> {
  const image = new Image()
  image.src = source
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = 96; canvas.height = 96
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not prepare scan symbols')
  const ratio = Math.min(88 / image.naturalWidth, 88 / image.naturalHeight)
  const width = image.naturalWidth * ratio, height = image.naturalHeight * ratio
  context.drawImage(image, (96 - width) / 2, (96 - height) / 2, width, height)
  return canvas.toDataURL('image/png')
}

export async function prepareNativeRoomScanOptions(
  roomName: string, includePlacements: boolean, t: TFunction, language: string, appearance?: 'light' | 'dark',
): Promise<RoomPlanScanOptions> {
  const keys = [
    'cancel', 'undo', 'finish', 'center', 'review', 'back', 'more', 'placements', 'processing',
    'locked', 'centerAim', 'markFixtures', 'tracking', 'trackingPaused', 'offscreen', 'noMarks',
    'finishRoom', 'fewerSockets', 'moreSockets', 'variantHint', 'surfaceNeeded',
  ] as const
  const strings = Object.fromEntries(keys.map((key) => [key, t(`nativeRoomScan.capture.${key}`)]))
  const category = (id: string): string | undefined => {
    if (id.includes('socket')) return 'sockets'
    if (id.startsWith('light_')) return 'lighting'
    if (['switch', 'switch_1p_twoway', 'switch_cross', 'switch_dimmer', 'switch_impulse'].includes(id)) return 'switches'
    return undefined
  }
  const extraIds: readonly string[] = ['switch_impulse', 'switch_dimmer', 'switch_1p_twoway', 'motion_detector', 'panel_distribution', 'fixed_appliance_generic', 'smoke_detector', 'light_spot']
  const specs = [
    ...ROOM_SCAN_SYMBOL_IDS.map((id) => ({ id, sourceId: id, quantity: 1, payloadId: id })),
    { id: 'double_socket_gnd_child', sourceId: 'double_socket_gnd_child', quantity: 2, payloadId: 'socket_gnd_child' },
    { id: 'socket_bank_3', sourceId: 'socket_gnd_child', quantity: 3, payloadId: 'socket_gnd_child' },
    { id: 'socket_bank_4', sourceId: 'socket_gnd_child', quantity: 4, payloadId: 'socket_gnd_child' },
  ]
  const symbols = includePlacements ? await Promise.all(specs.map(async ({ id, sourceId, quantity, payloadId }) => {
    const symbol = getSymbolById(sourceId)
    if (!symbol) throw new Error(`Missing scan symbol ${sourceId}`)
    const title = getLocalizedSymbolName(symbol, language)
    const shortKey: Record<string, string> = { socket_gnd_child: 'socket', light_point: 'light', switch: 'switch', switch_1p_twoway: 'twoWay', switch_cross: 'cross', switch_impulse: 'push', switch_dimmer: 'dimmer', light_led: 'led', light_fluorescent: 'fluorescent', light_spot: 'spot' }
    const compactTitle = quantity > 1 ? `${t('nativeRoomScan.capture.variants.socket')} ×${quantity}` : shortKey[id] ? t(`nativeRoomScan.capture.variants.${shortKey[id]}`) : title
    return {
      id, title: quantity > 2 ? `${title} ×${quantity}` : title,
      image: await nativeSymbolImage(symbol.svgPath),
      primary: ROOM_SCAN_PRIMARY_SYMBOLS.includes(id as typeof ROOM_SCAN_PRIMARY_SYMBOLS[number]),
      category: category(id), payloadId, quantity, extra: extraIds.includes(id), compactTitle,
    }
  })) : []
  return { roomName, includePlacements, symbols, strings, appearance }
}
