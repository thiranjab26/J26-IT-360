import { describe, expect, it, vi } from 'vitest';
import { LoadStateHub, type SourceStatus } from '../../src/core/events/index.js';
import {
  LOAD_STATE_CHANNEL,
  STALE_AFTER_MS,
  createSignalClient,
  type Level,
  type LoadStateEvent,
} from '../../src/signals.js';
import { FakeChannelBus, ManualTimers, settle } from './helpers/fake-channel.js';

function setup() {
  const bus = new FakeChannelBus();
  const timers = new ManualTimers();
  const hub = new LoadStateHub({
    channelFactory: bus.factory,
    timers,
    now: () => Date.UTC(2026, 9, 15) + timers.now,
    strainStorage: null,
  });
  const client = createSignalClient({ channelFactory: bus.factory, timers, now: () => timers.now });
  return { bus, timers, hub, client };
}

describe('signals.ts — the integration file (FR6, NFR8)', () => {
  it('exports the channel name teammates need for other tabs', () => {
    expect(LOAD_STATE_CHANNEL).toBe('adaptlearn.load-state');
  });

  it('subscribe receives every event from a sensor on the channel', async () => {
    const { hub, client } = setup();
    const got: LoadStateEvent[] = [];
    client.subscribe((e) => got.push(e));
    await settle(); // answer to the request on open
    hub.setSource('starting');
    await settle();
    expect(got.map((e) => e.status)).toEqual(['disabled', 'starting']);
    client.close();
    hub.close();
  });

  it('a late subscriber gets the latest event replayed', async () => {
    const { hub, client } = setup();
    client.subscribe(() => undefined);
    hub.setSource('starting');
    await settle();
    const late = vi.fn();
    client.subscribe(late);
    await settle();
    expect(late).toHaveBeenCalledWith(expect.objectContaining({ status: 'starting' }));
    client.close();
    hub.close();
  });

  it('getLatestSignal: null before any event, the event after, null again when stale', async () => {
    const { hub, client, timers } = setup();
    expect(client.getLatestSignal()).toBeNull();
    await settle();
    expect(client.getLatestSignal()?.status).toBe('disabled');
    hub.close(); // sensor tab closed: no more heartbeats
    await settle();
    timers.advance(STALE_AFTER_MS + 1);
    expect(client.getLatestSignal()).toBeNull();
    client.close();
  });

  it('heartbeats keep the signal fresh', async () => {
    const { hub, client, timers } = setup();
    client.subscribe(() => undefined);
    for (let i = 0; i < 10; i += 1) {
      timers.advance(5_000);
      await settle();
    }
    expect(client.getLatestSignal()).not.toBeNull();
    client.close();
    hub.close();
  });

  it('field helpers fire only when their field changes, first value included', async () => {
    const { hub, client } = setup();
    const presence: (string | null)[] = [];
    client.onPresenceChange((v) => presence.push(v));
    await settle();
    for (const s of ['starting', 'running', 'paused', 'running'] as SourceStatus[]) {
      hub.setSource(s);
      await settle();
    }
    // presence stays null throughout (no pipeline frames): reported once.
    expect(presence).toEqual([null]);
    client.close();
    hub.close();
  });

  it('every helper reads its own field', async () => {
    const bus = new FakeChannelBus();
    const timers = new ManualTimers();
    const client = createSignalClient({
      channelFactory: bus.factory,
      timers,
      now: () => timers.now,
    });
    const seen: Record<string, unknown[]> = {
      load: [],
      presence: [],
      fatigue: [],
      affect: [],
      strain: [],
    };
    client.onLoadChange((v) => seen.load?.push(v));
    client.onPresenceChange((v) => seen.presence?.push(v));
    client.onFatigueChange((v) => seen.fatigue?.push(v));
    client.onAffectChange((v) => seen.affect?.push(v));
    client.onStrainChange((v) => seen.strain?.push(v));
    bus.inject(LOAD_STATE_CHANNEL, {
      load_state: 'High',
      confidence: 0.8,
      frustration: false,
      engagement: 'High',
      timestamp: '2026-10-15T14:30:00.000Z',
      schema_version: 1,
      status: 'active',
      presence: 'away',
      fatigue: 'Low',
      affect: 'confused',
      strain: 'Medium',
      suggest_break: false,
    });
    await settle();
    expect(seen).toEqual({
      load: ['High'],
      presence: ['away'],
      fatigue: ['Low'],
      affect: ['confused'],
      strain: ['Medium'],
    });
    client.close();
  });

  it('helpers report null when the signal goes stale, so consumers fall back to defaults', async () => {
    const bus = new FakeChannelBus();
    const timers = new ManualTimers();
    const client = createSignalClient({
      channelFactory: bus.factory,
      timers,
      now: () => timers.now,
    });
    const load: { v: Level | null; e: LoadStateEvent | null }[] = [];
    client.onLoadChange((v, e) => load.push({ v, e }));
    bus.inject(LOAD_STATE_CHANNEL, {
      load_state: 'Low',
      confidence: 0.7,
      frustration: false,
      engagement: 'High',
      timestamp: '2026-10-15T14:30:00.000Z',
      schema_version: 1,
      status: 'active',
      presence: 'present',
      fatigue: 'Low',
      affect: 'neutral',
      strain: 'Low',
      suggest_break: false,
    });
    await settle();
    timers.advance(STALE_AFTER_MS);
    expect(load.map((x) => x.v)).toEqual(['Low', null]);
    expect(load[1]?.e).toBeNull();
    client.close();
  });

  it('ignores malformed messages from other scripts on the channel', async () => {
    const bus = new FakeChannelBus();
    const client = createSignalClient({ channelFactory: bus.factory });
    const got = vi.fn();
    client.subscribe(got);
    bus.inject(LOAD_STATE_CHANNEL, { load_state: 'High' });
    bus.inject(LOAD_STATE_CHANNEL, 'hello');
    await settle();
    expect(got).not.toHaveBeenCalled();
    client.close();
  });

  it('unsubscribe stops delivery; close is idempotent', async () => {
    const { hub, client } = setup();
    const got = vi.fn();
    const off = client.subscribe(got);
    await settle();
    off();
    hub.setSource('starting');
    await settle();
    expect(got).toHaveBeenCalledTimes(1);
    client.close();
    client.close();
    hub.close();
  });

  it('importing signals.ts opens nothing until first use', async () => {
    const created = vi.fn();
    vi.stubGlobal(
      'BroadcastChannel',
      vi.fn(function FakeBroadcastChannel() {
        created();
      }),
    );
    vi.resetModules();
    await import('../../src/signals.js');
    expect(created).not.toHaveBeenCalled();
  });
});
