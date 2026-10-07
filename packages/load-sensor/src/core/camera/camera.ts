import { classifyCameraError } from './camera-errors.js';
import { buildMediaStreamConstraints, DEFAULT_VIDEO_CONSTRAINTS } from './constraints.js';
import { startFrameLoop, type AnimationFrameApi, type FrameLoop } from './frame-loop.js';
import type {
  CameraError,
  CameraFailure,
  CameraFrame,
  CameraStatus,
  FrameClock,
  PauseReason,
} from './types.js';

/**
 * Browser APIs the camera uses. Defaults to the real globals; tests pass doubles
 * so the camera can be exercised in Node with a mocked MediaStream.
 */
export interface CameraEnvironment extends AnimationFrameApi {
  readonly mediaDevices: Pick<MediaDevices, 'getUserMedia'> | undefined;
  readonly document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  readonly isSecureContext: boolean;
  createVideoElement(): HTMLVideoElement;
}

export interface CameraOptions {
  /**
   * Video element to play the stream into. Pass one that is in the page if
   * you want to show the preview (the debug overlay does); otherwise a
   * detached element is created. The camera never draws or reads its pixels.
   */
  readonly video?: HTMLVideoElement;
  /** Overrides the default 640×480 @ 30 fps request (ARCHITECTURE.md §4). */
  readonly constraints?: MediaTrackConstraints;
  /** Pause automatically while the tab is hidden (default true). */
  readonly pauseWhenHidden?: boolean;
  readonly environment?: Partial<CameraEnvironment>;
}

export interface CameraStatusChange {
  readonly status: CameraStatus;
  readonly previous: CameraStatus;
  /** Set when `status` is a failure. */
  readonly error?: CameraError;
}

type Listener<T> = (value: T) => void;

/** Statuses from which `start()` may open the camera. */
const STARTABLE: ReadonlySet<CameraStatus> = new Set<CameraStatus>([
  'idle',
  'stopped',
  'permission_denied',
  'no_camera',
  'camera_in_use',
  'unsupported',
  'error',
]);

/**
 * Owns the webcam: opening it, delivering frames, pausing, and releasing it.
 *
 * Privacy (FR7, invariant 1): the stream goes only into a `<video>` element.
 * Nothing here reads pixels, records, or exports a frame; frames reach
 * subscribers as a reference to that element plus a timestamp.
 *
 * Lifecycle: `start()` → `active` ⇄ `paused` → `stop()`. Failures are statuses,
 * not exceptions: `start()` resolves with the status it ended in and never
 * rejects. `stop()` may be called at any time, including while the permission
 * prompt is open, and always ends with every track stopped.
 */
export class Camera {
  readonly #env: CameraEnvironment;
  readonly #constraints: MediaStreamConstraints;
  readonly #pauseWhenHidden: boolean;
  readonly #video: HTMLVideoElement;

  #status: CameraStatus = 'idle';
  #lastError: CameraError | null = null;
  #stream: MediaStream | null = null;
  #loop: FrameLoop | null = null;
  #pauseReasons = new Set<PauseReason>();
  #pendingStart: Promise<CameraStatus> | null = null;
  /** Bumped by stop(); lets a start() that resolves late see it was cancelled. */
  #session = 0;

  readonly #statusListeners = new Set<Listener<CameraStatusChange>>();
  readonly #frameListeners = new Set<Listener<CameraFrame>>();

