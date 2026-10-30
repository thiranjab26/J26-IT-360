import {
  EXTRAS_KIND,
  EXTRAS_VERSION,
  type ExtraSignalsEvent,
  type LoadSensorStatus,
} from '../core/events/index.js';
import { FEATURE_INDEX, type FrameSignals } from '../core/features/index.js';
import type { BoredomReading, OverloadReading } from '../core/heuristics/index.js';
import type { NormalisedSecond } from '../core/window/index.js';
import type { MoodReading } from './mood.js';

export interface ExtrasInput {
  readonly status: LoadSensorStatus;
  readonly mood: MoodReading;
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
 * One extras event from the readings the demo already computed this second
 * (src/core/events/extras.ts). Pure, so it is unit-tested without a camera.
 */
export function buildExtrasEvent(input: ExtrasInput): ExtraSignalsEvent {
  const { mood, second, frame } = input;
  const moodValue = mood.mood === 'no-face' ? null : mood.mood;
  const raw = (name: keyof typeof FEATURE_INDEX, digits: number): number | null =>
    second.valid ? round(second.raw[FEATURE_INDEX[name]] ?? 0, digits) : null;
  return {
    kind: EXTRAS_KIND,
    extras_version: EXTRAS_VERSION,
    timestamp: input.now.toISOString(),
    status: input.status,
    mood: moodValue,
    mood_source: moodValue !== null && mood.expression ? mood.source : null,
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
