import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadClassifier } from '../../../src/core/classifier/index.js';
import {
  Emitter,
  LOAD_STATE_CHANNEL,
  LOAD_STATE_REQUEST,
  LoadStateHub,
  LoadStatePublisher,
  LoadStateSubscriber,
  isLoadStateEvent,
  type LoadStateEvent,
  type LoadStateHubOptions,
} from '../../../src/core/events/index.js';
import { FEATURE_COUNT, FEATURE_INDEX as I } from '../../../src/core/features/index.js';
import type {
  ModelInput,
  NormalisedSecond,
  PipelineState,
} from '../../../src/core/window/index.js';
import { FakeChannelBus, ManualTimers, settle } from '../helpers/fake-channel.js';

const T0 = Date.UTC(2026, 9, 15, 14, 30, 0);

function state(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    phase: 'ready',
    calibrationProgress: 1,
    calibrationSeconds: 60,
    calibrationTarget: 60,
    presence: 'present',
    classifiable: true,
    windowSeconds: 30,
    windowInvalidFraction: 0,
    ...overrides,
  };
}

function sec(n: number, overrides: Partial<NormalisedSecond> = {}): NormalisedSecond {
  const raw = new Float32Array(FEATURE_COUNT);
  raw[I.gaze_centred_fraction] = 1;
  return {
    second: n,
    startMs: n * 1000,
    raw,
    frames: 15,
    validRatio: 1,
    valid: true,
    aux: { longClosures: 0, yawns: 0, nods: 0, offScreenFraction: 0, faceSize: 0.1 },
    z: new Float32Array(FEATURE_COUNT),
    phase: 'ready',
    ...overrides,
  };
}

const input = (): ModelInput => ({
  data: new Float32Array(30 * FEATURE_COUNT),
  mask: new Uint8Array(30).fill(1),
  seconds: 30,
  features: FEATURE_COUNT,
});

/** Classifier double returning fixed probabilities. */
function fixed(p: [number, number, number], version = 'test-1'): LoadClassifier {
  return { modelVersion: version, classify: () => Float64Array.from(p) };
}

