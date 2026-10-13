import { trackCrashReport } from '@/lib/analytics/diagnosticsAnalytics'
import { getClientLogForCrashReport } from '@/lib/crashReporting/clientLogBuffer'
import type { ReportCrashInput } from '@/lib/crashReporting/crashReportTypes'
import { submitCrashReportNetlifyForm } from '@/lib/crashReporting/submitCrashNetlifyForm'

export type { CrashErrorType, ReportCrashInput } from '@/lib/crashReporting/crashReportTypes'

const DEDUPE_MS = 30_000
const RATE_WINDOW_MS = 60_000
const MAX_REPORTS_PER_WINDOW = 30

const lastFingerprintAt = new Map<string, number>()
const reportTimestamps: number[] = []

function normalizeForFingerprint(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, 240)
}

function fingerprint(input: ReportCrashInput): string {
  const stackLine = (input.stack ?? '').split('\n')[0]?.trim() ?? ''
  return `${input.errorType}|${normalizeForFingerprint(input.message)}|${stackLine.slice(0, 120)}`
}

function allowSend(fp: string): boolean {
  const now = Date.now()
  while (reportTimestamps.length > 0 && now - reportTimestamps[0]! > RATE_WINDOW_MS) {
    reportTimestamps.shift()
  }
  if (reportTimestamps.length >= MAX_REPORTS_PER_WINDOW) return false

  const last = lastFingerprintAt.get(fp)
  if (last !== undefined && now - last < DEDUPE_MS) return false

  lastFingerprintAt.set(fp, now)
  reportTimestamps.push(now)

  if (lastFingerprintAt.size > 200) {
    const cutoff = now - DEDUPE_MS * 2
    for (const [k, t] of lastFingerprintAt) {
      if (t < cutoff) lastFingerprintAt.delete(k)
    }
  }
  return true
}

function buildPayload(crashId: string, input: ReportCrashInput) {
  const clientLog = getClientLogForCrashReport().slice(-50)
  return {
    crashId,
    errorType: input.errorType,
    message: input.message.slice(0, 4000),
    stack: input.stack?.slice(0, 60_000),
    resourceUrl: input.resourceUrl?.slice(0, 2000),
    url: typeof window !== 'undefined' ? String(window.location?.href ?? '').slice(0, 4000) : '',
    timestamp: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? String(navigator.userAgent ?? '').slice(0, 2000) : '',
    appVersion: typeof import.meta.env !== 'undefined' ? String(import.meta.env.VITE_APP_BUILD_COMMIT ?? '') : '',
    clientLog,
  }
}

/**
 * Sends a crash report via Netlify Forms (same pipeline as support contact). Never throws.
 * @returns crash id when a send was attempted, otherwise undefined
 */
export function reportCrash(input: ReportCrashInput): string | undefined {
  try {
    if (import.meta.env.VITE_E2E === '1') return undefined

    const fp = fingerprint(input)
    if (!allowSend(fp)) return undefined

    const crashId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `crash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

    const payload = buildPayload(crashId, input)
    void submitCrashReportNetlifyForm(crashId, input, payload).catch(() => {})

    trackCrashReport({
      errorType: input.errorType,
      hasStack: Boolean(input.stack?.trim()),
    })

    return crashId
  } catch {
    return undefined
  }
}

/** Clears dedupe and rate-limit state (Vitest only). */
export function resetCrashReportingStateForTests(): void {
  lastFingerprintAt.clear()
  reportTimestamps.length = 0
}
