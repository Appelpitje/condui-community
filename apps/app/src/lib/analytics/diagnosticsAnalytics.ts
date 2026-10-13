import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import type { CrashErrorType } from '@/lib/crashReporting/crashReportTypes'
import { getDetectedOrphans } from '@/lib/validation/orphanDetection'
import {
  queryQuarantinedItems,
  type ValidationProject,
} from '@/lib/projectV2/validation'

type OrphanAnalyticsProject = Parameters<typeof getDetectedOrphans>[0] &
  ValidationProject & {
  project: {
    id: string
  }
}

const ORPHAN_GA_DETECTED_PREFIX = 'eendra-orphan-ga-detected:'
const memoryOrphanGaDetected = new Set<string>()

function orphanGaSessionKey(projectId: string): string {
  return `${ORPHAN_GA_DETECTED_PREFIX}${projectId}`
}

function alreadyTrackedOrphanDetected(projectId: string): boolean {
  try {
    return sessionStorage.getItem(orphanGaSessionKey(projectId)) === '1'
  } catch {
    return memoryOrphanGaDetected.has(projectId)
  }
}

function markOrphanDetectedTracked(projectId: string): void {
  try {
    sessionStorage.setItem(orphanGaSessionKey(projectId), '1')
  } catch {
    memoryOrphanGaDetected.add(projectId)
  }
}

function orphanCountsFromProject(project: OrphanAnalyticsProject) {
  const detected = getDetectedOrphans(project)
  const quarantined = queryQuarantinedItems(project)
  const reasons = new Set([
    ...detected.map((d) => d.reason),
    ...quarantined.map((q) => q.reason),
  ])
  return {
    detectedCount: detected.length,
    quarantinedCount: quarantined.length,
    reasonCount: reasons.size,
  }
}

export function trackCrashReport(options: { errorType: CrashErrorType; hasStack: boolean }) {
  trackGoogleAnalyticsEvent('crash_report', {
    error_type: options.errorType,
    has_stack: options.hasStack,
  })
}

/** Once per browser tab session per project when orphans or quarantined items are present. */
export function trackOrphanDetectedOncePerSession(project: OrphanAnalyticsProject) {
  const projectId = project.project.id
  if (alreadyTrackedOrphanDetected(projectId)) return

  const { detectedCount, quarantinedCount, reasonCount } = orphanCountsFromProject(project)
  if (detectedCount === 0 && quarantinedCount === 0) return

  markOrphanDetectedTracked(projectId)
  trackGoogleAnalyticsEvent('orphan_detected', {
    detected_count: detectedCount,
    quarantined_count: quarantinedCount,
    reason_count: reasonCount,
  })
}

export function trackOrphanAutoReport(options: {
  detectedCount: number
  quarantinedCount: number
  success: boolean
}) {
  trackGoogleAnalyticsEvent(
    options.success ? 'orphan_auto_report' : 'orphan_auto_report_failed',
    {
      detected_count: options.detectedCount,
      quarantined_count: options.quarantinedCount,
    },
  )
}

export function resetOrphanDetectedAnalyticsForTests(): void {
  memoryOrphanGaDetected.clear()
  if (typeof sessionStorage === 'undefined') return
  const keys: string[] = []
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i)
    if (key?.startsWith(ORPHAN_GA_DETECTED_PREFIX)) keys.push(key)
  }
  for (const key of keys) sessionStorage.removeItem(key)
}
