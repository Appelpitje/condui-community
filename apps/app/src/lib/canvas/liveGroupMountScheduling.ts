import { KonvaRenderer } from 'react-konva'

const pendingChecks = new Set<() => void>()
let scheduled = false

/** Batch live-camera membership changes before Konva's next animation-frame paint. */
export function scheduleLiveGroupMountCheck(check: () => void): void {
  pendingChecks.add(check)
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    const checks = [...pendingChecks]
    pendingChecks.clear()
    KonvaRenderer.flushSyncFromReconciler(() => checks.forEach((run) => run()))
  })
}

export function cancelLiveGroupMountCheck(check: () => void): void {
  pendingChecks.delete(check)
}
