import { describe, expect, it } from 'vitest';
import { Camera, type CameraStatus, type CameraFrame } from '../../../src/core/camera/index.js';
import { domException, fakeEnvironment, flush, FakeStream } from '../helpers/fake-media.js';

function setup() {
  const fake = fakeEnvironment();
  const camera = new Camera({ environment: fake.env });
  const statuses: CameraStatus[] = [];
  camera.onStatus(({ status }) => statuses.push(status));
  return { ...fake, camera, statuses };
}

async function startActive() {
  const s = setup();
  const started = s.camera.start();
  await flush();
  const stream = s.mediaDevices.grant();
  await expect(started).resolves.toBe('active');
  return { ...s, stream };
}

describe('Camera start (FR1, NFR4)', () => {
  it('requests 640×480 @ 30 fps from the front camera, ideal not exact, and no audio', async () => {
    const { camera, mediaDevices } = setup();
    void camera.start();
    await flush();
    expect(mediaDevices.calls).toEqual([
      {
        audio: false,
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
          facingMode: 'user',
        },
      },
    ]);
  });

  it('plays the stream muted and inline and becomes active', async () => {
    const { camera, video, stream, statuses } = await startActive();
    expect(video.srcObject).toBe(stream);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.playCalls).toBe(1);
    expect(camera.status).toBe('active');
    expect(statuses).toEqual(['starting', 'active']);
    expect(camera.frameClock).toBe('video-frame-callback');
    expect(camera.liveTrackCount).toBe(1);
  });

  it('shares one getUserMedia call between concurrent start() calls', async () => {
    const { camera, mediaDevices } = setup();
    const a = camera.start();
    const b = camera.start();
    await flush();
    mediaDevices.grant();
    await expect(Promise.all([a, b])).resolves.toEqual(['active', 'active']);
    expect(mediaDevices.calls).toHaveLength(1);
  });

  it('delivers frames with the frame media timestamp in ms, not the wall clock', async () => {
    const { camera, video } = await startActive();
    const frames: CameraFrame[] = [];
    camera.onFrame((f) => frames.push(f));
    video.presentFrame(1.0);
    video.presentFrame(1.04);
    expect(frames.map((f) => f.tMs)).toEqual([1000, 1040]);
    expect(frames[0]).toMatchObject({ width: 640, height: 480 });
  });
});

describe('Camera failures are distinct statuses, not exceptions', () => {
  it.each([
    ['NotAllowedError', 'permission_denied'],
    ['NotFoundError', 'no_camera'],
    ['NotReadableError', 'camera_in_use'],
    ['SomethingNew', 'error'],
  ] as const)('%s → %s', async (name, expected) => {
    const { camera, mediaDevices } = setup();
    const started = camera.start();
    await flush();
    mediaDevices.deny(domException(name, 'boom'));
    await expect(started).resolves.toBe(expected);
    expect(camera.status).toBe(expected);
    expect(camera.lastError).toMatchObject({ status: expected, name, message: 'boom' });
  });

  it('reports unsupported outside a secure context without calling getUserMedia', async () => {
    const fake = fakeEnvironment({ isSecureContext: false });
    const camera = new Camera({ environment: fake.env });
    await expect(camera.start()).resolves.toBe('unsupported');
    expect(camera.lastError?.name).toBe('InsecureContext');
    expect(fake.mediaDevices.calls).toHaveLength(0);
  });

  it('reports unsupported when mediaDevices is missing', async () => {
    const fake = fakeEnvironment({ mediaDevices: undefined });
    const camera = new Camera({ environment: fake.env });
    await expect(camera.start()).resolves.toBe('unsupported');
    expect(camera.lastError?.name).toBe('NoMediaDevices');
  });

  it('stops the tracks and reports the failure if video.play() rejects', async () => {
    const { camera, mediaDevices, video } = setup();
    video.playError = domException('NotAllowedError');
    const started = camera.start();
    await flush();
    const stream = mediaDevices.grant();
    await expect(started).resolves.toBe('permission_denied');
    expect(stream.tracks.every((t) => t.readyState === 'ended')).toBe(true);
    expect(video.srcObject).toBeNull();
  });

  it('can be started again after a failure', async () => {
    const { camera, mediaDevices } = setup();
    const first = camera.start();
    await flush();
    mediaDevices.deny(domException('NotReadableError'));
    await expect(first).resolves.toBe('camera_in_use');

    const second = camera.start();
    await flush();
    mediaDevices.grant();
    await expect(second).resolves.toBe('active');
    expect(camera.lastError).toBeNull();
  });

  it('reports no_camera and releases everything when the device ends the track', async () => {
    const { camera, stream, video } = await startActive();
    stream.tracks[0]?.endFromDevice();
    expect(camera.status).toBe('no_camera');
    expect(camera.lastError?.name).toBe('TrackEnded');
    expect(video.srcObject).toBeNull();
    expect(video.pendingCallbacks).toBe(0);
  });
});

