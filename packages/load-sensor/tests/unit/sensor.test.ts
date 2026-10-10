import { describe, expect, it } from 'vitest';
import {
  CameraPolicyNotApprovedError,
  createLoadSensor,
  isLoadStateEvent,
  type LoadSensorOptions,
  type LoadStateEvent,
} from '../../src/core/index.js';
import {
  UnsupportedBackendError,
  type FaceResult,
  type LandmarkProvider,
} from '../../src/core/landmarks/index.js';
import { syntheticFace } from '../fixtures/synthetic-face.js';
import { FakeChannelBus, ManualTimers } from './helpers/fake-channel.js';
import { domException, fakeEnvironment, flush } from './helpers/fake-media.js';

/** Provider double: a steady synthetic face (geometry only), or none. */
class FakeProvider implements LandmarkProvider {
  readonly name = 'fake';
  backend: string | null = null;
  face = true;
  initError: Error | null = null;
  initCalls = 0;
  disposed = false;
  #release: (() => void) | null = null;
  holdInit = false;
  readonly #mesh = syntheticFace();

  init(): Promise<void> {
    this.initCalls += 1;
    if (this.initError) return Promise.reject(this.initError);
    if (this.holdInit) {
      return new Promise((resolve) => {
        this.#release = () => {
          this.backend = 'webgl';
          resolve();
        };
      });
    }
    this.backend = 'webgl';
    return Promise.resolve();
  }

  releaseInit(): void {
    this.#release?.();
  }

  estimate(): Promise<FaceResult | null> {
    return Promise.resolve(this.face ? { landmarks: this.#mesh, score: null } : null);
  }

  dispose(): void {
    this.disposed = true;
  }
}

function setup(options: Partial<LoadSensorOptions> = {}) {
  const media = fakeEnvironment();
  const provider = new FakeProvider();
  const timers = new ManualTimers();
  const bus = new FakeChannelBus();
  const sensor = createLoadSensor({
    strainStorage: null,
    ...options,
    environment: {
      camera: media.env,
      provider,
      timers,
      channelFactory: bus.factory,
      now: () => Date.UTC(2026, 9, 15, 9) + timers.now,
    },
  });
  const events: LoadStateEvent[] = [];
  sensor.on('state', (e) => events.push(e));
  let mediaTimeS = 0;
  /** Presents `seconds` of 15 fps frames and lets each inference finish. */
  const frames = async (seconds: number): Promise<void> => {
    for (let i = 0; i < seconds * 15; i += 1) {
      mediaTimeS += 1 / 15;
      media.video.presentFrame(mediaTimeS);
      await flush();
    }
    timers.advance(seconds * 1000);
  };
  const enabled = async (): Promise<void> => {
    const p = sensor.enable();
    await flush();
    media.mediaDevices.grant();
    await flush();
    await p;
  };
  return { sensor, media, provider, timers, bus, events, frames, enabled };
}

describe('createLoadSensor (FR6, NFR8, invariant 4)', () => {
  it('does nothing until enable(): no camera request, no model load, status disabled', () => {
    const { sensor, media, provider } = setup();
    expect(sensor.status).toBe('disabled');
    expect(sensor.getState().status).toBe('disabled');
    expect(media.mediaDevices.calls).toHaveLength(0);
    expect(provider.initCalls).toBe(0);
    sensor.destroy();
  });

  it('defaults to cameraPolicy optional; studyGate is always open', () => {
    const { sensor } = setup();
    expect(sensor.cameraPolicy).toBe('optional');
    expect(sensor.studyGate).toBe('open');
    sensor.destroy();
  });

  it('refuses cameraPolicy required until TODO A0 approval', () => {
    expect(() => setup({ cameraPolicy: 'required' })).toThrow(CameraPolicyNotApprovedError);
  });

  it('enable → starting → calibrating, and to active after baseline + window (≈ 90 s)', async () => {
    const { sensor, events, frames, enabled } = setup();
    const p = enabled();
    await p;
    expect(events.some((e) => e.status === 'starting')).toBe(true);
    expect(sensor.status).toBe('calibrating');

    await frames(5);
    expect(sensor.getState().presence).toBe('present');
    expect(sensor.status).toBe('calibrating');

    await frames(90);
    const e = sensor.getState();
    expect(e.status).toBe('active');
    expect(e.load_state).not.toBeNull();
    expect(e.confidence).toBeGreaterThan(0);
    expect(e.meta).toMatchObject({ backend: 'webgl', model_version: 'heuristic-0' });
    expect(e.meta?.fps).toBeGreaterThan(10);
    sensor.destroy();
  });

  it('every emitted event is valid and small: numbers and labels only (FR7)', async () => {
    const { sensor, events, frames, enabled } = setup();
    await enabled();
    await frames(95);
    sensor.disable();
    expect(events.length).toBeGreaterThan(3);
    for (const e of events) {
      expect(isLoadStateEvent(e)).toBe(true);
      expect(JSON.stringify(e).length).toBeLessThan(600);
    }
    sensor.destroy();
  });

  it('face lost for > 2 s → no_face with load null; back → recovers', async () => {
    const { sensor, provider, frames, enabled } = setup();
    await enabled();
    await frames(95);
    expect(sensor.status).toBe('active');
    provider.face = false;
    await frames(3);
    expect(sensor.getState()).toMatchObject({
      status: 'no_face',
      load_state: null,
      presence: 'absent',
    });
    provider.face = true;
    await frames(1);
    expect(sensor.status).not.toBe('no_face');
    sensor.destroy();
  });

  it('pause / resume', async () => {
    const { sensor, frames, enabled } = setup();
    await enabled();
    await frames(2);
    sensor.pause();
    expect(sensor.getState()).toMatchObject({ status: 'paused', presence: null, strain: null });
    sensor.resume();
    expect(sensor.status).toBe('calibrating');
    sensor.destroy();
  });

  it('disable stops every camera track and reports disabled', async () => {
    const { sensor, media, enabled } = setup();
    await enabled();
    sensor.disable();
    expect(sensor.status).toBe('disabled');
    const stream = media.video.srcObject;
    expect(stream).toBeNull();
    sensor.destroy();
  });

  it('permission denied → status permission_denied, never throws', async () => {
    const { sensor, media } = setup();
    const p = sensor.enable();
    await flush();
    media.mediaDevices.deny(domException('NotAllowedError'));
    await expect(p).resolves.toBe('permission_denied');
    expect(sensor.getState().load_state).toBeNull();
    sensor.destroy();
  });

  it('camera in use → status camera_in_use (proposed status)', async () => {
    const { sensor, media } = setup();
    const p = sensor.enable();
    await flush();
    media.mediaDevices.deny(domException('NotReadableError'));
    await expect(p).resolves.toBe('camera_in_use');
    sensor.destroy();
  });

  it('camera unplugged mid-session → no_camera', async () => {
    const { sensor, media, frames, enabled } = setup();
    await enabled();
    await frames(2);
    const stream = media.video.srcObject as { tracks: { endFromDevice(): void }[] };
    stream.tracks[0]?.endFromDevice();
    await flush();
    expect(sensor.status).toBe('no_camera');
    sensor.destroy();
  });

  it('no usable TF.js backend → unsupported, camera released', async () => {
    const { sensor, provider, media } = setup();
    provider.initError = new UnsupportedBackendError([]);
    const errors: unknown[] = [];
    sensor.on('error', (e) => errors.push(e));
    const p = sensor.enable();
    await flush();
    media.mediaDevices.grant();
    await expect(p).resolves.toBe('unsupported');
    expect(media.video.srcObject).toBeNull();
    expect(errors).toHaveLength(1);
    sensor.destroy();
  });

  it('model fails to load → error status', async () => {
    const { sensor, provider, media } = setup();
    provider.initError = new Error('404');
    const p = sensor.enable();
    await flush();
    media.mediaDevices.grant();
    await expect(p).resolves.toBe('error');
    sensor.destroy();
  });

  it('disable while the model is loading wins: sensing does not start', async () => {
    const { sensor, provider, media } = setup();
    provider.holdInit = true;
    const p = sensor.enable();
    await flush();
    media.mediaDevices.grant();
    await flush();
    sensor.disable();
    provider.releaseInit();
    await expect(p).resolves.toBe('disabled');
    expect(media.video.srcObject).toBeNull();
    sensor.destroy();
  });

  it('enable twice does not open a second camera', async () => {
    const { sensor, media, enabled } = setup();
    await enabled();
    await sensor.enable();
    expect(media.mediaDevices.calls).toHaveLength(1);
    sensor.destroy();
  });

  it('recalibrate starts a new baseline', async () => {
    const { sensor, frames, enabled } = setup();
    await enabled();
    await frames(95);
    expect(sensor.status).toBe('active');
    sensor.recalibrate();
    expect(sensor.status).toBe('calibrating');
    sensor.destroy();
  });

  it('broadcasts on adaptlearn.load-state; destroy releases model, timers and channel', async () => {
    const { sensor, bus, provider, timers, enabled } = setup();
    await enabled();
    expect(bus.posted.length).toBeGreaterThan(0);
    sensor.destroy();
    expect(provider.disposed).toBe(true);
    expect(timers.pendingCount).toBe(0);
    expect(bus.open.size).toBe(0);
    expect(sensor.getState().status).toBe('disabled');
  });

  it('a throwing consumer listener does not break the sensor', async () => {
    const { sensor, events, enabled } = setup();
    sensor.on('state', () => {
      throw new Error('consumer bug');
    });
    const original = globalThis.reportError;
    const reported: unknown[] = [];
    globalThis.reportError = (e: unknown) => reported.push(e);
    try {
      await enabled();
    } finally {
      globalThis.reportError = original;
    }
    expect(events.some((e) => e.status === 'calibrating')).toBe(true);
    expect(reported.length).toBeGreaterThan(0);
    sensor.destroy();
  });
});
