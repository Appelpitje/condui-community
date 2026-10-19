/** Occupied intervals on one panel row, in integer twelfth-module grid units. */
export class PanelGridRowOccupancy {
  private readonly intervals: Array<{ start: number; end: number }> = []

  reserve(start: number, width: number): void {
    let end = start + width
    let index = 0
    while (index < this.intervals.length && this.intervals[index]!.end < start) index++
    const first = index
    while (index < this.intervals.length && this.intervals[index]!.start <= end) {
      start = Math.min(start, this.intervals[index]!.start)
      end = Math.max(end, this.intervals[index]!.end)
      index++
    }
    this.intervals.splice(first, index - first, { start, end })
  }

  /** First free start at or after start, including maxStart (also used by overflow). */
  findFree(start: number, width: number, maxStart: number): number | null {
    if (start > maxStart) return null
    for (const interval of this.intervals) {
      if (interval.end <= start) continue
      if (interval.start >= start + width) return start
      start = interval.end
      if (start > maxStart) return null
    }
    return start
  }
}
