/**
 * THE integration file for C01, C03 and C04 (ARCHITECTURE.md §8 "Single
 * integration file"; documented field by field in INTEGRATION.md).
 *
 *   import { onLoadChange } from '@adaptlearn/load-sensor/signals';
 *   onLoadChange((level) => adaptTo(level ?? defaultBehaviour));
 *
 * Receive-only: listens on the same-origin BroadcastChannel the sensor
 * publishes on, so it works in the sensor's own page, another tab, or an
 * iframe. It contains no camera, model or network code, and what it receives
 * is a small JSON event: never frames or landmarks (FR7).
 *
 * `null` is a normal value everywhere here: sensing off, calibrating, no face,
 * or no sensor running at all. Every consumer must have a sensible default.
 */
import { LoadStateSubscriber, type ChannelFactory } from './core/events/broadcast.js';
import {
  HEARTBEAT_MS,
  type AffectState,
  type Level,
  type LoadStateEvent,
  type PresenceState,
} from './core/events/types.js';

export {
  AFFECT_STATES,
  HEARTBEAT_MS,
  LEVELS,
  LOAD_STATE_CHANNEL,
  LOAD_STATE_REQUEST,
  PRESENCE_STATES,
  SCHEMA_VERSION,
  STATUSES,
  type AffectState,
  type Level,
  type LoadSensorStatus,
  type LoadStateEvent,
  type LoadStateMeta,
  type PresenceState,
} from './core/events/types.js';
export { isLoadStateEvent, validateLoadStateEvent } from './core/events/validate.js';

/**
 * No event for this long = no sensor (tab closed, crashed, never started):
 * two missed heartbeats plus 2 s for a busy main thread.
 */
export const STALE_AFTER_MS = 2 * HEARTBEAT_MS + 2_000;

export type Unsubscribe = () => void;

/**
 * Called with the new value of one field, and the event it came from.
 * `event` is null when the value became null because the signal went stale.
 */
export type FieldListener<T> = (value: T | null, event: LoadStateEvent | null) => void;

export interface SignalClient {
  /** Every valid event: changes and 5 s heartbeats. Replays the latest fresh event first. */
  subscribe(callback: (event: LoadStateEvent) => void): Unsubscribe;
  /** `load_state` changed (Low / Medium / High / null). */
  onLoadChange(callback: FieldListener<Level>): Unsubscribe;
  /** `presence` changed (present / away / absent / null). */
  onPresenceChange(callback: FieldListener<PresenceState>): Unsubscribe;
  /** `fatigue` changed (Low / Medium / High / null). */
  onFatigueChange(callback: FieldListener<Level>): Unsubscribe;
  /** `affect` changed (neutral / frustrated / confused / null). */
  onAffectChange(callback: FieldListener<AffectState>): Unsubscribe;
  /** `strain` changed (Low / Medium / High / null). */
  onStrainChange(callback: FieldListener<Level>): Unsubscribe;
  /** The latest event, or null if none arrived or it is older than STALE_AFTER_MS. */
  getLatestSignal(): LoadStateEvent | null;
  /** Closes the channel and drops every listener. */
  close(): void;
}

export interface SignalClientOptions {
  readonly channelFactory?: ChannelFactory;
  readonly channelName?: string;
  /** Monotonic clock (default `performance.now`). */
  readonly now?: () => number;
  readonly timers?: {
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}

/** A separate client, e.g. for tests or a second channel name. Most code uses the exports below. */
export function createSignalClient(options: SignalClientOptions = {}): SignalClient {
  const now = options.now ?? (() => performance.now());
  const timers = options.timers ?? {
    setTimeout: (cb: () => void, ms: number) => globalThis.setTimeout(cb, ms),
    clearTimeout: (h: unknown) => {
      globalThis.clearTimeout(h as ReturnType<typeof setTimeout>);
    },
  };
  let subscriber: LoadStateSubscriber | null = null;
  const staleListeners = new Set<() => void>();
  let watchdog: unknown = null;
  let closed = false;

  const fresh = (): LoadStateEvent | null =>
    subscriber && subscriber.ageMs <= STALE_AFTER_MS ? subscriber.latest : null;

  const arm = (): void => {
    if (watchdog !== null) timers.clearTimeout(watchdog);
    watchdog = timers.setTimeout(() => {
      watchdog = null;
      for (const listener of [...staleListeners]) listener();
    }, STALE_AFTER_MS);
  };

  // Opened on first use, so importing this file costs nothing.
  const open = (): LoadStateSubscriber => {
    if (closed) throw new Error('signal client is closed');
    if (!subscriber) {
      subscriber = new LoadStateSubscriber({
        ...(options.channelFactory ? { factory: options.channelFactory } : {}),
        ...(options.channelName ? { name: options.channelName } : {}),
        now,
      });
      subscriber.on('event', arm);
      arm();
    }
    return subscriber;
  };

  const subscribe = (callback: (event: LoadStateEvent) => void): Unsubscribe => {
    const sub = open();
    const off = sub.on('event', callback);
    const latest = fresh();
    if (latest) {
      queueMicrotask(() => {
        if (!closed) callback(latest);
      });
    }
    return off;
  };

  const onField =
    <K extends 'load_state' | 'presence' | 'fatigue' | 'affect' | 'strain'>(field: K) =>
    (callback: FieldListener<NonNullable<LoadStateEvent[K]>>): Unsubscribe => {
      type V = NonNullable<LoadStateEvent[K]>;
      let last: V | null | undefined; // undefined = nothing reported to this listener yet
      const offEvent = subscribe((event) => {
        const value = event[field] ?? null;
        if (value === last) return;
        last = value;
        callback(value, event);
      });
      const onStale = (): void => {
        if (last === null || last === undefined) return;
        last = null;
        callback(null, null);
      };
      staleListeners.add(onStale);
      return () => {
        offEvent();
        staleListeners.delete(onStale);
      };
    };

  return {
    subscribe,
    onLoadChange: onField('load_state'),
    onPresenceChange: onField('presence'),
    onFatigueChange: onField('fatigue'),
    onAffectChange: onField('affect'),
    onStrainChange: onField('strain'),
    getLatestSignal: () => {
      open();
      return fresh();
    },
    close: () => {
      if (closed) return;
      closed = true;
      if (watchdog !== null) timers.clearTimeout(watchdog);
      staleListeners.clear();
      subscriber?.close();
    },
  };
}

let shared: SignalClient | null = null;
const client = (): SignalClient => (shared ??= createSignalClient());

export const subscribe: SignalClient['subscribe'] = (cb) => client().subscribe(cb);
export const onLoadChange: SignalClient['onLoadChange'] = (cb) => client().onLoadChange(cb);
export const onPresenceChange: SignalClient['onPresenceChange'] = (cb) =>
  client().onPresenceChange(cb);
export const onFatigueChange: SignalClient['onFatigueChange'] = (cb) =>
  client().onFatigueChange(cb);
export const onAffectChange: SignalClient['onAffectChange'] = (cb) => client().onAffectChange(cb);
export const onStrainChange: SignalClient['onStrainChange'] = (cb) => client().onStrainChange(cb);
export const getLatestSignal: SignalClient['getLatestSignal'] = () => client().getLatestSignal();
