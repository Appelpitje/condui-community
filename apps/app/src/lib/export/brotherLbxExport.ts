import JSZip from 'jszip'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import {
  buildLabelStripModel,
  getBrotherTapeWidthsMm,
  getDefaultBrotherLbxMode,
  getDefaultBrotherTapeWidthMm,
  type BrotherLbxMode,
  type BrotherPrinter,
  type BrotherTapeWidthMm,
  type LabelStrip,
  type LabelStripExportOptions,
  type LabelStripModuleProvider,
  type LabelStripSegment,
  selectedBoardLabels,
} from './labelStripExport'
import type { BoardLabel } from './boardLabels'
import { rasterizeInvertedBand } from './monochromeBmp'

const PT_PER_MM = 72 / 25.4
const PAPER_FORMAT = '260'
const PROFILE_FEED_PT = 5.6
const BACKGROUND_X_PT = 2.8
const BACKGROUND_Y_PT = 2.2
const PAPER_MARGIN_X_PT = 2.2
const PAPER_MARGIN_Y_PT = 11.4
const OUTER_TEXT_INSET_PT = 8.6
const DASH_HEIGHT_PT = 3
const DASH_GAP_PT = 2
const MODULE_WIDTH_MM = 18
const BLANK_GUIDE_INTERVAL_MM = MODULE_WIDTH_MM * 2
const CUT_SPACER_MM = 5
const PACK_HEADER_WIDTH_MM = 36
const PT_MAX_PACKED_LENGTH_MM = 950
const QL_MAX_PACKED_LENGTH_MM = 900
const BAND_IMAGE_DPI = 360
const MIN_BAND_HEIGHT_PT = 7

const PT_NS = 'http://schemas.brother.info/ptouch/2007/lbx/main'
const STYLE_NS = 'http://schemas.brother.info/ptouch/2007/lbx/style'
const TEXT_NS = 'http://schemas.brother.info/ptouch/2007/lbx/text'
const DRAW_NS = 'http://schemas.brother.info/ptouch/2007/lbx/draw'

const BROTHER_PROFILES = {
  'pt-p900-family': {
    printerId: '28464',
    printerName: 'Brother PT-P900W',
    maxPackedLengthMm: PT_MAX_PACKED_LENGTH_MM,
  },
  'pt-e920bt': {
    printerId: '33328',
    printerName: 'Brother PT-E920BT',
    maxPackedLengthMm: PT_MAX_PACKED_LENGTH_MM,
  },
  'pt-p910bt': {
    printerId: '30768',
    printerName: 'Brother PT-P910BT',
    maxPackedLengthMm: PT_MAX_PACKED_LENGTH_MM,
  },
  'pt-e800w': {
    printerId: '29744',
    printerName: 'Brother PT-E800W',
    maxPackedLengthMm: PT_MAX_PACKED_LENGTH_MM,
  },
  'pt-d800w': {
    printerId: '28208',
    printerName: 'Brother PT-D800W',
    maxPackedLengthMm: PT_MAX_PACKED_LENGTH_MM,
  },
  'pt-e550w': {
    printerId: '26160',
    printerName: 'Brother PT-E550W',
    maxPackedLengthMm: PT_MAX_PACKED_LENGTH_MM,
  },
  'pt-e560bt': {
    printerId: '32560',
    printerName: 'Brother PT-E560BT',
    maxPackedLengthMm: PT_MAX_PACKED_LENGTH_MM,
  },
  'pt-e310bt': {
    printerId: '32048',
    printerName: 'Brother PT-E310BT',
    maxPackedLengthMm: PT_MAX_PACKED_LENGTH_MM,
  },
  'ql-810w': {
    printerId: '14644',
    printerName: 'Brother QL-810W',
    maxPackedLengthMm: QL_MAX_PACKED_LENGTH_MM,
  },
  'ql-820nwb': {
    printerId: '16692',
    printerName: 'Brother QL-820NWB',
    maxPackedLengthMm: QL_MAX_PACKED_LENGTH_MM,
  },
} as const

