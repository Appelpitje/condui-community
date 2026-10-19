import { KonvaRenderer } from 'react-konva'

type Queue = { tasks: Map<() => void, number>; frame: number | null }
const queues = new WeakMap<Window, Queue>()

/** Build nearby rich artwork in small frames instead of stopping the camera at a detail threshold. */
export function scheduleLiveGroupDetail(window: Window, task: () => void, priority: number): void {
  let queue = queues.get(window)
  if (!queue) {
    queue = { tasks: new Map(), frame: null }
    queues.set(window, queue)
  }
  queue.tasks.set(task, priority)
  if (queue.frame != null) return
  const current = queue
  const run = () => {
    current.frame = null
    const started = performance.now()
    const tasks = [...current.tasks].sort((a, b) => a[1] - b[1])
    for (const [task] of tasks) {
      if (!current.tasks.delete(task)) continue
      KonvaRenderer.flushSyncFromReconciler(task)
      if (performance.now() - started >= 8) break
    }
    if (current.tasks.size && current.frame == null)
      current.frame = window.requestAnimationFrame(run)
  }
  queue.frame = window.requestAnimationFrame(run)
}

export function cancelLiveGroupDetail(window: Window, task: () => void): void {
  const queue = queues.get(window)
  if (!queue) return
  queue.tasks.delete(task)
  if (!queue.tasks.size && queue.frame != null) {
    window.cancelAnimationFrame(queue.frame)
    queue.frame = null
  }
}

export function pendingLiveGroupDetails(window: Window): number {
  return queues.get(window)?.tasks.size ?? 0
}

export function liveGroupDetailPriority(
  stage: {
    width(): number
    height(): number
    getPointerPosition(): { x: number; y: number } | null
  },
  first: { x: number; y: number },
  last: { x: number; y: number }
): number {
  const focus = stage.getPointerPosition() ?? { x: stage.width() / 2, y: stage.height() / 2 }
  const x = Math.max(Math.min(first.x, last.x) - focus.x, 0, focus.x - Math.max(first.x, last.x))
  const y = Math.max(Math.min(first.y, last.y) - focus.y, 0, focus.y - Math.max(first.y, last.y))
  return x * x + y * y
}
