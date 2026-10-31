import { FEATURE_INDEX, type FrameSignals } from '../features/index.js';
import type { BoredomReading, OverloadReading } from '../heuristics/index.js';
import type { NormalisedSecond } from '../window/index.js';
import {
  EXTRAS_KIND,
  EXTRAS_VERSION,
  type ExtraSignalsEvent,
  type ExtrasMood,
  type ExtrasMoodSource,
} from './extras.js';
import type { LoadSensorStatus } from './types.js';

export interface ExtrasBuildInput {
  readonly status: LoadSensorStatus;
  /** null when there is no mood reading (no face, or a host without the demo's mood estimator). */
  readonly mood: ExtrasMood | null;
  readonly moodSource: ExtrasMoodSource | null;
  readonly boredom: BoredomReading;
  readonly overload: OverloadReading;
  /** Signals of the latest landmark frame; null if it had no face. */
  readonly frame: FrameSignals | null;
  readonly second: NormalisedSecond;
  readonly now: Date;
}

/** Rounds for the wire: consumers need no more, and the JSON stays readable. */
const round = (v: number, digits: number): number => Number(v.toFixed(digits));

/**
 * One extras event from the readings computed this second. Shared by
 * createLoadSensor() and the demo page, so both publish identical events.
 * Pure, so it is unit-tested without a camera.
 */
export function buildExtrasEvent(input: ExtrasBuildInput): ExtraSignalsEvent {
  const { second, frame } = input;
  const raw = (name: keyof typeof FEATURE_INDEX, digits: number): number | null =>
    second.valid ? round(second.raw[FEATURE_INDEX[name]] ?? 0, digits) : null;
  return {
    kind: EXTRAS_KIND,
    extras_version: EXTRAS_VERSION,
    timestamp: input.now.toISOString(),
    status: input.status,
    mood: input.mood,
    mood_source: input.mood === null ? null : input.moodSource,
    boredom: input.boredom.state,
    overload: input.overload.state,
    head_yaw_deg: frame ? round(frame.yaw, 1) : null,
    head_pitch_deg: frame ? round(frame.pitch, 1) : null,
    head_roll_deg: frame ? round(frame.roll, 1) : null,
    blinks_last_second: raw('blink_count', 0),
    eyes_closed_fraction: raw('eyes_closed_fraction', 3),
    gaze_centred_fraction: raw('gaze_centred_fraction', 3),
  };
}
