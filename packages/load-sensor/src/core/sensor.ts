import { Camera, type CameraEnvironment, type CameraStatus } from './camera/index.js';
import type { LoadClassifier } from './classifier/types.js';
import type { ChannelFactory } from './events/broadcast.js';
import { Emitter } from './events/emitter.js';
import { LoadStateHub, type HubTimers, type SourceStatus } from './events/hub.js';
import { SENSING_STATUSES, type LoadSensorStatus, type LoadStateEvent } from './events/types.js';
import type { StrainStorage } from './heuristics/strain.js';
import {
  LandmarkTracker,
  TfjsFaceMeshProvider,
  UnsupportedBackendError,
  type LandmarkProvider,
} from './landmarks/index.js';
import { FeaturePipeline } from './window/feature-pipeline.js';

/**
 * Whether studying needs the camera.
 *
 * - `optional` (default): AdaptLearn works with sensing off (invariant 4).
 * - `required`: the host app gates study content on `sensor.studyGate`.
 *   Implemented, but refused until the supervisor and the ethics reviewer
 *   approve it (TODO A0) and CLAUDE.md invariant 4 is updated; then set
 *   `REQUIRED_CAMERA_POLICY_APPROVED` to true.
 */
export type CameraPolicy = 'optional' | 'required';

/** Flip only after the TODO A0 camera-required approval is ticked. */
// `as boolean`: a plain `false` literal would make the guard below look like dead code.
export const REQUIRED_CAMERA_POLICY_APPROVED = false as boolean;

export class CameraPolicyNotApprovedError extends Error {
  constructor() {
    super(
      'cameraPolicy "required" is not approved yet: it overrides "sensing is opt-in" (CLAUDE.md invariant 4) and needs supervisor and ethics approval first (TODO A0).',
    );
    this.name = 'CameraPolicyNotApprovedError';
  }
}

/** `open`: study content may be shown. `needs_camera`: `required` policy and sensing is not running. */
export type StudyGate = 'open' | 'needs_camera';

export interface LoadSensorOptions {
  /** Base URL of the self-hosted face mesh models (default `/models/`). Same-origin only. */
  readonly modelBaseUrl?: string;
  /** Base URL of the TF.js WASM binaries (default `/wasm/`). Same-origin only. */
  readonly wasmBaseUrl?: string;
  /** Video element for a preview; otherwise a detached one is used. Never read for pixels here. */
  readonly video?: HTMLVideoElement;
  /** Landmark inference rate cap (default 15). */
  readonly targetFps?: number;
  /** FR3 ablation switch; fixed for the sensor's lifetime (default true). */
  readonly useExpressionFeatures?: boolean;
  readonly cameraPolicy?: CameraPolicy;
  /** Heartbeat interval in ms (default 5000). */
  readonly heartbeatMs?: number;
  /** Publish on the `adaptlearn.load-state` BroadcastChannel (default true). */
  readonly broadcast?: boolean;
  /** Replaces the `heuristic-0` placeholder, e.g. with the trained model. */
  readonly classifier?: LoadClassifier;
  /** Where `strain` keeps today's totals (default localStorage; null = memory only). */
  readonly strainStorage?: StrainStorage | null;
  /** Test seams. Not part of the integration contract. */
  readonly environment?: {
    readonly camera?: Partial<CameraEnvironment>;
    readonly provider?: LandmarkProvider;
    readonly channelFactory?: ChannelFactory;
    readonly timers?: HubTimers;
    readonly now?: () => number;
  };
}

export interface LoadSensorEvents extends Record<string, unknown> {
  /** Every event: changes and 5 s heartbeats. */
  state: LoadStateEvent;
  /** Only events where something other than timestamp / meta / confidence changed. */
  change: LoadStateEvent;
  /** Non-fatal problems (a failed inference, a model that would not load). */
  error: unknown;
}

/** The public sensor object (ARCHITECTURE.md §8 Delivery). */
export interface LoadSensor {
  readonly cameraPolicy: CameraPolicy;
  readonly useExpressionFeatures: boolean;
  /** Same as `getState().status`. */
  readonly status: LoadSensorStatus;
  readonly studyGate: StudyGate;
  /**
   * Opens the camera (the browser may prompt) and starts sensing. Call only
   * after the user opted in. Resolves with the resulting status; never rejects.
   */
  enable(): Promise<LoadSensorStatus>;
  /** Keeps the camera open but stops processing; `status: "paused"`. */
  pause(): void;
  resume(): void;
  /** Stops every camera track (LED off) and forgets the session's baseline. */
  disable(): void;
  on<K extends keyof LoadSensorEvents>(
    type: K,
    listener: (value: LoadSensorEvents[K]) => void,
  ): () => void;
  /** The last emitted event, synchronously. Never throws. */
  getState(): LoadStateEvent;
  /** The learner took a break: resets "time since last break" in `strain`. */
  markBreak(): void;
  /** Starts a new 60 s baseline (e.g. after the learner moved seats or lighting changed). */
  recalibrate(): void;
  /** `disable()`, then releases the model, timers and the channel. The sensor is unusable afterwards. */
  destroy(): void;
}