function pt(value: number): string {
  return `${value.toFixed(4)}pt`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function objectStyle(
  x: number,
  y: number,
  width: number,
  height: number,
  objectName: string,
  penStyle = 'NULL'
): string {
  return `<pt:objectStyle x="${pt(x)}" y="${pt(y)}" width="${pt(width)}" height="${pt(height)}" backColor="#FFFFFF" backPrintColorNumber="0" ropMode="COPYPEN" angle="0" anchor="TOPLEFT" flip="NONE"><pt:pen style="${penStyle}" widthX="0.5pt" widthY="0.5pt" color="#000000" printColorNumber="1"></pt:pen><pt:brush style="NULL" color="#000000" printColorNumber="1" id="0"></pt:brush><pt:expanded objectName="${escapeXml(objectName)}" ID="0" lock="0" templateMergeTarget="LABELLIST" templateMergeType="NONE" templateMergeID="0" linkStatus="NONE" linkID="0"></pt:expanded></pt:objectStyle>`
}

interface TextObjectOptions {
  fontSizePt?: number
  weight?: number
  clipFrame?: boolean
  align?: 'LEFT' | 'CENTER'
}

function textObject(
  x: number,
  y: number,
  width: number,
  height: number,
  value: string,
  index: number,
  options: TextObjectOptions = {}
) {
  const fontSizePt = options.fontSizePt ?? 8
  const weight = options.weight ?? 400
  const clipFrame = options.clipFrame ?? false
  const align = options.align ?? 'CENTER'
  const charLength = Array.from(value).length
  return `<text:text>${objectStyle(x, y, width, height, `Text${index}`)}<text:ptFontInfo><text:logFont name="Helsinki" width="0" italic="false" weight="${weight}" charSet="0" pitchAndFamily="2"></text:logFont><text:fontExt effect="NOEFFECT" underline="0" strikeout="0" size="${fontSizePt}pt" orgSize="${(fontSizePt * 3.6).toFixed(1)}pt" textColor="#000000" textPrintColorNumber="1"></text:fontExt></text:ptFontInfo><text:textControl control="FIXEDFRAME" clipFrame="${clipFrame}" aspectNormal="true" shrink="true" autoLF="false" avoidImage="false"></text:textControl><text:textAlign horizontalAlignment="${align}" verticalAlignment="CENTER" inLineAlignment="BASELINE"></text:textAlign><text:textStyle vertical="false" nullBlock="false" charSpace="0" lineSpace="0" orgPoint="${fontSizePt}pt" combinedChars="false"></text:textStyle><pt:data>${escapeXml(value)}</pt:data><text:stringItem charLen="${charLength}"><text:ptFontInfo><text:logFont name="Helsinki" width="0" italic="false" weight="${weight}" charSet="0" pitchAndFamily="2"></text:logFont><text:fontExt effect="NOEFFECT" underline="0" strikeout="0" size="${fontSizePt}pt" orgSize="${(fontSizePt * 3.6).toFixed(1)}pt" textColor="#000000" textPrintColorNumber="1"></text:fontExt></text:ptFontInfo></text:stringItem></text:text>`
}

/** Collects the bitmaps an LBX archive embeds next to label.xml. */
class LbxImageSink {
  readonly files = new Map<string, Uint8Array>()
  private readonly names = new Map<string, string | null>()

  invertedBand(text: string, widthPt: number, heightPt: number): string | null {
    const widthPx = Math.round((widthPt / 72) * BAND_IMAGE_DPI)
    const heightPx = Math.round((heightPt / 72) * BAND_IMAGE_DPI)
    const key = `${text}|${widthPx}|${heightPx}`
    if (this.names.has(key)) return this.names.get(key)!
    const bytes = rasterizeInvertedBand(text, widthPx, heightPx)
    const name = bytes ? `Object${this.files.size}.bmp` : null
    if (name && bytes) this.files.set(name, bytes)
    this.names.set(key, name)
    return name
  }

  addTo(archive: JSZip): void {
    for (const [name, bytes] of this.files) archive.file(name, bytes)
  }
}

function imageObject(
  x: number,
  y: number,
  width: number,
  height: number,
  fileName: string,
  index: number
): string {
  return `<image:image>${objectStyle(x, y, width, height, `Image${index}`)}<image:imageStyle originalName="" alignInText="LEFT" firstMerge="true" fileName="${escapeXml(fileName)}"><image:transparent flag="false" color="#FFFFFF"></image:transparent><image:trimming flag="false" shape="RECTANGLE" trimOrgX="0pt" trimOrgY="0pt" trimOrgWidth="${pt(width)}" trimOrgHeight="${pt(height)}"></image:trimming><image:orgPos x="${pt(x)}" y="${pt(y)}" width="${pt(width)}" height="${pt(height)}"></image:orgPos><image:effect effect="NONE" brightness="50" contrast="50" photoIndex="4"></image:effect><image:mono operationKind="BINARY" reverse="0" ditherKind="STANDARD" threshold="128" gamma="0" ditherEdge="0" rgbconvProportionRed="0" rgbconvProportionGreen="0" rgbconvProportionBlue="0" rgbconvProportionReversed="0"></image:mono></image:imageStyle></image:image>`
}

function mainBandHeightPt(height: number): number {
  return Math.max(MIN_BAND_HEIGHT_PT, height * 0.24)
}

function scissorSymbol(x: number, y: number, width: number, height: number, index: number): string {
  // Native encoding from the supplied scissor.lbx: PT Dingbats 1, code 88.
  return `<draw:symbol>${objectStyle(x, y, width, height, `Symbol${index}`)}<draw:symbolStyle fontName="PT Dingbats 1" code="88"/></draw:symbol>`
}

function polyLine(x: number, y: number, height: number, objectName: string): string {
  const left = x - 0.5
  return `<draw:poly>${objectStyle(left, y, 1, height, objectName, 'INSIDEFRAME')}<draw:polyStyle shape="LINE" arrowBegin="SQUARE" arrowEnd="SQUARE"><draw:polyOrgPos x="${pt(left)}" y="${pt(y)}" width="1pt" height="${pt(height)}"/><draw:polyLinePoints points="${pt(x)},${pt(y + 0.5)} ${pt(x)},${pt(y + height - 0.5)}"/></draw:polyStyle></draw:poly>`
}

function dashedSeparator(x: number, y: number, height: number, index: number | string): string {
  const pieces: string[] = []
  let cursor = 0
  let dashIndex = 1
  while (cursor < height) {
    const segmentHeight = Math.min(DASH_HEIGHT_PT, height - cursor)
    if (segmentHeight >= 1) pieces.push(polyLine(x, y + cursor, segmentHeight, `Separator${index}_${dashIndex}`))
    cursor += DASH_HEIGHT_PT + DASH_GAP_PT
    dashIndex += 1
  }
  return pieces.join('')
}

function blankGuideSeparators(
  segmentStartMm: number,
  segmentWidthMm: number,
  y: number,
  height: number,
  index: number,
  guideOriginMm = 0
): string {
  const relativeStartMm = segmentStartMm - guideOriginMm
  const relativeEndMm = relativeStartMm + segmentWidthMm
  const firstGuideMm =
    Math.ceil((relativeStartMm + 0.001) / BLANK_GUIDE_INTERVAL_MM) * BLANK_GUIDE_INTERVAL_MM
  const guides: string[] = []
  let guideIndex = 0
  for (
    let guideMm = firstGuideMm;
    guideMm < relativeEndMm - 0.001;
    guideMm += BLANK_GUIDE_INTERVAL_MM
  ) {
    guides.push(
      dashedSeparator(
        BACKGROUND_X_PT + (guideOriginMm + guideMm) * PT_PER_MM,
        y,
        height,
        `${index}_${guideIndex}`
      )
    )
    guideIndex += 1
  }
  return guides.join('')
}

function segmentText(segment: LabelStripSegment): string {
  const directText = [segment.identifier, segment.description].filter(Boolean).join('\n')
  if (directText) return directText
  const preferredParts = segment.bottomParts?.length ? segment.bottomParts : segment.topParts
  return (preferredParts ?? [])
    .map((part) => part.text)
    .filter(Boolean)
    .join('\n')
}

function wrapText(value: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = []
  for (const paragraph of value.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of words) {
      if (word.length > maxChars) {
        if (current) lines.push(current)
        current = ''
        for (let offset = 0; offset < word.length; offset += maxChars) {
          const piece = word.slice(offset, offset + maxChars)
          if (offset + maxChars >= word.length) current = piece
          else lines.push(piece)
        }
        continue
      }
      const next = current ? `${current} ${word}` : word
      if (next.length <= maxChars || !current) current = next
      else {
        lines.push(current)
        current = word
      }
    }
    if (current) lines.push(current)
  }
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  const last = kept[maxLines - 1] ?? ''
  kept[maxLines - 1] = `${last.slice(0, Math.max(1, maxChars - 1))}…`
  return kept
}

