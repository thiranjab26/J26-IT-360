/**
 * Minimal typed event emitter (no dependency; CLAUDE.md "small dependencies only").
 *
 * A throwing listener must not stop the others or the sensor: one teammate's
 * bug in their handler cannot cut the signal for the other components. The
 * error is handed to `onListenerError`, which by default reports it to the
 * browser console via `reportError` without interrupting the emit.
 */
export class Emitter<Events extends Record<string, unknown>> {
  readonly #listeners = new Map<keyof Events, Set<(value: never) => void>>();
  readonly #onListenerError: (error: unknown) => void;

  constructor(onListenerError: (error: unknown) => void = reportListenerError) {
    this.#onListenerError = onListenerError;
  }

  /** Adds a listener; returns a function that removes it. */
  on<K extends keyof Events>(type: K, listener: (value: Events[K]) => void): () => void {
    let set = this.#listeners.get(type);
    if (!set) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  emit<K extends keyof Events>(type: K, value: Events[K]): void {
    const set = this.#listeners.get(type);
    if (!set) return;
    // Copy, so a listener that unsubscribes (or subscribes) during emit is safe.
    for (const listener of [...set] as ((value: Events[K]) => void)[]) {
      try {
        listener(value);
      } catch (error) {
        this.#onListenerError(error);
      }
    }
  }

  listenerCount(type: keyof Events): number {
    return this.#listeners.get(type)?.size ?? 0;
  }

  clear(): void {
    this.#listeners.clear();
  }
}

function reportListenerError(error: unknown): void {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
  else console.error(error);
}