/** Camera failures map one-to-one onto event statuses (decided 2026-10-10; see types.ts). */
const CAMERA_FAILURE: Partial<Record<CameraStatus, SourceStatus>> = {
  permission_denied: 'permission_denied',
  no_camera: 'no_camera',
  camera_in_use: 'camera_in_use',
  unsupported: 'unsupported',
  error: 'error',
};

/**
 * The hub source for a camera status. `processing` = the face model is loaded
 * and the tracker is running; until then an open camera is still `starting`.
 * Shared with the demo page so both publish identical statuses.
 */
export function sourceForCamera(status: CameraStatus, processing: boolean): SourceStatus {
  const failure = CAMERA_FAILURE[status];
  if (failure) return failure;
  switch (status) {
    case 'active':
      return processing ? 'running' : 'starting';
    case 'paused':
      return processing ? 'paused' : 'starting';
    case 'starting':
      return 'starting';
    default:
      return 'disabled'; // idle, stopped
  }
}

/**
 * Creates the load sensor. Nothing is opened, loaded or prompted until
 * `enable()`: sensing is opt-in (invariant 4), and TF.js and the models are
 * only fetched (same-origin) on the first `enable()`.
 *
 * ```ts
 * const sensor = createLoadSensor();
 * sensor.on('change', (e) => console.log(e.load_state, e.status));
 * await sensor.enable(); // after the user opted in
 * ```
 */
export function createLoadSensor(options: LoadSensorOptions = {}): LoadSensor {
  return new LoadSensorImpl(options);
}

class LoadSensorImpl implements LoadSensor {
  readonly cameraPolicy: CameraPolicy;
  readonly useExpressionFeatures: boolean;

  readonly #camera: Camera;
  readonly #provider: LandmarkProvider;
  readonly #tracker: LandmarkTracker;
  readonly #pipeline: FeaturePipeline;
  readonly #hub: LoadStateHub;
  readonly #emitter = new Emitter<LoadSensorEvents>();
  readonly #cleanup: (() => void)[] = [];

  #modelReady = false;
  /** Bumped by disable(); an enable() that was waiting on the model then stops. */
  #generation = 0;
  #destroyed = false;