function brotherContent(segment: LabelStripSegment): {
  primary: string
  secondary: string
  technical: boolean
} {
  const parts = segment.bottomParts?.length ? segment.bottomParts : segment.topParts
  const technicalPart = parts?.length === 1 && parts[0]?.source === 'technical' ? parts[0] : null
  if (technicalPart?.technicalParts?.length) {
    return {
      primary: '',
      secondary: technicalPart.technicalParts.map((part) => part.text).join('\n'),
      technical: true,
    }
  }

  const primary = parts?.find((part) => part.source === 'label')?.text ?? ''
  const secondary = (parts ?? [])
    .filter((part) => part.source !== 'label')
    // Tape cells hold three lines; longer downstream lists fall back to ranges.
    .map((part) =>
      part.compactText && (primary || part.text.split('\n').length > 3)
        ? part.compactText
        : part.text
    )
    .filter(Boolean)
    .join('\n')
  if (primary || secondary) return { primary, secondary, technical: false }

  return { primary: '', secondary: segmentText(segment), technical: false }
}

function brotherPrimaryFontSize(tapeWidthMm: BrotherTapeWidthMm, combined: boolean): number {
  const progress = (tapeWidthMm - 12) / 24
  return combined ? 10 + progress * 7 : 11 + progress * 9
}

function brotherTextObjects(
  segment: LabelStripSegment,
  x: number,
  y: number,
  width: number,
  height: number,
  index: number,
  tapeWidthMm: BrotherTapeWidthMm,
  images: LbxImageSink
): string {
  if (segment.mainRole) {
    const bandHeight = mainBandHeightPt(height)
    const fileName = images.invertedBand(segment.mainRole, width, bandHeight)
    const band = fileName
      ? imageObject(x, y, width, bandHeight, fileName, index)
      : textObject(x, y, width, bandHeight, segment.mainRole, index + 2000, {
          fontSizePt: 6,
          weight: 700,
          clipFrame: true,
        })
    return `${band}${brotherTextObjects(
      { ...segment, mainRole: undefined },
      x,
      y + bandHeight,
      width,
      height - bandHeight,
      index,
      tapeWidthMm,
      images
    )}`
  }
  const content = brotherContent(segment)
  if (content.primary) {
    const hasSecondary = Boolean(content.secondary)
    const primaryFontSize = brotherPrimaryFontSize(tapeWidthMm, hasSecondary)
    if (!hasSecondary) {
      return textObject(x, y, width, height, content.primary, index, {
        fontSizePt: primaryFontSize,
        weight: 700,
        clipFrame: true,
      })
    }

    const labelHeight = Math.min(height * 0.48, Math.max(18, primaryFontSize * 2.3))
    const noteHeight = Math.max(1, height - labelHeight)
    const noteFontSize = 7
    const noteLines = content.secondary
      ? wrapText(content.secondary, Math.max(3, Math.floor(width / (noteFontSize * 0.55))), 3)
      : []
    return [
      textObject(x, y, width, labelHeight, content.primary, index, {
        fontSizePt: primaryFontSize,
        weight: 700,
        clipFrame: true,
      }),
      noteLines.length > 0
        ? textObject(x, y + labelHeight, width, noteHeight, noteLines.join('\n'), index + 1000, {
            fontSizePt: noteFontSize,
            clipFrame: true,
          })
        : '',
    ].join('')
  }

  const fontSize = content.technical ? 7.5 : 8
  const lines = wrapText(content.secondary, Math.max(3, Math.floor(width / (fontSize * 0.55))), 3)
  return textObject(x, y, width, height, lines.join('\n'), index, {
    fontSizePt: fontSize,
    clipFrame: true,
  })
}

