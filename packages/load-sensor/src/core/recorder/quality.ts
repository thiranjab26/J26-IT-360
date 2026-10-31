import { COLUMN, type BlockKind } from './session.js';

/**
 * Session quality summary (TODO B1), shown at the end of a session so a bad
 * recording is caught while the participant is still there.
 *
 * The bands below are sanity limits for "the recording worked", not research
 * results, and not tuned on any data: **(tune)** after the dry runs (B2).
 */
export const QUALITY_LIMITS = {
  /** Below this the 15 fps pipeline is starved; blink detection needs a few frames per blink. */
  minFps: 10,
  /** A block where the face was found in fewer frames than this has too many invalid seconds. */
  minFaceRatio: 0.8,
  /**
   * Blinks per minute. Spontaneous blinking at rest is commonly reported around
   * 15–20 /min and drops during reading or screen work; 2 and 50 are far
   * outside both, so a value there more likely means a detection problem.
   */
  minBlinksPerMin: 2,
  maxBlinksPerMin: 50,
} as const;

export interface BlockQuality {
  readonly index: number;
  readonly kind: BlockKind;
  readonly frames: number;
  readonly seconds: number;
  readonly fps: number;
  readonly faceRatio: number;
  readonly blinks: number;
  readonly blinksPerMin: number;
  readonly warnings: readonly string[];
}

export interface SessionQuality {
  readonly blocks: readonly BlockQuality[];
  readonly ok: boolean;
}

export function sessionQuality(
  blocks: readonly { readonly index: number; readonly kind: BlockKind }[],
  frames: readonly (readonly number[])[],
): SessionQuality {
  const out = blocks.map((b) => {
    const rows = frames.filter((r) => r[COLUMN.block] === b.index);
    const first = rows[0]?.[COLUMN.t] ?? 0;
    const last = rows[rows.length - 1]?.[COLUMN.t] ?? 0;
    const seconds = Math.max(0, (last - first) / 1000);
    const faces = rows.filter((r) => r[COLUMN.face] === 1).length;
    const blinks = rows.filter((r) => r[COLUMN.closure] === 1).length;
    const fps = seconds > 0 ? (rows.length - 1) / seconds : 0;
    const faceRatio = rows.length > 0 ? faces / rows.length : 0;
    // Per minute of face time: blinks cannot be seen while the face is lost.
    const faceMinutes = (seconds * faceRatio) / 60;
    const blinksPerMin = faceMinutes > 0 ? blinks / faceMinutes : 0;

    const L = QUALITY_LIMITS;
    const warnings: string[] = [];
    if (rows.length === 0) warnings.push('no frames recorded');
    else {
      if (fps < L.minFps) warnings.push(`low frame rate (${fps.toFixed(1)} fps)`);
      if (faceRatio < L.minFaceRatio) {
        warnings.push(`face found in only ${(faceRatio * 100).toFixed(0)} % of frames`);
      }
      if (blinksPerMin < L.minBlinksPerMin || blinksPerMin > L.maxBlinksPerMin) {
        warnings.push(`unusual blink rate (${blinksPerMin.toFixed(1)} /min)`);
      }
    }
    return {
      index: b.index,
      kind: b.kind,
      frames: rows.length,
      seconds,
      fps,
      faceRatio,
      blinks,
      blinksPerMin,
      warnings,
    };
  });
  return { blocks: out, ok: out.every((b) => b.warnings.length === 0) };
}