function setup(options: Partial<LoadStateHubOptions> = {}) {
  const timers = new ManualTimers();
  const bus = new FakeChannelBus();
  const hub = new LoadStateHub({
    timers,
    now: () => T0 + timers.now,
    channelFactory: bus.factory,
    strainStorage: null,
    ...options,
  });
  const states: LoadStateEvent[] = [];
  const changes: LoadStateEvent[] = [];
  const errors: unknown[] = [];
  hub.on('state', (e) => states.push(e));
  hub.on('change', (e) => changes.push(e));
  hub.on('error', (e) => errors.push(e));
  /** Runs n classifiable seconds; returns the hub's latest event. */
  const run = (
    n: number,
    start = 0,
    s: Partial<NormalisedSecond> = {},
    st: Partial<PipelineState> = {},
  ) => {
    for (let i = 0; i < n; i += 1) {
      timers.advance(1000);
      hub.pushSecond(sec(start + i, s), state(st), st.classifiable === false ? null : input());
    }
    return hub.latest;
  };
  return { hub, timers, bus, states, changes, errors, run };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoadStateHub: events (FR5, FR6)', () => {
  it('starts disabled with every estimate null', () => {
    const { hub } = setup();
    expect(hub.latest).toMatchObject({
      status: 'disabled',
      load_state: null,
      confidence: null,
      frustration: null,
      engagement: null,
      presence: null,
      fatigue: null,
      affect: null,
      strain: null,
      suggest_break: null,
      schema_version: 1,
      timestamp: '2026-10-15T14:30:00.000Z',
    });
    expect(isLoadStateEvent(hub.latest)).toBe(true);
    hub.close();
  });

  it('starting → calibrating → active, with a load estimate and confidence only when active', () => {
    const { hub, changes, run } = setup({ classifier: fixed([0.1, 0.2, 0.7]) });
    hub.setSource('starting');
    hub.setSource('running');
    expect(hub.latest.status).toBe('calibrating');
    hub.updatePipeline(state({ phase: 'calibrating', classifiable: false }));
    expect(hub.latest.status).toBe('calibrating');
    expect(hub.latest.presence).toBe('present');
    expect(hub.latest.load_state).toBeNull();

    const e = run(1);
    expect(e.status).toBe('active');
    expect(e.load_state).toBe('High');
    expect(e.confidence).toBeCloseTo(0.7, 3);
    expect(e.engagement).not.toBeNull();
    expect(e.fatigue).not.toBeNull();
    expect(e.affect).not.toBeNull();
    expect(e.strain).not.toBeNull();
    expect(changes.map((c) => `${c.status}/${String(c.presence)}`)).toEqual([
      'starting/null',
      'calibrating/null', // running, no frame yet
      'calibrating/present', // first frame: presence known
      'active/present',
    ]);
    hub.close();
  });

  it('every event passes the validator', () => {
    const { hub, states, run, timers } = setup({ classifier: fixed([0.2, 0.5, 0.3]) });
    hub.setSource('starting');
    hub.setSource('running');
    run(40);
    hub.updatePipeline(state({ presence: 'absent' }));
    hub.setSource('paused');
    timers.advance(20_000);
    hub.setSource('no_camera');
    hub.close();
    expect(states.length).toBeGreaterThan(5);
    for (const e of states) expect(isLoadStateEvent(e), JSON.stringify(e)).toBe(true);
  });

  it('presence absent → no_face: load null, presence and strain still reported', () => {
    const { hub, run } = setup({ classifier: fixed([0.1, 0.8, 0.1]) });
    hub.setSource('running');
    run(3);
    hub.updatePipeline(state({ presence: 'absent' }));
    expect(hub.latest).toMatchObject({ status: 'no_face', load_state: null, presence: 'absent' });
    expect(hub.latest.strain).not.toBeNull();
    hub.close();
  });

  it('window not classifiable but face visible (refilling after a gap) → calibrating', () => {
    const { hub, run } = setup({ classifier: fixed([0.1, 0.8, 0.1]) });
    hub.setSource('running');
    run(3);
    hub.updatePipeline(state({ classifiable: false }));
    expect(hub.latest.status).toBe('calibrating');
    hub.close();
  });

  it('paused and failure statuses publish no estimates, presence or strain', () => {
    const { hub, run } = setup({ classifier: fixed([0.1, 0.8, 0.1]) });
    hub.setSource('running');
    run(3);
    for (const s of [
      'paused',
      'permission_denied',
      'no_camera',
      'camera_in_use',
      'unsupported',
      'error',
      'disabled',
    ] as const) {
      hub.setSource(s);
      expect(hub.latest.status).toBe(s);
      expect(hub.latest.presence).toBeNull();
      expect(hub.latest.strain).toBeNull();
      expect(hub.latest.load_state).toBeNull();
    }
    hub.close();
  });

  it('affect is null when expression features are off (FR3 ablation)', () => {
    const { hub, run } = setup({
      useExpressionFeatures: false,
      classifier: fixed([0.1, 0.8, 0.1]),
    });
    hub.setSource('running');
    expect(run(5).affect).toBeNull();
    hub.close();
  });

  it('meta carries fps, backend and the classifier version', () => {
    const { hub, run } = setup({ meta: () => ({ fps: 14.86, backend: 'webgl' }) });
    hub.setSource('running');
    expect(run(1).meta).toEqual({ fps: 14.9, backend: 'webgl', model_version: 'heuristic-0' });
    hub.close();
  });

  it('a bug that produces an invalid event is reported, not published', () => {
    const { hub, errors, run } = setup({ classifier: fixed([Number.NaN, Number.NaN, Number.NaN]) });
    hub.setSource('running');
    const before = hub.latest;
    run(1);
    expect(errors.length).toBeGreaterThan(0);
    expect(String(errors[0])).toContain('invalid LoadStateEvent');
    expect(isLoadStateEvent(hub.latest)).toBe(true);
    expect(hub.latest).toBe(before);
    hub.close();
  });

  it('reset() forgets estimates so an old window cannot leak into a new session', () => {
    const { hub, run } = setup({ classifier: fixed([0.1, 0.1, 0.8]) });
    hub.setSource('running');
    run(3);
    expect(hub.latest.load_state).toBe('High');
    hub.reset();
    expect(hub.latest.status).toBe('calibrating');
    expect(hub.latest.load_state).toBeNull();
    hub.close();
  });
});

