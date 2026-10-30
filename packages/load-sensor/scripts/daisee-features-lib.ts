/**
 * P8.3: per-second feature vectors for one DAiSEE clip, computed by the app's
 * own FeaturePipeline (one source of truth; ARCHITECTURE.md §6), so a model
 * trained on them sees the same numbers as the app and the cognitive-load model.
 *
 * Decision 4 (TODO P8, 30 Oct): raw features, no per-person baseline: a clip
 * is 10 s and the pipeline's baseline needs 30 s. Each clip gets a fresh
 * pipeline, so nothing carries over between clips.
 */
import { FEATURE_COUNT } from '../src/core/features/index.js';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from '../src/core/landmarks/types.js';
import { FeaturePipeline, type NormalisedSecond } from '../src/core/window/index.js';

/** Seconds kept per clip. DAiSEE clips are 10 s; the few longer ones are cut to 10. */
export const CLIP_SECONDS = 10;

export interface ClipSeconds {
  /** CLIP_SECONDS × FEATURE_COUNT raw features, row per second (NaN for a second that never closed). */
  readonly raw: Float32Array;
  /** Fraction of each second's frames with a face (FR8 mask), CLIP_SECONDS values. */
  readonly validRatio: Float32Array;
}

/**
 * `landmarks` holds `frames` rows of 478 × 3 (NaN rows = no face), frame k at
 * k / fps seconds, as written by the video extractor. `aspect` = width / height.
 */
export function clipSeconds(
  landmarks: Float32Array,
  frames: number,
  fps: number,
  aspect: number,
): ClipSeconds {
  const perFrame = LANDMARK_COUNT * LANDMARK_STRIDE;
  if (landmarks.length !== frames * perFrame) {
    throw new Error(
      `expected ${String(frames * perFrame)} values, got ${String(landmarks.length)}`,
    );
  }
  const raw = new Float32Array(CLIP_SECONDS * FEATURE_COUNT).fill(NaN);
  const validRatio = new Float32Array(CLIP_SECONDS);
  const pipeline = new FeaturePipeline();
  pipeline.onSecond((s: NormalisedSecond) => {
    if (s.second >= CLIP_SECONDS) return;
    raw.set(s.raw, s.second * FEATURE_COUNT);
    validRatio[s.second] = s.validRatio;
  });
  for (let k = 0; k < frames; k += 1) {
    const row = landmarks.subarray(k * perFrame, (k + 1) * perFrame);
    pipeline.push((k / fps) * 1000, Number.isNaN(row[0]) ? null : row, aspect);
  }
  // A second closes when a frame of the next second arrives. One empty frame
  // at the 10 s mark closes second 9; it belongs to second 10, which is dropped.
  pipeline.push(CLIP_SECONDS * 1000, null, aspect);
  return { raw, validRatio };
}