function effectiveTapeWidth(options: LabelStripExportOptions): BrotherTapeWidthMm {
  const printer = options.brotherPrinter ?? 'pt-p900-family'
  const requested = options.brotherTapeWidthMm
  const widths = getBrotherTapeWidthsMm(printer)
  if (requested !== undefined && widths.includes(requested)) return requested
  return getDefaultBrotherTapeWidthMm(printer)
}

function effectiveBrotherPrinter(options: LabelStripExportOptions): BrotherPrinter {
  return options.brotherPrinter ?? 'pt-p900-family'
}

function effectiveMode(options: LabelStripExportOptions): BrotherLbxMode {
  return options.brotherMode ?? getDefaultBrotherLbxMode(effectiveBrotherPrinter(options))
}

interface BrotherStripPack {
  strips: LabelStrip[]
  header: string
}

type BrotherSegment = LabelStripSegment & { guideOriginMm?: number }

function stripWidthMm(strip: LabelStrip): number {
  return strip.segments.reduce((total, segment) => total + Math.max(1, segment.widthMm), 0)
}

function stripForSide(strip: LabelStrip, side: 'top' | 'bottom', double: boolean): LabelStrip {
  return {
    ...strip,
    segments: strip.segments.map((segment) => ({
      ...segment,
      identifier: side === 'top' ? segment.identifier : '',
      description: side === 'bottom' ? segment.description : '',
      topParts: side === 'top' ? segment.topParts : undefined,
      bottomParts: side === 'bottom' ? segment.bottomParts : undefined,
      mainRole:
        !double || (segment.mainSide ?? 'bottom') === side ? segment.mainRole : undefined,
    })),
  }
}

function physicalStripUnits(
  strips: LabelStrip[],
  options: LabelStripExportOptions
): LabelStrip[][] {
  return strips.map((strip) =>
    options.stripMode === 'double'
      ? [stripForSide(strip, 'top', true), stripForSide(strip, 'bottom', true)]
      : [stripForSide(strip, 'bottom', false)]
  )
}

function packWidthMm(strips: LabelStrip[]): number {
  if (strips.length === 0) return PACK_HEADER_WIDTH_MM + CUT_SPACER_MM
  return (
    PACK_HEADER_WIDTH_MM +
    CUT_SPACER_MM +
    strips.reduce((total, strip, index) => total + stripWidthMm(strip) + (index > 0 ? CUT_SPACER_MM : 0), 0)
  )
}

function rowRange(strips: LabelStrip[]): string {
  const rows = [...new Set(strips.map((strip) => strip.row + 1))].sort((left, right) => left - right)
  if (rows.length === 0) return 'unknown'
  if (rows.length === 1) return String(rows[0])
  const contiguous = rows.every((row, index) => index === 0 || row === rows[index - 1]! + 1)
  return contiguous ? `${rows[0]}-to-${rows.at(-1)}` : rows.join('-')
}

function headerForPack(strips: LabelStrip[]): string {
  const cabinets = [...new Set(strips.map((strip) => strip.sourceLabel).filter(Boolean))]
  const cabinetText =
    cabinets.length === 1
      ? cabinets[0]
      : cabinets.length <= 3
        ? cabinets.join(', ')
        : `${cabinets.slice(0, 2).join(', ')} + ${cabinets.length - 2} more`
  return `Cabinet: ${cabinetText || 'Unknown'}\nRows: ${rowRange(strips)}`
}

function packLabelStrips(
  strips: LabelStrip[],
  options: LabelStripExportOptions
): BrotherStripPack[] {
  const packs: BrotherStripPack[] = []
  let currentUnits: LabelStrip[][] = []
  for (const strip of strips) {
    const unit = physicalStripUnits([strip], options)[0]!
    const candidateUnits = [...currentUnits, unit]
    const candidateStrips = candidateUnits.flat()
    const profile = BROTHER_PROFILES[effectiveBrotherPrinter(options)]
    if (currentUnits.length > 0 && packWidthMm(candidateStrips) > profile.maxPackedLengthMm) {
      const current = currentUnits.flat()
      packs.push({ strips: current, header: headerForPack(current) })
      currentUnits = [unit]
    } else {
      currentUnits = candidateUnits
    }
  }
  if (currentUnits.length > 0) {
    const current = currentUnits.flat()
    packs.push({ strips: current, header: headerForPack(current) })
  }
  return packs
}

function combinedStrip(strips: LabelStrip[], header: string): LabelStrip {
  const segments: BrotherSegment[] = [
    { identifier: header, description: '', widthMm: PACK_HEADER_WIDTH_MM },
    { identifier: '', description: '', widthMm: CUT_SPACER_MM, blank: true, cutSpacer: true },
  ]
  let cursorMm = PACK_HEADER_WIDTH_MM + CUT_SPACER_MM
  for (const [stripIndex, strip] of strips.entries()) {
    const guideOriginMm = cursorMm
    segments.push(...strip.segments.map((segment) => ({ ...segment, guideOriginMm })))
    cursorMm += stripWidthMm(strip)
    if (stripIndex < strips.length - 1) {
      segments.push({
        identifier: '',
        description: '',
        widthMm: CUT_SPACER_MM,
        blank: true,
        cutSpacer: true,
      })
      cursorMm += CUT_SPACER_MM
    }
  }
  return {
    sourceLabel: 'Brother continuous strip',
    row: 0,
    segments,
  }
}

function stripsForBrotherMode(strips: LabelStrip[], options: LabelStripExportOptions): LabelStrip[] {
  if (effectiveMode(options) !== 'single-strip') return physicalStripUnits(strips, options).flat()
  return packLabelStrips(strips, options).map((pack) => combinedStrip(pack.strips, pack.header))
}

