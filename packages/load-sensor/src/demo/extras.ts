import { buildExtrasEvent as buildCore } from '../core/events/extras-builder.js';
import type { ExtraSignalsEvent, LoadSensorStatus } from '../core/events/index.js';
import type { FrameSignals } from '../core/features/index.js';
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

/**
 * One extras event from the readings the demo already computed this second
 * (src/core/events/extras.ts). The demo adds the mood, which only it computes;
 * everything else is built exactly as createLoadSensor() builds it.
 */
export function buildExtrasEvent(input: ExtrasInput): ExtraSignalsEvent {
  const { mood } = input;
  const moodValue = mood.mood === 'no-face' ? null : mood.mood;
  return buildCore({
    ...input,
    mood: moodValue,
    moodSource: moodValue !== null && mood.expression ? mood.source : null,
  });
}
