import { resolveSameOriginAsset } from '../model-loader.js';
import { DEFAULT_BACKEND_ORDER, selectBackend, type InferenceBackend } from './backend.js';
import { keypointsToLandmarks } from './keypoints.js';
import type { FaceResult, LandmarkProvider, VideoFrameSource } from './types.js';

/**
 * Self-hosted asset layout, written by `pnpm fetch-models` (scripts/fetch-models.ts).
 * Paths are relative to `modelBaseUrl` / `wasmBaseUrl`.
 */
export const FACEMESH_ASSET_PATHS = {
  /** MediaPipe BlazeFace short-range detector (128×128 input). */
  detector: 'facemesh/detector/model.json',
  /** MediaPipe attention mesh: 478 landmarks with refined eyes, lips and irises. */
  landmarks: 'facemesh/landmarks/model.json',
} as const;

export interface TfjsFaceMeshOptions {
  /** Directory holding `facemesh/…` (default `/models/`). Must be same-origin. */
  readonly modelBaseUrl?: string;
  /** Directory holding the `tfjs-backend-wasm*.wasm` binaries (default `/wasm/`). Must be same-origin. */
  readonly wasmBaseUrl?: string;
  /** Backends to try, in order (default webgl → wasm). `cpu` cannot be requested. */
  readonly backends?: readonly InferenceBackend[];
}

type Detector = Awaited<
  ReturnType<typeof import('@tensorflow-models/face-landmarks-detection').createDetector>
>;
type TfCore = typeof import('@tensorflow/tfjs-core');

/**
 * Adapter A (ARCHITECTURE.md §3): MediaPipe FaceMesh via TensorFlow.js, the
 * configuration the approved proposal names (FR1).
 *
 * - `runtime: 'tfjs'` so inference runs in TF.js, not MediaPipe's own WASM.
 * - `refineLandmarks: true` loads the attention mesh, which adds the 10 iris
 *   points needed for the gaze features (478 points total).
 * - Both model URLs point at this app's own origin; the library's tfhub.dev
 *   defaults are never used (invariant 3).
 * - TF.js and the model are imported lazily in `init()`, so importing the
 *   sensor costs nothing until the user opts in.
 */
export class TfjsFaceMeshProvider implements LandmarkProvider {
  readonly name = 'tfjs-facemesh';

  readonly #modelBaseUrl: string;
  readonly #wasmBaseUrl: string;
  readonly #backends: readonly InferenceBackend[];

  #backend: InferenceBackend | null = null;
  #tf: TfCore | null = null;
  #detector: Detector | null = null;
  #initPromise: Promise<void> | null = null;
  #disposed = false;

  constructor(options: TfjsFaceMeshOptions = {}) {
    this.#modelBaseUrl = options.modelBaseUrl ?? '/models/';
    this.#wasmBaseUrl = options.wasmBaseUrl ?? '/wasm/';
    this.#backends = options.backends ?? DEFAULT_BACKEND_ORDER;
  }

  get backend(): InferenceBackend | null {
    return this.#backend;
  }

  /** Live TF.js tensor count, for the leak check in the debug overlay; null before init. */
  get numTensors(): number | null {
    return this.#tf?.memory().numTensors ?? null;
  }

  init(): Promise<void> {
    if (this.#disposed) return Promise.reject(new Error('TfjsFaceMeshProvider was disposed'));
    // Concurrent or repeated init() share one load. A failed load is not
    // cached, so the caller may retry (e.g. after the GPU context comes back).
    this.#initPromise ??= this.#load().catch((error: unknown) => {
      this.#initPromise = null;
      throw error;
    });
    return this.#initPromise;
  }

  // The tfjs face mesh tracks across frames internally, so the frame timestamp
  // in the interface is not needed here.
  async estimate(frame: VideoFrameSource): Promise<FaceResult | null> {
    const detector = this.#detector;
    const tf = this.#tf;
    if (!detector || !tf) throw new Error('TfjsFaceMeshProvider.estimate() called before init()');
    const width = frame.videoWidth;
    const height = frame.videoHeight;
    if (width === 0 || height === 0) return null;

    // The library sizes a <video> input by its `width`/`height` *attributes*
    // (image_utils.getImageSize), which are 0 unless set, so it would see a
    // 0×0 image and never find a face. A pixel tensor carries the real frame
    // size in its shape. It stays on the GPU/WASM heap and is disposed below.
    const pixels = tf.browser.fromPixels(frame);
    let faces: Awaited<ReturnType<Detector['estimateFaces']>>;
    try {
      // staticImageMode false: after a face is found, the next frame's region
      // of interest comes from the previous landmarks and the detector is
      // skipped, which is both faster and steadier for video.
      faces = await detector.estimateFaces(pixels, {
        flipHorizontal: false,
        staticImageMode: false,
      });
    } finally {
      pixels.dispose();
    }
    const face = faces[0];
    if (!face) return null;
    const landmarks = keypointsToLandmarks(face.keypoints, width, height);
    return landmarks ? { landmarks, score: null } : null;
  }

  dispose(): void {
    this.#disposed = true;
    this.#detector?.dispose();
    this.#detector = null;
  }

  async #load(): Promise<void> {
    // Resolve (and origin-check) every URL before anything is downloaded.
    const detectorModelUrl = resolveSameOriginAsset(
      this.#modelBaseUrl,
      FACEMESH_ASSET_PATHS.detector,
    );
    const landmarkModelUrl = resolveSameOriginAsset(
      this.#modelBaseUrl,
      FACEMESH_ASSET_PATHS.landmarks,
    );
    const wasmPrefix = resolveSameOriginAsset(this.#wasmBaseUrl, './');

    const [tf, , wasm, fld] = await Promise.all([
      import('@tensorflow/tfjs-core'),
      import('@tensorflow/tfjs-backend-webgl'),
      import('@tensorflow/tfjs-backend-wasm'),
      import('@tensorflow-models/face-landmarks-detection'),
    ]);
    // Must precede the first setBackend('wasm'); the binaries are served by us.
    wasm.setWasmPaths(wasmPrefix);

    this.#tf = tf;
    this.#backend = await selectBackend(tf, this.#backends);

    const detector = await fld.createDetector(fld.SupportedModels.MediaPipeFaceMesh, {
      runtime: 'tfjs',
      refineLandmarks: true,
      maxFaces: 1,
      detectorModelUrl,
      landmarkModelUrl,
    });
    if (this.#disposed) {
      detector.dispose();
      return;
    }
    this.#detector = detector;
  }
}