function sheetXml(
  strip: LabelStrip,
  sheetIndex: number,
  printerName: string,
  printerId: string,
  tapeWidthMm: BrotherTapeWidthMm,
  images: LbxImageSink
) {
  const contentLengthMm = Math.max(1, strip.segments.reduce((total, segment) => total + Math.max(1, segment.widthMm), 0))
  const backgroundHeightPt = backgroundHeightForTape(tapeWidthMm)
  const objects: string[] = []
  let cursor = 0

  strip.segments.forEach((segment, index) => {
    const brotherSegment = segment as BrotherSegment
    const width = Math.max(1, segment.widthMm) * PT_PER_MM
    const segmentStartMm = cursor / PT_PER_MM
    if (segment.cutSpacer) {
      const symbolWidth = Math.min(width - 2, 16)
      const symbolHeight = Math.min(backgroundHeightPt - 2, 16)
      objects.push(scissorSymbol(
        BACKGROUND_X_PT + cursor + (width - symbolWidth) / 2,
        BACKGROUND_Y_PT + (backgroundHeightPt - symbolHeight) / 2,
        symbolWidth,
        symbolHeight,
        index + 1
      ))
    } else {
      const isOuter = index === 0 || index === strip.segments.length - 1
      const inset = isOuter ? Math.min(OUTER_TEXT_INSET_PT, Math.max(0, width / 2 - 1)) : 0
      objects.push(brotherTextObjects(
        segment,
        BACKGROUND_X_PT + cursor + inset,
        BACKGROUND_Y_PT,
        Math.max(1, width - inset * 2),
        backgroundHeightPt,
        index + 1,
        tapeWidthMm,
        images
      ))
    }
    if (segment.blank && !segment.cutSpacer) {
      objects.push(
        blankGuideSeparators(
          segmentStartMm,
          Math.max(1, segment.widthMm),
          BACKGROUND_Y_PT,
          backgroundHeightPt,
          index + 1,
          brotherSegment.guideOriginMm
        )
      )
    }
    cursor += width
    if (index < strip.segments.length - 1) objects.push(dashedSeparator(BACKGROUND_X_PT + cursor, BACKGROUND_Y_PT, backgroundHeightPt, index + 1))
  })

  return sheetEnvelope(sheetIndex, printerName, printerId, tapeWidthMm, contentLengthMm, objects)
}

function backgroundHeightForTape(tapeWidthMm: BrotherTapeWidthMm): number {
  return tapeWidthMm * PT_PER_MM + 0.1764 - 4.4
}

function sheetEnvelope(
  sheetIndex: number,
  printerName: string,
  printerId: string,
  tapeWidthMm: BrotherTapeWidthMm,
  contentLengthMm: number,
  objects: string[]
): string {
  const tapeWidthPt = tapeWidthMm * PT_PER_MM + 0.1764
  const backgroundWidthPt = contentLengthMm * PT_PER_MM
  const paperLengthPt = backgroundWidthPt + PROFILE_FEED_PT
  const backgroundHeightPt = backgroundHeightForTape(tapeWidthMm)
  const sheetName = `Sheet ${sheetIndex + 1}`
  return `<style:sheet name="${sheetName}"><style:paper media="0" width="${pt(tapeWidthPt)}" height="${pt(paperLengthPt)}" marginLeft="${pt(PAPER_MARGIN_X_PT)}" marginTop="${pt(PAPER_MARGIN_Y_PT)}" marginRight="${pt(PAPER_MARGIN_X_PT)}" marginBottom="${pt(PAPER_MARGIN_Y_PT)}" orientation="landscape" autoLength="false" monochromeDisplay="true" printColorDisplay="false" printColorsID="0" paperColor="#FFFFFF" paperInk="#000000" split="1" format="${PAPER_FORMAT}" backgroundTheme="0" printerID="${printerId}" printerName="${printerName}"/><style:cutLine regularCut="0pt" freeCut=""/><style:backGround x="${pt(BACKGROUND_X_PT)}" y="${pt(BACKGROUND_Y_PT)}" width="${pt(backgroundWidthPt)}" height="${pt(backgroundHeightPt)}" brushStyle="NULL" brushId="0" userPattern="NONE" userPatternId="0" color="#000000" printColorNumber="1" backColor="#FFFFFF" backPrintColorNumber="0"/><pt:objects>${objects.join('')}</pt:objects></style:sheet>`
}

const BOARD_LABEL_LENGTH_MM = 90
const BOARD_HERO_WIDTH_MM = 26

