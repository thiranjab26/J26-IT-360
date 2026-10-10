import { Emitter } from './emitter.js';
import { LOAD_STATE_CHANNEL, LOAD_STATE_REQUEST, type LoadStateEvent } from './types.js';
import { validateLoadStateEvent } from './validate.js';

/**
 * The part of `BroadcastChannel` used here, so tests can pass a double.
 *
 * BroadcastChannel is same-origin only: the browser never sends these messages
 * over the network. Other tabs, windows and iframes of the same origin, and
 * other channel objects in the same page, receive them.
 */
export interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

/** Opens a channel; returns null where BroadcastChannel does not exist. */
export type ChannelFactory = (name: string) => ChannelLike | null;

export const defaultChannelFactory: ChannelFactory = (name) =>
  typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null;

function isRequest(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === LOAD_STATE_REQUEST.type
  );
}

/**
 * Sensor side: posts every event on the channel, and answers a consumer's
 * request with the latest event so a newly opened tab need not wait for the
 * next heartbeat.
 */
export class LoadStatePublisher {
  readonly #channel: ChannelLike | null;
  #closed = false;

  constructor(
    getLatest: () => LoadStateEvent,
    factory: ChannelFactory = defaultChannelFactory,
    name: string = LOAD_STATE_CHANNEL,
  ) {
    this.#channel = factory(name);
    if (this.#channel) {
      this.#channel.onmessage = (message) => {
        if (isRequest(message.data)) this.publish(getLatest());
      };
    }
  }

  /** False where BroadcastChannel is unavailable; in-page listeners still work. */
  get available(): boolean {
    return this.#channel !== null && !this.#closed;
  }

  publish(event: LoadStateEvent): void {
    if (!this.#channel || this.#closed) return;
    this.#channel.postMessage(event);
  }

  close(): void {
    if (!this.#channel || this.#closed) return;
    this.#closed = true;
    this.#channel.onmessage = null;
    this.#channel.close();
  }
}

export interface SubscriberEvents extends Record<string, unknown> {
  event: LoadStateEvent;
  /** A message that is not a valid event (wrong schema, or another script on the channel). */
  invalid: { readonly data: unknown; readonly errors: readonly string[] };
}

/**
 * Consumer side: receives, validates and remembers events from the channel.
 * Works in any same-origin tab or iframe, and in the sensor's own page.
 */
export class LoadStateSubscriber {
  readonly #channel: ChannelLike | null;
  readonly #emitter = new Emitter<SubscriberEvents>();
  readonly #now: () => number;
  #latest: LoadStateEvent | null = null;
  #receivedAt = Number.NEGATIVE_INFINITY;
  #closed = false;

  constructor(
    options: {
      readonly factory?: ChannelFactory;
      readonly name?: string;
      /** Monotonic clock for staleness (default `performance.now`). */
      readonly now?: () => number;
    } = {},
  ) {
    this.#now = options.now ?? (() => performance.now());
    this.#channel = (options.factory ?? defaultChannelFactory)(options.name ?? LOAD_STATE_CHANNEL);
    if (!this.#channel) return;
    this.#channel.onmessage = (message) => {
      this.#receive(message.data);
    };
    this.#channel.postMessage(LOAD_STATE_REQUEST);
  }

  get available(): boolean {
    return this.#channel !== null && !this.#closed;
  }

  /** Last valid event, or null if none has arrived. */
  get latest(): LoadStateEvent | null {
    return this.#latest;
  }

  /** ms since the last valid event arrived (Infinity if none). */
  get ageMs(): number {
    return this.#now() - this.#receivedAt;
  }

  on<K extends keyof SubscriberEvents>(
    type: K,
    listener: (value: SubscriberEvents[K]) => void,
  ): () => void {
    return this.#emitter.on(type, listener);
  }

  get listenerCount(): number {
    return this.#emitter.listenerCount('event');
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#emitter.clear();
    if (this.#channel) {
      this.#channel.onmessage = null;
      this.#channel.close();
    }
  }

  #receive(data: unknown): void {
    if (isRequest(data)) return; // another consumer's request, not for us
    const result = validateLoadStateEvent(data);
    if (!result.ok) {
      this.#emitter.emit('invalid', { data, errors: result.errors });
      return;
    }
    this.#latest = result.event;
    this.#receivedAt = this.#now();
    this.#emitter.emit('event', result.event);
  }
}
