import { logger } from '@/lib/logger'

export const LONG_PRESS_DELAY_MS = 450

export const LONG_PRESS_FILL_MS = 300

export const LONG_PRESS_READY_MS = LONG_PRESS_DELAY_MS + LONG_PRESS_FILL_MS

export const DOUBLE_TAP_MS = 350

export const DOUBLE_TAP_SLOP_PX = 32

export const debugTouchLog =
  process.env.NODE_ENV !== 'production'
    ? (...args: unknown[]) => {
        if (typeof window === 'undefined') return
        if (window.localStorage.getItem('eendraTouchDebug') !== '1') return
        logger.debug('[BaseCanvas touch]', ...args)
      }
    : (..._args: unknown[]) => {}


export const DEFERRED_MOUSE_PAN_THRESHOLD_PX = 6