/** A cabinet identification label: board number, then name, feed and supply lines. */
function boardSheetXml(
  board: BoardLabel,
  sheetIndex: number,
  printerName: string,
  printerId: string,
  tapeWidthMm: BrotherTapeWidthMm
): string {
  const height = backgroundHeightForTape(tapeWidthMm)
  const progress = (tapeWidthMm - 12) / 24
  const objects: string[] = []
  const heroWidth = board.code ? BOARD_HERO_WIDTH_MM * PT_PER_MM : 0
  const index = 1
  if (board.code) {
    objects.push(
      textObject(BACKGROUND_X_PT + 4, BACKGROUND_Y_PT, heroWidth - 8, height, board.code, index, {
        fontSizePt: 18 + progress * 18,
        weight: 700,
        clipFrame: true,
      }),
      polyLine(BACKGROUND_X_PT + heroWidth, BACKGROUND_Y_PT + height * 0.15, height * 0.7, 'Divider')
    )
  }
  const columnX = BACKGROUND_X_PT + heroWidth + 6
  const columnWidth = BOARD_LABEL_LENGTH_MM * PT_PER_MM - heroWidth - 12
  const titleHeight = height * (board.lines.length > 0 ? 0.42 : 1)
  objects.push(
    textObject(columnX, BACKGROUND_Y_PT, columnWidth, titleHeight, board.name, index + 1, {
      fontSizePt: (board.code ? 10 : 13) + progress * 8,
      weight: 700,
      clipFrame: true,
      align: 'LEFT',
    })
  )
  if (board.lines.length > 0) {
    objects.push(
      textObject(
        columnX,
        BACKGROUND_Y_PT + titleHeight,
        columnWidth,
        height - titleHeight,
        board.lines.join('\n'),
        index + 2,
        { fontSizePt: 6.5 + progress * 3, clipFrame: true, align: 'LEFT' }
      )
    )
  }
  return sheetEnvelope(sheetIndex, printerName, printerId, tapeWidthMm, BOARD_LABEL_LENGTH_MM, objects)
}

function labelXml(
  strips: LabelStrip[],
  profile: (typeof BROTHER_PROFILES)[keyof typeof BROTHER_PROFILES],
  tapeWidthMm: BrotherTapeWidthMm,
  images: LbxImageSink,
  boards: BoardLabel[] = []
): string {
  const sheets = [
    ...strips.map((strip, index) =>
      sheetXml(strip, index, profile.printerName, profile.printerId, tapeWidthMm, images)
    ),
    ...boards.map((board, index) =>
      boardSheetXml(board, strips.length + index, profile.printerName, profile.printerId, tapeWidthMm)
    ),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?><pt:document xmlns:pt="${PT_NS}" xmlns:style="${STYLE_NS}" xmlns:text="${TEXT_NS}" xmlns:draw="${DRAW_NS}" xmlns:image="http://schemas.brother.info/ptouch/2007/lbx/image" xmlns:barcode="http://schemas.brother.info/ptouch/2007/lbx/barcode" xmlns:database="http://schemas.brother.info/ptouch/2007/lbx/database" xmlns:table="http://schemas.brother.info/ptouch/2007/lbx/table" xmlns:cable="http://schemas.brother.info/ptouch/2007/lbx/cable" version="1.7" generator="Condui browser exporter"><pt:body currentSheet="Sheet 1" direction="LTR">${sheets.join('')}</pt:body></pt:document>`
}

function propertiesXml(strips: LabelStrip[], boards: BoardLabel[] = []): string {
  const textValues = strips.flatMap((strip) => strip.segments.filter((segment) => !segment.cutSpacer).map(segmentText))
  const text = textValues.join('')
  const wordCount = textValues.reduce((total, value) => total + value.split(/\s+/).filter(Boolean).length, 0)
  return `<?xml version="1.0" encoding="UTF-8"?><meta:properties xmlns:meta="http://schemas.brother.info/ptouch/2007/lbx/meta" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><meta:appName>com.brother.PtouchEditor</meta:appName><dc:title>Condui cabinet labels</dc:title><dc:subject>DIN cabinet labels</dc:subject><dc:creator>Condui</dc:creator><meta:keyword>cabinet labels</meta:keyword><dc:description>Brother continuous label export</dc:description><meta:template></meta:template><meta:numPages>${strips.length + boards.length}</meta:numPages><meta:numWords>${wordCount}</meta:numWords><meta:numChars>${Array.from(text).length}</meta:numChars><meta:security>0</meta:security><meta:transferScript></meta:transferScript></meta:properties>`
}

function previewScissors(x: number, y: number, size: number): string {
  const r = size * 0.13
  const leftX = x + size * 0.22
  const rightX = x + size * 0.78
  const centerY = y + size * 0.5
  return `<g stroke="#374151" stroke-width="0.45" fill="none"><circle cx="${leftX.toFixed(2)}" cy="${(y + size * 0.27).toFixed(2)}" r="${r.toFixed(2)}"/><circle cx="${rightX.toFixed(2)}" cy="${(y + size * 0.73).toFixed(2)}" r="${r.toFixed(2)}"/><path d="M${(leftX + r).toFixed(2)} ${(y + size * 0.31).toFixed(2)} L${(x + size * 0.7).toFixed(2)} ${centerY.toFixed(2)} L${(rightX - r).toFixed(2)} ${(y + size * 0.69).toFixed(2)} M${(leftX + r).toFixed(2)} ${(y + size * 0.69).toFixed(2)} L${(x + size * 0.7).toFixed(2)} ${centerY.toFixed(2)} L${(rightX - r).toFixed(2)} ${(y + size * 0.31).toFixed(2)}"/></g>`
}

function previewText(
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { bold?: boolean; fontSize?: number; maxLines?: number } = {}
): string {
  const fontSize = options.fontSize ?? Math.max(2.2, Math.min(4.2, height * 0.19))
  const lines = wrapText(
    value,
    Math.max(3, Math.floor(width / (fontSize * 0.62))),
    options.maxLines ?? 3
  ).filter(Boolean)
  if (lines.length === 0) return ''
  const lineHeight = fontSize * 1.15
  const firstY = y + height / 2 - ((lines.length - 1) * lineHeight) / 2 + fontSize * 0.35
  return lines.map((line, index) => `<text x="${(x + width / 2).toFixed(2)}" y="${(firstY + index * lineHeight).toFixed(2)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize.toFixed(2)}" font-weight="${options.bold ? '700' : '400'}" fill="#111827">${escapeXml(line)}</text>`).join('')
}

function previewPrimaryFontSize(tapeWidthMm: number, combined: boolean): number {
  const progress = Math.max(0, Math.min(1, (tapeWidthMm - 12) / 24))
  return combined ? 3 + progress * 2.3 : 3.5 + progress * 2.7
}

function previewSegmentText(segment: LabelStripSegment, x: number, y: number, width: number, height: number): string {
  if (segment.mainRole) {
    const bandHeight = mainBandHeightPt(height * PT_PER_MM) / PT_PER_MM
    const fontSize = Math.min(bandHeight * 0.62, (width * 0.92) / (segment.mainRole.length * 0.74))
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${width.toFixed(2)}" height="${bandHeight.toFixed(2)}" fill="#111827"/><text x="${(x + width / 2).toFixed(2)}" y="${(y + bandHeight / 2 + fontSize * 0.36).toFixed(2)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize.toFixed(2)}" font-weight="700" fill="#ffffff">${escapeXml(segment.mainRole)}</text>${previewSegmentText({ ...segment, mainRole: undefined }, x, y + bandHeight, width, height - bandHeight)}`
  }
  const content = brotherContent(segment)
  if (!content.primary) {
    return previewText(content.secondary, x, y, width, height, {
      fontSize: content.technical ? Math.max(1.4, Math.min(3.2, height * 0.18)) : undefined,
      maxLines: 3,
    })
  }

  const hasSecondary = Boolean(content.secondary)
  if (!hasSecondary) {
    return previewText(content.primary, x, y, width, height, {
      bold: true,
      fontSize: previewPrimaryFontSize(height, false),
      maxLines: 1,
    })
  }

  const labelHeight = Math.min(height * 0.46, 14)
  const noteHeight = Math.max(1, height - labelHeight)
  return `${previewText(content.primary, x, y, width, labelHeight, {
    bold: true,
    fontSize: previewPrimaryFontSize(height, true),
    maxLines: 1,
  })}${previewText(content.secondary, x, y + labelHeight, width, noteHeight, {
    fontSize: Math.max(1.2, Math.min(3.2, noteHeight * 0.2)),
    maxLines: 3,
  })}`
}

