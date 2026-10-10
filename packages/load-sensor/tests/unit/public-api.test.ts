import { describe, expect, it, vi } from 'vitest';
import { fakeEnvironment } from './helpers/fake-media.js';

describe('public API module', () => {
  it('has no side effects on import: no network call (FR7, NFR2)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await import('../../src/core/index.js');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('import opens nothing; createLoadSensor() opens only the event channel and reads no storage', async () => {
    const channels: string[] = [];
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        onmessage = null;
        constructor(name: string) {
          channels.push(name);
        }
        postMessage(): void {
          // the initial disabled event
        }
        close(): void {
          // released by destroy()
        }
      },
    );
    const getItem = vi.fn(() => null);
    vi.stubGlobal('localStorage', { getItem, setItem: vi.fn(), removeItem: vi.fn() });
    vi.resetModules();

    const api = await import('../../src/core/index.js');
    expect(channels).toEqual([]);

    const media = fakeEnvironment();
    const sensor = api.createLoadSensor({ environment: { camera: media.env } });
    // Creating the sensor announces "disabled" so consumers know a sensor exists,
    // but reads no stored data and asks for no camera until enable().
    expect(channels).toEqual(['adaptlearn.load-state']);
    expect(getItem).not.toHaveBeenCalled();
    expect(media.mediaDevices.calls).toHaveLength(0);
    sensor.destroy();
  });

  it('exports the documented surface (INTEGRATION.md)', async () => {
    const api = await import('../../src/core/index.js');
    expect(Object.keys(api).sort()).toEqual(
      [
        'CameraPolicyNotApprovedError',
        'HEARTBEAT_MS',
        'HEURISTIC_MODEL_VERSION',
        'LOAD_STATE_CHANNEL',
        'REQUIRED_CAMERA_POLICY_APPROVED',
        'SCHEMA_VERSION',
        'createLoadSensor',
        'isLoadStateEvent',
        'validateLoadStateEvent',
      ].sort(),
    );
    const signals = await import('../../src/signals.js');
    expect(Object.keys(signals).sort()).toEqual(
      [
        'AFFECT_STATES',
        'HEARTBEAT_MS',
        'LEVELS',
        'LOAD_STATE_CHANNEL',
        'LOAD_STATE_REQUEST',
        'PRESENCE_STATES',
        'SCHEMA_VERSION',
        'STALE_AFTER_MS',
        'STATUSES',
        'createSignalClient',
        'getLatestSignal',
        'isLoadStateEvent',
        'onAffectChange',
        'onFatigueChange',
        'onLoadChange',
        'onPresenceChange',
        'onStrainChange',
        'subscribe',
        'validateLoadStateEvent',
      ].sort(),
    );
  });
});
