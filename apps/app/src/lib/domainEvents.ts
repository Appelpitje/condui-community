import { current, isDraft } from 'immer'
import { logger } from '@/lib/logger'
import type { OffGridSupplyAssembly } from '@/types/supplyAssembly'

/**
 * Facts domain code reports while it changes a project, for side effects such as analytics
 * that domain code must not import. Outside a project command they are delivered at once;
 * inside one they are buffered and delivered only after the command commits (ADR 0003).
 */
export type DomainEvent = {
  type: 'supplyAssemblyCreated' | 'supplyAssemblyReplaced'
  assembly: OffGridSupplyAssembly
  source: string
}

type Listener = (event: DomainEvent) => void

const listeners = new Set<Listener>()
let buffer: DomainEvent[] | null = null

/** Draft payloads are snapshotted: drafts are revoked once their transaction ends. */
function snapshot(event: DomainEvent): DomainEvent {
  return isDraft(event.assembly) ? { ...event, assembly: current(event.assembly) } : event
}

export function emitDomainEvent(event: DomainEvent): void {
  if (buffer) buffer.push(snapshot(event))
  else publishDomainEvents([event])
}

export function onDomainEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Runs `fn` and returns the events it emitted instead of delivering them. */
export function collectDomainEvents<T>(fn: () => T): { result: T; events: DomainEvent[] } {
  const previous = buffer
  const events: DomainEvent[] = []
  buffer = events
  try {
    return { result: fn(), events }
  } finally {
    buffer = previous
  }
}

export function publishDomainEvents(events: readonly DomainEvent[]): void {
  for (const event of events) {
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch (error) {
        // Publication follows commit. A failed side effect must not turn a successful edit
        // into an apparent transaction failure or prevent the other listeners from running.
        try {
          logger.error('[domainEvents] Listener failed', { type: event.type, error })
        } catch {
          // A custom logging sink is also a side effect, never part of the transaction.
        }
      }
    }
  }
}