describe('Camera stop (invariant 4: camera LED off when disabled)', () => {
  it('stops every track, detaches the stream and stops the frame loop', async () => {
    const fake = fakeEnvironment();
    const camera = new Camera({ environment: fake.env });
    const started = camera.start();
    await flush();
    const stream = fake.mediaDevices.grant(new FakeStream(2));
    await started;

    camera.stop();

    expect(camera.status).toBe('stopped');
    expect(stream.tracks.map((t) => t.stopCalls)).toEqual([1, 1]);
    expect(camera.liveTrackCount).toBe(0);
    expect(fake.video.srcObject).toBeNull();
    expect(fake.video.pendingCallbacks).toBe(0);
  });

  it('is idempotent', async () => {
    const { camera, stream, statuses } = await startActive();
    camera.stop();
    camera.stop();
    expect(stream.tracks[0]?.stopCalls).toBe(1);
    expect(statuses.filter((s) => s === 'stopped')).toHaveLength(1);
  });

  it('releases a stream granted after stop() was called during the permission prompt', async () => {
    const { camera, mediaDevices, video } = setup();
    const started = camera.start();
    await flush();
    camera.stop();
    const stream = mediaDevices.grant();
    await started;
    expect(camera.status).toBe('stopped');
    expect(stream.tracks[0]?.readyState).toBe('ended');
    expect(video.srcObject).toBeNull();
  });

  it('ignores a permission error that arrives after stop()', async () => {
    const { camera, mediaDevices } = setup();
    const started = camera.start();
    await flush();
    camera.stop();
    mediaDevices.deny(domException('NotAllowedError'));
    await expect(started).resolves.toBe('stopped');
    expect(camera.lastError).toBeNull();
  });

  it('stops listening to visibility changes', async () => {
    const { camera, document } = await startActive();
    camera.stop();
    document.setVisibility('hidden');
    document.setVisibility('visible');
    expect(camera.status).toBe('stopped');
  });
});

describe('Camera pause and resume', () => {
  it('stops frame delivery on pause and restarts it on resume, keeping the stream', async () => {
    const { camera, video, stream } = await startActive();
    const frames: number[] = [];
    camera.onFrame((f) => frames.push(f.tMs));

    camera.pause();
    expect(camera.status).toBe('paused');
    expect(video.pendingCallbacks).toBe(0);
    expect(stream.tracks[0]?.readyState).toBe('live');

    camera.resume();
    expect(camera.status).toBe('active');
    video.presentFrame(2);
    expect(frames).toEqual([2000]);
  });

  it('pauses while the tab is hidden and resumes when visible (visibilitychange)', async () => {
    const { camera, document } = await startActive();
    document.setVisibility('hidden');
    expect(camera.status).toBe('paused');
    expect([...camera.pauseReasons]).toEqual(['hidden']);
    document.setVisibility('visible');
    expect(camera.status).toBe('active');
  });

  it('stays paused when the tab returns if the user had also paused', async () => {
    const { camera, document } = await startActive();
    camera.pause('user');
    document.setVisibility('hidden');
    document.setVisibility('visible');
    expect(camera.status).toBe('paused');
    camera.resume('user');
    expect(camera.status).toBe('active');
  });

  it('starts paused if the tab is already hidden when permission is granted', async () => {
    const { camera, mediaDevices, document } = setup();
    const started = camera.start();
    await flush();
    document.visibilityState = 'hidden';
    mediaDevices.grant();
    await expect(started).resolves.toBe('paused');
    document.setVisibility('visible');
    expect(camera.status).toBe('active');
  });

  it('does not auto-pause when pauseWhenHidden is false', async () => {
    const fake = fakeEnvironment();
    const camera = new Camera({ environment: fake.env, pauseWhenHidden: false });
    const started = camera.start();
    await flush();
    fake.mediaDevices.grant();
    await started;
    fake.document.setVisibility('hidden');
    expect(camera.status).toBe('active');
  });

  it('ignores pause and resume when not running', () => {
    const { camera, statuses } = setup();
    camera.pause();
    camera.resume();
    expect(camera.status).toBe('idle');
    expect(statuses).toEqual([]);
  });
});
