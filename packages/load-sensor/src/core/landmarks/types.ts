/**
 * Landmark provider interface (ARCHITECTURE.md §3). Adapter A is
 * `TfjsFaceMeshProvider`; adapter B (tasks-vision) will implement the same
 * interface so the two can be benchmarked on equal terms.
 */

/** Face mesh with iris refinement: 468 mesh points + 2 × 5 iris points. */
export const LANDMARK_COUNT = 478;

/** Values per landmark in `FaceResult.landmarks`: x, y, z. */
export const LANDMARK_STRIDE = 3;

/** What a provider can read a frame from. Kept narrow so frames stay in camera/ and landmarks/. */
export type VideoFrameSource = HTMLVideoElement;

export interface HeadPose {
  /** Radians. */
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
}

export interface FaceResult {
  /**
   * 478 × 3 values, row-major `[x0, y0, z0, x1, …]`, in normalised image
   * coordinates: x and y in 0..1 of the frame width and height (unmirrored,
   * origin top-left); z in the same units as x (relative depth, smaller is
   * closer to the camera). Normalised so features do not depend on resolution.
   */
  readonly landmarks: Float32Array;
  /** Only if the provider computes it (adapter B); adapter A leaves it to features/. */
  readonly headPose?: HeadPose;
  /** Only if the provider computes it (adapter B blendshapes). */
  readonly blendshapes?: Readonly<Record<string, number>>;
  /**
   * Face presence confidence 0..1, or null when the provider does not expose
   * one. Adapter A returns null: the tfjs face mesh applies its own presence
   * threshold internally and only returns faces that pass it, without the score.
   */
  readonly score: number | null;
}

export interface LandmarkProvider {
  /** Stable identifier recorded with benchmark results, e.g. `tfjs-facemesh`. */
  readonly name: string;
  /** Inference backend in use after `init()`, e.g. `webgl`; null before. */
  readonly backend: string | null;
  /**
   * Loads self-hosted model assets and prepares the backend. Rejects with
   * `UnsupportedBackendError` when no acceptable backend is available.
   */
  init(): Promise<void>;
  /**
   * Estimates landmarks for one frame. Resolves null when no face is found.
   * `tMs` is the frame timestamp, passed so stateful providers can track
   * across frames without reading a clock.
   */
  estimate(frame: VideoFrameSource, tMs: number): Promise<FaceResult | null>;
  /** Releases models and GPU memory. The provider cannot be used afterwards. */
  dispose(): void;
}