function previewStrip(strip: LabelStrip, y: number, tapeWidthMm: number): { markup: string; width: number } {
  const totalWidth = Math.max(12, strip.segments.reduce((sum, segment) => sum + Math.max(1, segment.widthMm), 0))
  let cursor = 0
  let markup = `<rect x="0" y="${y.toFixed(2)}" width="${totalWidth.toFixed(2)}" height="${tapeWidthMm.toFixed(2)}" rx="0.8" fill="#fff" stroke="#9ca3af" stroke-width="0.35"/>`
  for (const [index, segment] of strip.segments.entries()) {
    const brotherSegment = segment as BrotherSegment
    const width = Math.max(1, segment.widthMm)
    if (segment.cutSpacer) markup += previewScissors(cursor + width * 0.2, y + tapeWidthMm * 0.2, Math.min(width * 0.6, tapeWidthMm * 0.6))
    else markup += previewSegmentText(segment, cursor + 0.5, y, Math.max(1, width - 1), tapeWidthMm)
    if (segment.blank && !segment.cutSpacer) {
      const guideOriginMm = brotherSegment.guideOriginMm ?? 0
      const relativeStart = cursor - guideOriginMm
      const relativeEnd = relativeStart + width
      const firstGuide =
        Math.ceil((relativeStart + 0.001) / BLANK_GUIDE_INTERVAL_MM) * BLANK_GUIDE_INTERVAL_MM
      for (let guide = firstGuide; guide < relativeEnd - 0.001; guide += BLANK_GUIDE_INTERVAL_MM) {
        const absoluteGuide = guideOriginMm + guide
        markup += `<line x1="${absoluteGuide.toFixed(2)}" y1="${y.toFixed(2)}" x2="${absoluteGuide.toFixed(2)}" y2="${(y + tapeWidthMm).toFixed(2)}" stroke="#4b5563" stroke-width="0.3" stroke-dasharray="1.2 1.2"/>`
      }
    }
    cursor += width
    if (index < strip.segments.length - 1) markup += `<line x1="${cursor.toFixed(2)}" y1="${y.toFixed(2)}" x2="${cursor.toFixed(2)}" y2="${(y + tapeWidthMm).toFixed(2)}" stroke="#4b5563" stroke-width="0.3" stroke-dasharray="1.2 1.2"/>`
  }
  return { markup, width: totalWidth }
}

