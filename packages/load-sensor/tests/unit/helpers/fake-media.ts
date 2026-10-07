/**
 * Test doubles for MediaStream, MediaStreamTrack, <video> and the page, so the
 * camera can be tested in Node without a browser or a real webcam. No pixel data
 * exists anywhere in these doubles.
 */
import type { CameraEnvironment } from '../../../src/core/camera/index.js';

export class FakeTrack extends EventTarget {
  readyState: MediaStreamTrackState = 'live';
  readonly kind = 'video';
  stopCalls = 0;

  stop(): void {
    this.stopCalls += 1;
    this.readyState = 'ended';
  }

  getSettings(): MediaTrackSettings {
    return { width: 640, height: 480, frameRate: 30 };
  }

  /** Simulates the device going away (unplugged, revoked, taken by another app). */
  endFromDevice(): void {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

export class FakeStream {
  readonly tracks: FakeTrack[];

  constructor(trackCount = 1) {
    this.tracks = Array.from({ length: trackCount }, () => new FakeTrack());
  }

  getTracks(): FakeTrack[] {
    return this.tracks;
  }

  getVideoTracks(): FakeTrack[] {
    return this.tracks;
  }
}

export class FakeVideo {
  srcObject: unknown = null;
  muted = false;
  playsInline = false;
  autoplay = true;
  readyState = 4;
  currentTime = 0;
  videoWidth = 640;
  videoHeight = 480;
  playError: Error | null = null;
  playCalls = 0;

  #callbacks = new Map<number, VideoFrameRequestCallback>();
  #nextHandle = 1;

  play(): Promise<void> {
    this.playCalls += 1;
    return this.playError ? Promise.reject(this.playError) : Promise.resolve();
  }

  requestVideoFrameCallback(cb: VideoFrameRequestCallback): number {
    const handle = this.#nextHandle++;
    this.#callbacks.set(handle, cb);
    return handle;
  }

  cancelVideoFrameCallback(handle: number): void {
    this.#callbacks.delete(handle);
  }

  get pendingCallbacks(): number {
    return this.#callbacks.size;
  }

  /** Presents one frame with the given media time (seconds). */
  presentFrame(mediaTimeS: number): void {
    const callbacks = [...this.#callbacks.values()];
    this.#callbacks.clear();
    const metadata: VideoFrameCallbackMetadata = {
      mediaTime: mediaTimeS,
      expectedDisplayTime: 0,
      presentationTime: 0,
      presentedFrames: 0,
      width: this.videoWidth,
      height: this.videoHeight,
    };
    for (const cb of callbacks) cb(0, metadata);
  }
}

export class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';

  setVisibility(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

/** A controllable `getUserMedia`: resolve or reject each call by hand. */
export class FakeMediaDevices {
  calls: MediaStreamConstraints[] = [];
  #pending: { resolve: (s: FakeStream) => void; reject: (e: unknown) => void }[] = [];

  getUserMedia = (constraints: MediaStreamConstraints): Promise<FakeStream> => {
    this.calls.push(constraints);
    return new Promise((resolve, reject) => {
      this.#pending.push({ resolve, reject });
    });
  };

  grant(stream = new FakeStream()): FakeStream {
    const next = this.#pending.shift();
    if (!next) throw new Error('no pending getUserMedia call');
    next.resolve(stream);
    return stream;
  }

  deny(error: unknown): void {
    const next = this.#pending.shift();
    if (!next) throw new Error('no pending getUserMedia call');
    next.reject(error);
  }
}

export function domException(name: string, message = name): Error {
  // DOMException exists in Node >= 17 and behaves like the browser's.
  return new DOMException(message, name);
}

export interface FakeEnv {
  env: CameraEnvironment;
  video: FakeVideo;
  document: FakeDocument;
  mediaDevices: FakeMediaDevices;
}

export function fakeEnvironment(overrides: Partial<CameraEnvironment> = {}): FakeEnv {
  const video = new FakeVideo();
  const document = new FakeDocument();
  const mediaDevices = new FakeMediaDevices();
  const env: CameraEnvironment = {
    mediaDevices: mediaDevices as unknown as MediaDevices,
    document,
    isSecureContext: true,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => undefined,
    createVideoElement: () => video as unknown as HTMLVideoElement,
    ...overrides,
  };
  return { env, video, document, mediaDevices };
}

/** Lets pending promise callbacks (getUserMedia → play → status) run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}