  constructor(options: LoadSensorOptions) {
    this.cameraPolicy = options.cameraPolicy ?? 'optional';
    if (this.cameraPolicy === 'required' && !REQUIRED_CAMERA_POLICY_APPROVED) {
      throw new CameraPolicyNotApprovedError();
    }
    this.useExpressionFeatures = options.useExpressionFeatures ?? true;
    const env = options.environment ?? {};

    this.#camera = new Camera({
      ...(options.video ? { video: options.video } : {}),
      ...(env.camera ? { environment: env.camera } : {}),
    });
    this.#provider =
      env.provider ??
      new TfjsFaceMeshProvider({
        ...(options.modelBaseUrl === undefined ? {} : { modelBaseUrl: options.modelBaseUrl }),
        ...(options.wasmBaseUrl === undefined ? {} : { wasmBaseUrl: options.wasmBaseUrl }),
      });
    this.#tracker = new LandmarkTracker(
      this.#camera,
      this.#provider,
      options.targetFps === undefined ? {} : { targetFps: options.targetFps },
    );
    this.#pipeline = new FeaturePipeline({ useExpressionFeatures: this.useExpressionFeatures });
    this.#hub = new LoadStateHub({
      useExpressionFeatures: this.useExpressionFeatures,
      ...(options.classifier ? { classifier: options.classifier } : {}),
      ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
      ...(options.broadcast === undefined ? {} : { broadcast: options.broadcast }),
      ...(options.strainStorage === undefined ? {} : { strainStorage: options.strainStorage }),
      ...(env.channelFactory ? { channelFactory: env.channelFactory } : {}),
      ...(env.timers ? { timers: env.timers } : {}),
      ...(env.now ? { now: env.now } : {}),
      meta: () =>
        this.#modelReady && this.#provider.backend
          ? {
              fps: this.#tracker.running ? this.#tracker.stats.fps : 0,
              backend: this.#provider.backend,
            }
          : null,
    });

    this.#cleanup.push(
      this.#hub.on('state', (e) => {
        this.#emitter.emit('state', e);
      }),
      this.#hub.on('change', (e) => {
        this.#emitter.emit('change', e);
      }),
      this.#hub.on('error', (e) => {
        this.#emitter.emit('error', e);
      }),
      this.#tracker.onError((e) => {
        this.#emitter.emit('error', e);
      }),
      this.#tracker.onSample((sample) => {
        const s = this.#camera.settings;
        const aspect = s?.width && s.height ? s.width / s.height : 4 / 3;
        this.#pipeline.push(sample.tMs, sample.face?.landmarks ?? null, aspect);
        this.#hub.updatePipeline(this.#pipeline.state);
      }),
      this.#pipeline.onSecond((second) => {
        const w = this.#pipeline.window;
        this.#hub.pushSecond(
          second,
          this.#pipeline.state,
          w.classifiable ? w.toModelInput() : null,
        );
      }),
      this.#camera.onStatus(({ status }) => {
        this.#onCameraStatus(status);
      }),
    );

    // Save today's strain totals when the page goes away (incl. bfcache).
    if (typeof globalThis.addEventListener === 'function') {
      const onPageHide = (): void => {
        this.disable();
      };
      globalThis.addEventListener('pagehide', onPageHide);
      this.#cleanup.push(() => {
        globalThis.removeEventListener('pagehide', onPageHide);
      });
    }
  }

  get status(): LoadSensorStatus {
    return this.#hub.status;
  }

  get studyGate(): StudyGate {
    if (this.cameraPolicy === 'optional') return 'open';
    const status = this.#hub.status;
    if (SENSING_STATUSES.has(status)) return 'open';
    // Tab hidden is not the learner refusing the camera; a user pause is.
    const reasons = this.#camera.pauseReasons;
    return status === 'paused' && !reasons.has('user') ? 'open' : 'needs_camera';
  }

  async enable(): Promise<LoadSensorStatus> {
    if (this.#destroyed) return this.#hub.status;
    const current = this.#camera.status;
    if (current === 'starting' || current === 'active' || current === 'paused') {
      return this.#hub.status;
    }
    const generation = this.#generation;
    this.#hub.setSource('starting');

    const cameraStatus = await this.#camera.start();
    if (generation !== this.#generation) return this.#hub.status;
    if (cameraStatus !== 'active' && cameraStatus !== 'paused') return this.#hub.status;

    if (!this.#modelReady) {
      try {
        await this.#provider.init();
        this.#modelReady = true;
      } catch (error) {
        if (generation !== this.#generation) return this.#hub.status;
        this.#emitter.emit('error', error);
        this.#stopSensing();
        this.#hub.setSource(error instanceof UnsupportedBackendError ? 'unsupported' : 'error');
        return this.#hub.status;
      }
    }
    // The user may have turned sensing off while the model was loading.
    if (generation !== this.#generation) return this.#hub.status;
    const now = this.#camera.status;
    if (now !== 'active' && now !== 'paused') return this.#hub.status;
    this.#tracker.start();
    this.#hub.setSource(now === 'paused' ? 'paused' : 'running');
    return this.#hub.status;
  }

  pause(): void {
    this.#camera.pause('user');
  }

  resume(): void {
    this.#camera.resume('user');
  }

  disable(): void {
    this.#generation += 1;
    this.#stopSensing();
    if (!this.#destroyed) this.#hub.setSource('disabled');
  }

  on<K extends keyof LoadSensorEvents>(
    type: K,
    listener: (value: LoadSensorEvents[K]) => void,
  ): () => void {
    return this.#emitter.on(type, listener);
  }

  getState(): LoadStateEvent {
    return this.#hub.latest;
  }

  markBreak(): void {
    this.#hub.markBreak();
  }

  recalibrate(): void {
    this.#pipeline.reset();
    this.#hub.reset();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.disable();
    this.#destroyed = true;
    for (const fn of this.#cleanup.splice(0)) fn();
    this.#hub.close();
    this.#provider.dispose();
    this.#emitter.clear();
  }

  #stopSensing(): void {
    this.#tracker.stop();
    this.#camera.stop();
    // Sensing ended: the next session gets a fresh baseline and fresh estimates.
    this.#pipeline.reset();
    this.#hub.reset();
  }

  #onCameraStatus(status: CameraStatus): void {
    if (this.#destroyed) return;
    const failure = CAMERA_FAILURE[status];
    if (failure) {
      // E.g. the camera was unplugged mid-session: stop cleanly, say why.
      this.#tracker.stop();
      this.#pipeline.reset();
      this.#hub.reset();
      this.#hub.setSource(failure);
      return;
    }
    // While the model loads, enable() decides; afterwards the camera does.
    if (!this.#tracker.running) return;
    this.#hub.setSource(sourceForCamera(status, true));
  }
}