function previewBoard(board: BoardLabel, y: number, tapeWidthMm: number): { markup: string; width: number } {
  const heroWidth = board.code ? BOARD_HERO_WIDTH_MM : 0
  const titleHeight = tapeWidthMm * (board.lines.length > 0 ? 0.42 : 1)
  const columnX = heroWidth + 2
  const columnWidth = BOARD_LABEL_LENGTH_MM - heroWidth - 4
  let markup = `<rect x="0" y="${y.toFixed(2)}" width="${BOARD_LABEL_LENGTH_MM}" height="${tapeWidthMm.toFixed(2)}" rx="0.8" fill="#fff" stroke="#9ca3af" stroke-width="0.35"/>`
  if (board.code) {
    markup += previewText(board.code, 1, y, heroWidth - 2, tapeWidthMm, {
      bold: true,
      fontSize: Math.min(tapeWidthMm * 0.5, (heroWidth - 4) / (board.code.length * 0.62)),
      maxLines: 1,
    })
    markup += `<line x1="${heroWidth}" y1="${(y + tapeWidthMm * 0.15).toFixed(2)}" x2="${heroWidth}" y2="${(y + tapeWidthMm * 0.85).toFixed(2)}" stroke="#4b5563" stroke-width="0.3"/>`
  }
  const leftText = (value: string, top: number, height: number, fontSize: number, bold: boolean) =>
    value
      .split('\n')
      .map((line, index, lines) => {
        const lineHeight = fontSize * 1.2
        const firstY = top + height / 2 - ((lines.length - 1) * lineHeight) / 2 + fontSize * 0.35
        return `<text x="${columnX.toFixed(2)}" y="${(firstY + index * lineHeight).toFixed(2)}" font-family="Arial, sans-serif" font-size="${fontSize.toFixed(2)}" font-weight="${bold ? '700' : '400'}" fill="#111827">${escapeXml(line)}</text>`
      })
      .join('')
  markup += leftText(
    board.name,
    y,
    titleHeight,
    Math.min(titleHeight * 0.6, (columnWidth * 0.95) / Math.max(1, board.name.length * 0.62)),
    true
  )
  if (board.lines.length > 0) {
    const linesHeight = tapeWidthMm - titleHeight
    markup += leftText(
      board.lines.join('\n'),
      y + titleHeight,
      linesHeight,
      Math.min((linesHeight * 0.8) / board.lines.length, 3.2),
      false
    )
  }
  return { markup, width: BOARD_LABEL_LENGTH_MM }
}

export function renderBrotherLbxPreviewSvg(project: ProjectWithOptionalV2Electrical, options: LabelStripExportOptions, provider: LabelStripModuleProvider): string {
  const model = buildLabelStripModel(project, options, provider)
  const boards = selectedBoardLabels(project, options)
  if (model.length === 0 && boards.length === 0) throw new Error('No label strips can be generated from the selected modules.')
  const tapeWidthMm = effectiveTapeWidth(options)
  const strips = stripsForBrotherMode(model, options)
  const rowGap = 8
  const rows = [
    ...strips.map((strip, index) => previewStrip(strip, index * (tapeWidthMm + rowGap), tapeWidthMm)),
    ...boards.map((board, index) =>
      previewBoard(board, (strips.length + index) * (tapeWidthMm + rowGap), tapeWidthMm)
    ),
  ]
  const width = Math.max(...rows.map((row) => row.width), 12)
  const height = rows.length * tapeWidthMm + Math.max(0, rows.length - 1) * rowGap
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Brother label preview" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMin meet"><rect width="100%" height="100%" fill="#f3f4f6"/>${rows.map((row) => row.markup).join('')}</svg>`
}

function filenamePart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'unknown'
}

function packFileName(pack: BrotherStripPack, index: number): string {
  const cabinets = [...new Set(pack.strips.map((strip) => strip.sourceLabel).filter(Boolean))]
  const cabinetPart =
    cabinets.length === 1
      ? `cabinet-${filenamePart(cabinets[0]!)}`
      : `cabinets-${filenamePart(cabinets[0] ?? 'unknown')}-and-${Math.max(1, cabinets.length - 1)}-more`
  return `${String(index + 1).padStart(3, '0')}-${cabinetPart}-rows-${rowRange(pack.strips)}.lbx`
}

async function lbxArchiveBytes(
  strip: LabelStrip,
  profile: (typeof BROTHER_PROFILES)[keyof typeof BROTHER_PROFILES],
  tapeWidthMm: BrotherTapeWidthMm
): Promise<Uint8Array> {
  const archive = new JSZip()
  const images = new LbxImageSink()
  archive.file('label.xml', labelXml([strip], profile, tapeWidthMm, images))
  images.addTo(archive)
  archive.file('prop.xml', propertiesXml([strip]))
  return archive.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}

export async function exportLabelStripsToBrotherLbx(project: ProjectWithOptionalV2Electrical, options: LabelStripExportOptions, provider: LabelStripModuleProvider): Promise<Blob> {
  const model = buildLabelStripModel(project, options, provider)
  const boards = selectedBoardLabels(project, options)
  if (model.length === 0 && boards.length === 0) throw new Error('No label strips can be generated from the selected modules.')
  const profile = BROTHER_PROFILES[options.brotherPrinter ?? 'pt-p900-family']
  const strips = stripsForBrotherMode(model, options)
  if (effectiveMode(options) === 'single-strip') {
    const packs = model.length > 0 ? packLabelStrips(model, options) : []
    const bundle = new JSZip()
    for (const [index, pack] of packs.entries()) {
      const strip = combinedStrip(pack.strips, pack.header)
      bundle.file(packFileName(pack, index), await lbxArchiveBytes(strip, profile, effectiveTapeWidth(options)))
    }
    if (boards.length > 0) {
      const archive = new JSZip()
      archive.file('label.xml', labelXml([], profile, effectiveTapeWidth(options), new LbxImageSink(), boards))
      archive.file('prop.xml', propertiesXml([], boards))
      bundle.file(
        `${String(packs.length + 1).padStart(3, '0')}-board-labels.lbx`,
        await archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
      )
    }
    return bundle.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })
  }
  const zip = new JSZip()
  const images = new LbxImageSink()
  zip.file('label.xml', labelXml(strips, profile, effectiveTapeWidth(options), images, boards))
  images.addTo(zip)
  zip.file('prop.xml', propertiesXml(strips, boards))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export const BROTHER_LBX_TAPE_WIDTH_MM = 36
export const BROTHER_LBX_CUT_SPACER_MM = CUT_SPACER_MM
