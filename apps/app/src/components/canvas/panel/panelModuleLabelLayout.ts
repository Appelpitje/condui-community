const MAX_LABEL_FONT_SIZE = 10
const MIN_LABEL_FONT_SIZE = 6

/** Keep short module identifiers legible without changing the physical module width. */
export function getPanelModuleLabelFontSize(
  text: string,
  width: number,
  height: number,
  measureText: (text: string, fontSize: number) => number,
): number {
  const lines = text.split(/\r\n?|\n/)
  for (let size = MAX_LABEL_FONT_SIZE; size >= MIN_LABEL_FONT_SIZE; size -= 0.5) {
    if (lines.length * size <= height && lines.every((line) => measureText(line, size) <= width)) {
      return size
    }
  }
  // Long descriptions retain the existing ellipsis rather than becoming unreadably small.
  return MIN_LABEL_FONT_SIZE
}
