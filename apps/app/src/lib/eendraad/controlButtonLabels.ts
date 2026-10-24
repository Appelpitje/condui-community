import type { Endpoint } from '@/types/schema'
import { SYMBOL_SIZE } from '@/lib/canvas/symbolGeometry'
import { DOMOTICA_BASE_HEIGHT, DOMOTICA_CHILD_NOTE_ROW_RESERVE } from '@/lib/domoticaLayout'
import {
  getScopedBusDeviceAddress,
  getScopedBusRowLabel,
  getScopedRowAddress,
} from '@/lib/controlLink/controlLinkNoteContext'
import { getActiveControlButtonAddresses, getControlButtonCount } from '@/lib/controlLink/buttonAddressing'
import { getConnectionDirection } from '@/lib/controlLink/controlLink'
import { getVisibleEndpointNoteText } from '@/lib/conversionLabels'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import { countSymbolLabelVisualLines } from '@/lib/symbolLabelMetrics'
import {
  TERMINAL_STRIP_IDENTITY_LABEL_FONT_SIZE,
  TERMINAL_STRIP_IDENTITY_LABEL_GAP,
} from '@/lib/terminalStrip/identityLabelLayout'
import { getEndpointNoteMinimumLeftX, getCollisionSafeCenteredLabelLeftX } from './endpointNoteLabelCollision'

export const CONTROL_BUTTON_LABEL_FONT_SIZE = TERMINAL_STRIP_IDENTITY_LABEL_FONT_SIZE
export const CONTROL_BUTTON_LABEL_GAP = TERMINAL_STRIP_IDENTITY_LABEL_GAP
export const CONTROL_BUTTON_LABEL_LINE_HEIGHT = CONTROL_BUTTON_LABEL_FONT_SIZE + 2
const OWN_NOTE_GAP = 5
const OWN_NOTE_FONT_SIZE = 8
const OWN_NOTE_LINE_HEIGHT = 10

/** Each physical input keeps its own programmed channel and logical addresses. */
export function getControlButtonLabelLines(
  endpoint: Endpoint,
  busDeviceAddress = getScopedBusDeviceAddress(endpoint.id),
  outputAddress = getScopedRowAddress(endpoint.id),
): string[] {
  const identity = busDeviceAddress ? [busDeviceAddress] : []
  if (getConnectionDirection(endpoint) !== 'input') {
    const rowChannel = endpoint.domoticaChildProps && !getScopedBusRowLabel(endpoint.id)
      ? outputAddress
      : undefined
    return rowChannel ? [...identity, rowChannel] : identity
  }
  const addressing = endpoint.domoticaChildProps ?? endpoint.controlLink
  if (!addressing) return identity
  const numbered = getControlButtonCount(endpoint) > 1
  return [...identity, ...getActiveControlButtonAddresses(endpoint, addressing).flatMap((address) => {
    const value = [address.channel, ...address.groups].filter(Boolean).join(' · ')
    return value ? [`${numbered ? `${address.buttonIndex + 1}: ` : ''}${value}`] : []
  })]
}

/** Identical text and metrics for live symbols, scene envelopes and portable exports. */
export function getControlButtonLabelLayout(
  endpoint: Endpoint,
  symbolSize = SYMBOL_SIZE,
  fontFamily = 'Figtree',
  busDeviceAddress = getScopedBusDeviceAddress(endpoint.id),
  outputAddress = getScopedRowAddress(endpoint.id),
) {
  const lines = getControlButtonLabelLines(endpoint, busDeviceAddress, outputAddress)
  if (!lines.length) return undefined
  const visualLines = lines.reduce((sum, text) => sum + countSymbolLabelVisualLines(text), 0)
  const height = visualLines * CONTROL_BUTTON_LABEL_LINE_HEIGHT - 2
  const width = Math.max(...lines.map((text) => measureSymbolLabelTextWidth(text, fontFamily, CONTROL_BUTTON_LABEL_FONT_SIZE)))
  const halfHeight = endpoint.symbol === 'domotica' ? DOMOTICA_BASE_HEIGHT / 2 : symbolSize / 2
  const offsetFromSymbol = CONTROL_BUTTON_LABEL_GAP + (endpoint.symbol === 'domotica' && endpoint.domoticaChildProps ? DOMOTICA_CHILD_NOTE_ROW_RESERVE : 0)
  return {
    lines, width, height,
    offsetFromSymbol,
    top: halfHeight + offsetFromSymbol,
    bottom: halfHeight + offsetFromSymbol + height,
    ownNoteOffset: offsetFromSymbol + height + OWN_NOTE_GAP,
  }
}

/** Complete below-button paint, including the endpoint's independent ordinary notes. */
export function getControlButtonAnnotationBounds(
  endpoint: Endpoint, x: number, y: number, trunkX: number, fontFamily = 'Figtree',
) {
  if (
    getConnectionDirection(endpoint) !== 'input' &&
    !getScopedBusDeviceAddress(endpoint.id) &&
    !(endpoint.domoticaChildProps && !getScopedBusRowLabel(endpoint.id) && getScopedRowAddress(endpoint.id))
  ) return undefined
  const label = getControlButtonLabelLayout(endpoint, SYMBOL_SIZE, fontFamily)
  const note = getVisibleEndpointNoteText(endpoint)
  if (!label && !note) return undefined
  const minimumLeft = getEndpointNoteMinimumLeftX(x, trunkX)
  const left = x + getCollisionSafeCenteredLabelLeftX(label?.width ?? 0, minimumLeft)
  const noteWidth = note ? measureSymbolLabelTextWidth(note, fontFamily, OWN_NOTE_FONT_SIZE) : 0
  const noteLeft = x + getCollisionSafeCenteredLabelLeftX(noteWidth, minimumLeft)
  const noteBottom = note
    ? y + (endpoint.symbol === 'domotica' ? DOMOTICA_BASE_HEIGHT / 2 : SYMBOL_SIZE / 2) + (label?.ownNoteOffset ?? OWN_NOTE_GAP) + countSymbolLabelVisualLines(note) * OWN_NOTE_LINE_HEIGHT - 2
    : -Infinity
  return {
    left: label && note ? Math.min(left, noteLeft) : label ? left : noteLeft,
    right: Math.max(label ? left + label.width : -Infinity, note ? noteLeft + noteWidth : -Infinity),
    top: y + (label?.top ?? SYMBOL_SIZE / 2 + OWN_NOTE_GAP),
    bottom: Math.max(label ? y + label.bottom : -Infinity, noteBottom),
  }
}