describe('LoadStateHub: emit on change + heartbeat every 5 s', () => {
  it('emits a heartbeat every 5 s while nothing changes', () => {
    const { hub, timers, states, changes } = setup();
    timers.advance(20_000);
    expect(states).toHaveLength(4);
    expect(changes).toHaveLength(0);
    expect(states.map((e) => e.timestamp)).toEqual([
      '2026-10-15T14:30:05.000Z',
      '2026-10-15T14:30:10.000Z',
      '2026-10-15T14:30:15.000Z',
      '2026-10-15T14:30:20.000Z',
    ]);
    hub.close();
  });

  it('emits immediately on change and re-arms the heartbeat from there', () => {
    const { hub, timers, states } = setup();
    timers.advance(3_000);
    hub.setSource('starting');
    expect(states).toHaveLength(1);
    timers.advance(4_999);
    expect(states).toHaveLength(1);
    timers.advance(1);
    expect(states).toHaveLength(2);
    hub.close();
  });

  it('never leaves more than heartbeatMs between events over a long session (NFR6)', () => {
    const { hub, timers, states, run } = setup({ classifier: fixed([0.2, 0.6, 0.2]) });
    hub.setSource('running');
    run(30 * 60); // 30 min of seconds
    const times = states.map((e) => Date.parse(e.timestamp));
    const gaps = times.slice(1).map((t, i) => t - (times[i] ?? t));
    expect(Math.max(...gaps)).toBeLessThanOrEqual(5_000);
    expect(timers.pendingCount).toBe(1);
    hub.close();
  });

  it('confidence alone does not count as a change; heartbeats carry the latest value', () => {
    let p: [number, number, number] = [0.1, 0.8, 0.1];
    const clf: LoadClassifier = { modelVersion: 't', classify: () => Float64Array.from(p) };
    const { hub, changes, states, run } = setup({ classifier: clf });
    hub.setSource('running');
    run(10);
    const changeCount = changes.length;
    p = [0.2, 0.6, 0.2];
    run(10, 10);
    expect(changes.length).toBe(changeCount);
    expect(states.at(-1)?.confidence).toBeLessThan(0.75);
    hub.close();
  });

  it('close() emits a final disabled event and stops the heartbeat', () => {
    const { hub, timers, states, run } = setup();
    hub.setSource('running');
    run(2);
    hub.close();
    expect(states.at(-1)?.status).toBe('disabled');
    const count = states.length;
    timers.advance(60_000);
    expect(states.length).toBe(count);
    expect(timers.pendingCount).toBe(0);
  });
});

describe('BroadcastChannel delivery (§8 Delivery)', () => {
  it('publishes every event on adaptlearn.load-state, structured-cloneable', async () => {
    const { hub, bus } = setup();
    hub.setSource('starting');
    await settle();
    const names = new Set(bus.posted.map((p) => p.name));
    expect([...names]).toEqual([LOAD_STATE_CHANNEL]);
    expect(bus.posted.map((p) => (p.data as LoadStateEvent).status)).toEqual([
      'disabled',
      'starting',
    ]);
    hub.close();
  });

  it('answers a consumer request with the latest event', async () => {
    const { hub, bus } = setup();
    hub.setSource('starting');
    const sub = new LoadStateSubscriber({ factory: bus.factory });
    await settle();
    expect(sub.latest?.status).toBe('starting');
    expect(
      bus.posted.some((p) => (p.data as { type?: string }).type === LOAD_STATE_REQUEST.type),
    ).toBe(true);
    sub.close();
    hub.close();
  });

  it('can be switched off', () => {
    const { hub, bus } = setup({ broadcast: false });
    hub.setSource('starting');
    expect(bus.posted).toHaveLength(0);
    expect(hub.broadcasting).toBe(false);
    hub.close();
  });

  it('works without BroadcastChannel (in-page listeners only)', () => {
    const publisher = new LoadStatePublisher(
      () => ({}) as LoadStateEvent,
      () => null,
    );
    expect(publisher.available).toBe(false);
    publisher.publish({} as LoadStateEvent);
    publisher.close();
  });

  it('subscriber drops invalid messages and reports them', async () => {
    const bus = new FakeChannelBus();
    const sub = new LoadStateSubscriber({ factory: bus.factory });
    const invalid: unknown[] = [];
    const valid: unknown[] = [];
    sub.on('invalid', (x) => invalid.push(x));
    sub.on('event', (x) => valid.push(x));
    bus.inject(LOAD_STATE_CHANNEL, { load_state: 'High', landmarks: [1, 2, 3] });
    bus.inject(LOAD_STATE_CHANNEL, LOAD_STATE_REQUEST); // another consumer's request: ignored silently
    await settle();
    expect(valid).toHaveLength(0);
    expect(invalid).toHaveLength(1);
    expect(sub.latest).toBeNull();
    sub.close();
  });
});

describe('Emitter', () => {
  it('a throwing listener does not stop the others', () => {
    const errors: unknown[] = [];
    const em = new Emitter<{ x: number }>((e) => errors.push(e));
    const got: number[] = [];
    em.on('x', () => {
      throw new Error('consumer bug');
    });
    em.on('x', (v) => got.push(v));
    em.emit('x', 1);
    expect(got).toEqual([1]);
    expect(errors).toHaveLength(1);
  });

  it('unsubscribing during emit is safe', () => {
    const em = new Emitter<{ x: number }>();
    const got: string[] = [];
    const offA = em.on('x', () => {
      got.push('a');
      offA();
    });
    em.on('x', () => got.push('b'));
    em.emit('x', 1);
    em.emit('x', 2);
    expect(got).toEqual(['a', 'b', 'b']);
    expect(em.listenerCount('x')).toBe(1);
  });
});
