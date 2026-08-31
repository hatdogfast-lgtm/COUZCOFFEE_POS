/**
 * A one-line notice that the outbox has gained work.
 *
 * Without this the sync engine only wakes on its idle timer, so a sale could
 * sit on the till for half a minute before anyone else saw it - which is not
 * what "real time" means to someone watching a dashboard.
 *
 * It is a separate module so the write path can announce new work without
 * importing the engine, and the engine can listen without importing the write
 * path. Neither knows about the other.
 */

type Listener = () => void

const listeners = new Set<Listener>()

export function onOutboxChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyOutboxChanged(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // A misbehaving listener must never break the write that triggered it.
    }
  }
}
