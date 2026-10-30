import { describe, expect, it } from 'vitest';
import { FEATURE_COUNT, FEATURE_INDEX as I } from '../../../src/core/features/index.js';
import { CLIP_SECONDS, clipSeconds } from '../../../scripts/daisee-features-lib.js';
import { blinkingEar, syntheticFace } from '../../fixtures/synthetic-face.js';

const FPS = 15;
const PER_FRAME = 478 * 3;

/** A 10 s clip at 15 fps as the video extractor writes it: NaN rows where there is no face. */
function clip(
  face: (tMs: number) => Parameters<typeof syntheticFace>[0] | null,
  frames = 150,
): Float32Array {
  const out = new Float32Array(frames * PER_FRAME).fill(NaN);
  for (let k = 0; k < frames; k += 1) {
    const p = face((k / FPS) * 1000);
    if (p) out.set(syntheticFace(p), k * PER_FRAME);
  }
  return out;
}

describe('clipSeconds (TODO P8.3)', () => {
  it('gives 10 per-second vectors from the app pipeline, closing the last second', () => {
    const blinks = [{ at: 2100, durationMs: 200 }];
    const r = clipSeconds(
      clip((t) => ({ ear: blinkingEar(t, blinks) })),
      150,
      FPS,
      4 / 3,
    );
    expect(r.raw).toHaveLength(CLIP_SECONDS * FEATURE_COUNT);
    expect(Array.from(r.raw).every(Number.isFinite)).toBe(true);
    expect(Array.from(r.validRatio)).toEqual(Array(CLIP_SECONDS).fill(1));
    const blinkCount = Array.from(
      { length: CLIP_SECONDS },
      (_, s) => r.raw[s * FEATURE_COUNT + I.blink_count] ?? 0,
    );
    expect(blinkCount.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('marks seconds without a face through validRatio (FR8 mask)', () => {
    const r = clipSeconds(
      clip((t) => (t >= 6000 && t < 7000 ? null : {})),
      150,
      FPS,
      4 / 3,
    );
    expect(r.validRatio[6]).toBe(0);
    expect(r.validRatio[5]).toBe(1);
    expect(r.validRatio[7]).toBe(1);
  });

  it('cuts a longer clip to 10 s and rejects a wrong-sized array', () => {
    const r = clipSeconds(
      clip(() => ({}), 157),
      157,
      FPS,
      4 / 3,
    );
    expect(r.validRatio).toHaveLength(CLIP_SECONDS);
    expect(() => clipSeconds(new Float32Array(10), 150, FPS, 4 / 3)).toThrow(/expected/);
  });
});
