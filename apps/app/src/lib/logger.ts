/** Guarded so the logger also loads outside Vite (plain Node scripts, headless commands). */
export const IS_DEV = import.meta.env?.DEV === true

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogSink = (level: LogLevel, args: unknown[]) => void

function isDebugEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem('condui_debug') != null
  } catch {
    return false
  }
}

const consoleSink: LogSink = (level, args) => {
  if (level === 'error') {
    console.error(...args)
    return
  }

  if (!IS_DEV && !isDebugEnabled()) return

  if (level === 'debug') {
    console.debug(...args)
    return
  }

  if (level === 'warn') {
    console.warn(...args)
    return
  }

  console.info(...args)
}

let sink: LogSink = consoleSink

export function setLogSink(nextSink: LogSink): void {
  sink = nextSink
}

export function resetLogSink(): void {
  sink = consoleSink
}

function write(level: LogLevel, args: unknown[]): void {
  sink(level, args)
}

export const logger = {
  debug: (...args: unknown[]) => write('debug', args),
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args),
}
