/**
 * Test doubles for BroadcastChannel and timers, so the event stream can be
 * tested in Node with full control over delivery and time.
 */
import type { ChannelFactory, ChannelLike } from '../../../src/core/events/index.js';

/**
 * Same-name channels on one bus see each other's messages, never their own,
 * as with the real BroadcastChannel. Messages are structured-cloned (so an
 * event that is not cloneable fails here as it would in the browser) and
 * delivered asynchronously.
 */
export class FakeChannelBus {
  readonly open = new Set<FakeChannel>();
  readonly posted: { readonly name: string; readonly data: unknown }[] = [];

  readonly factory: ChannelFactory = (name) => {
    const channel = new FakeChannel(this, name);
    this.open.add(channel);
    return channel;
  };

  /** Posts as an outside script would (e.g. a hostile or buggy page on the same origin). */
  inject(name: string, data: unknown): void {
    new FakeChannel(this, name).postMessage(data);
  }
}

export class FakeChannel implements ChannelLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;

  constructor(
    readonly bus: FakeChannelBus,
    readonly name: string,
  ) {}

  postMessage(message: unknown): void {
    if (this.closed) throw new DOMException('channel is closed', 'InvalidStateError');
    const data: unknown = structuredClone(message);
    this.bus.posted.push({ name: this.name, data });
    for (const other of this.bus.open) {
      if (other === this || other.name !== this.name) continue;
      queueMicrotask(() => {
        if (!other.closed) other.onmessage?.({ data } as MessageEvent);
      });
    }
  }

  close(): void {
    this.closed = true;
    this.bus.open.delete(this);
  }
}

/** Manual timers: `advance(ms)` runs everything due, in order. */
export class ManualTimers {
  #now = 0;
  #next = 1;
  readonly #pending = new Map<number, { at: number; callback: () => void }>();

  get now(): number {
    return this.#now;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  setTimeout = (callback: () => void, ms: number): unknown => {
    const id = this.#next++;
    this.#pending.set(id, { at: this.#now + ms, callback });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.#pending.delete(handle as number);
  };

  advance(ms: number): void {
    const end = this.#now + ms;
    for (;;) {
      let dueId: number | null = null;
      let dueAt = Infinity;
      for (const [id, t] of this.#pending) {
        if (t.at <= end && t.at < dueAt) {
          dueAt = t.at;
          dueId = id;
        }
      }
      if (dueId === null) break;
      const task = this.#pending.get(dueId);
      this.#pending.delete(dueId);
      this.#now = dueAt;
      task?.callback();
    }
    this.#now = end;
  }
}

/** Lets queued microtasks (channel deliveries) run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}