  constructor(options: CameraOptions = {}) {
    this.#env = { ...defaultEnvironment(), ...options.environment };
    this.#constraints = buildMediaStreamConstraints(
      options.constraints ?? DEFAULT_VIDEO_CONSTRAINTS,
    );
    this.#pauseWhenHidden = options.pauseWhenHidden ?? true;
    this.#video = options.video ?? this.#env.createVideoElement();
    // Required for autoplay without a user gesture on mobile Safari/Chrome, and
    // so the element never plays sound (no audio track is requested anyway).
    this.#video.muted = true;
    this.#video.playsInline = true;
    this.#video.autoplay = false;
  }

  get status(): CameraStatus {
    return this.#status;
  }

  /** The most recent failure, or null if the last start succeeded. */
  get lastError(): CameraError | null {
    return this.#lastError;
  }

  /** Clock driving the frame loop while active; null otherwise. */
  get frameClock(): FrameClock | null {
    return this.#loop?.clock ?? null;
  }

  /** Why the camera is paused (empty unless `status === 'paused'`). */
  get pauseReasons(): ReadonlySet<PauseReason> {
    return new Set(this.#pauseReasons);
  }

  /** Actual capture settings the browser chose (may differ from the request). */
  get settings(): MediaTrackSettings | null {
    return this.#stream?.getVideoTracks()[0]?.getSettings() ?? null;
  }

  /** Number of tracks not yet stopped. 0 after `stop()`: the camera LED is off. */
  get liveTrackCount(): number {
    return this.#stream?.getTracks().filter((t) => t.readyState === 'live').length ?? 0;
  }

  /** Subscribes to status changes. Returns an unsubscribe function. */
  onStatus(listener: Listener<CameraStatusChange>): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  /** Subscribes to frames. Returns an unsubscribe function. */
  onFrame(listener: Listener<CameraFrame>): () => void {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  }

  /**
   * Opens the camera. Call only after the user has opted in (invariant 4): this
   * shows the browser's permission prompt. Resolves with the resulting status.
   */
  start(): Promise<CameraStatus> {
    if (this.#pendingStart) return this.#pendingStart;
    if (!STARTABLE.has(this.#status)) return Promise.resolve(this.#status);
    this.#pendingStart = this.#open().finally(() => {
      this.#pendingStart = null;
    });
    return this.#pendingStart;
  }

  /**
   * Stops frame delivery but keeps the stream open, so `resume()` is instant.
   * The camera stays on (LED lit); use `stop()` to release it.
   */
  pause(reason: PauseReason = 'user'): void {
    if (this.#status !== 'active' && this.#status !== 'paused') return;
    this.#pauseReasons.add(reason);
    if (this.#status === 'active') {
      this.#stopLoop();
      this.#setStatus('paused');
    }
  }

  /** Clears one pause reason; frames resume when no reason is left. */
  resume(reason: PauseReason = 'user'): void {
    if (this.#status !== 'paused') return;
    this.#pauseReasons.delete(reason);
    if (this.#pauseReasons.size === 0) {
      this.#startLoop();
      this.#setStatus('active');
    }
  }

  /**
   * Stops every track (camera LED off), detaches the stream and removes all
   * listeners on the page. Safe to call repeatedly and from any state.
   */
  stop(): void {
    this.#session += 1;
    this.#release();
    if (this.#status !== 'idle' && this.#status !== 'stopped') this.#setStatus('stopped');
  }

  async #open(): Promise<CameraStatus> {
    const { mediaDevices, isSecureContext } = this.#env;
    if (!isSecureContext || typeof mediaDevices?.getUserMedia !== 'function') {
      this.#fail({
        status: 'unsupported',
        name: isSecureContext ? 'NoMediaDevices' : 'InsecureContext',
        message: isSecureContext
          ? 'This browser does not provide navigator.mediaDevices.getUserMedia.'
          : 'Camera access needs https or http://localhost.',
      });
      return this.#status;
    }

    const session = ++this.#session;
    this.#lastError = null;
    this.#setStatus('starting');

    let stream: MediaStream;
    try {
      stream = await mediaDevices.getUserMedia(this.#constraints);
    } catch (error) {
      if (session === this.#session) this.#fail(classifyCameraError(error));
      return this.#status;
    }

    // stop() was called while the permission prompt was open: release at once
    // so the camera LED does not come on for a session the user already ended.
    if (session !== this.#session) {
      stopTracks(stream);
      return this.#status;
    }

    this.#stream = stream;
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', this.#onTrackEnded);
    }
    this.#video.srcObject = stream;

    try {
      await this.#video.play();
    } catch (error) {
      if (session !== this.#session) return this.#status;
      this.#release();
      this.#fail(classifyCameraError(error));
      return this.#status;
    }
    if (session !== this.#session) return this.#status;

    if (this.#pauseWhenHidden) {
      this.#env.document.addEventListener('visibilitychange', this.#onVisibilityChange);
    }
    if (this.#pauseWhenHidden && this.#env.document.visibilityState === 'hidden') {
      this.#pauseReasons.add('hidden');
      this.#setStatus('paused');
    } else {
      this.#startLoop();
      this.#setStatus('active');
    }
    return this.#status;
  }

  readonly #onVisibilityChange = (): void => {
    if (this.#env.document.visibilityState === 'hidden') this.pause('hidden');
    else this.resume('hidden');
  };

  /**
   * A track ends without stop(): the camera was unplugged, the OS or another
   * app took it, or the user revoked permission from the browser UI.
   */
  readonly #onTrackEnded = (): void => {
    this.#session += 1;
    this.#release();
    this.#fail({
      status: 'no_camera',
      name: 'TrackEnded',
      message: 'The camera stopped delivering video (unplugged, revoked or taken by another app).',
    });
  };

  #startLoop(): void {
    this.#stopLoop();
    this.#loop = startFrameLoop(
      this.#video,
      (tMs) => {
        const frame: CameraFrame = {
          video: this.#video,
          tMs,
          width: this.#video.videoWidth,
          height: this.#video.videoHeight,
        };
        for (const listener of this.#frameListeners) listener(frame);
      },
      this.#env,
    );
  }

  #stopLoop(): void {
    this.#loop?.stop();
    this.#loop = null;
  }

  #release(): void {
    this.#stopLoop();
    this.#pauseReasons.clear();
    this.#env.document.removeEventListener('visibilitychange', this.#onVisibilityChange);
    if (this.#stream) {
      for (const track of this.#stream.getTracks()) {
        track.removeEventListener('ended', this.#onTrackEnded);
      }
      stopTracks(this.#stream);
      this.#stream = null;
    }
    this.#video.srcObject = null;
  }

  #fail(error: CameraError & { status: CameraFailure }): void {
    this.#lastError = error;
    this.#setStatus(error.status, error);
  }

  #setStatus(status: CameraStatus, error?: CameraError): void {
    const previous = this.#status;
    if (previous === status) return;
    this.#status = status;
    const change: CameraStatusChange = error ? { status, previous, error } : { status, previous };
    for (const listener of this.#statusListeners) listener(change);
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function defaultEnvironment(): CameraEnvironment {
  return {
    // Typed as always present, but undefined outside a secure context; #open() checks.
    mediaDevices: globalThis.navigator.mediaDevices,
    document: globalThis.document,
    isSecureContext: globalThis.isSecureContext,
    requestAnimationFrame: (cb) => globalThis.requestAnimationFrame(cb),
    cancelAnimationFrame: (handle) => {
      globalThis.cancelAnimationFrame(handle);
    },
    createVideoElement: () => globalThis.document.createElement('video'),
  };
}
