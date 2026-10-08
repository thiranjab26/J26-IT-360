/**
 * Away / asleep alarm for the demo page.
 *
 * `AttentionMonitor` is pure: per-frame observations in, an alarm reason out,
 * timed on the frame clock. `AlarmSound` plays the beeps with the Web Audio
 * API (an oscillator: no sound file, nothing fetched, works offline).
 *
 * Demo feature, not part of the load-state model or the event contract. It
 * must stay out of study sessions: a beep is an intervention and would change
 * the workload being measured.
 */

export type AlarmReason = 'absent' | 'asleep';

export interface AttentionConfig {
  /**
   * No face for this long → `absent`. Presence already reads "absent" after
   * 2 s; the extra 3 s lets a learner reach for a cup or stretch without a beep.
   */
  readonly absentMs: number;
  /**
   * Eyes continuously closed for this long → `asleep`. A blink lasts at most
   * 500 ms (blink.ts) and resting the eyes for a moment is common, so 3 s is
   * well past both. Demo default chosen by hand, not validated on data.
   */
  readonly asleepMs: number;
  /**
   * Eyes must be open this long before a closure counts as over, so a
   * flicker of the EAR around the threshold does not reset the timer.
   */
  readonly reopenMs: number;
}

export const ATTENTION_DEFAULTS: AttentionConfig = {
  absentMs: 5000,
  asleepMs: 3000,
  reopenMs: 250,
};

export interface AttentionFrame {
  /** Frame-clock time (ms). */
  readonly tMs: number;
  readonly faceFound: boolean;
  /** EAR below the blink-closing threshold on this frame (always false before the open-eye reference exists). */
  readonly eyesClosed: boolean;
}

export interface AttentionState {
  readonly reason: AlarmReason | null;
  /** How long the current condition has lasted (ms), 0 when none. */
  readonly noFaceMs: number;
  readonly eyesClosedMs: number;
}

export class AttentionMonitor {
  readonly #cfg: AttentionConfig;
  #noFaceSince: number | null = null;
  #closedSince: number | null = null;
  #openSince: number | null = null;
  #state: AttentionState = { reason: null, noFaceMs: 0, eyesClosedMs: 0 };

  constructor(config: AttentionConfig = ATTENTION_DEFAULTS) {
    this.#cfg = config;
  }

  get state(): AttentionState {
    return this.#state;
  }

  update(f: AttentionFrame): AttentionState {
    if (!f.faceFound) {
      this.#noFaceSince ??= f.tMs;
      // Face lost with the eyes closed (head dropped): keep the closure
      // running, the absent timer covers it from here.
      this.#openSince = null;
    } else {
      this.#noFaceSince = null;
      if (f.eyesClosed) {
        this.#closedSince ??= f.tMs;
        this.#openSince = null;
      } else if (this.#closedSince !== null) {
        this.#openSince ??= f.tMs;
        if (f.tMs - this.#openSince >= this.#cfg.reopenMs) {
          this.#closedSince = null;
          this.#openSince = null;
        }
      }
    }

    const noFaceMs = this.#noFaceSince === null ? 0 : f.tMs - this.#noFaceSince;
    const eyesClosedMs = this.#closedSince === null || !f.faceFound ? 0 : f.tMs - this.#closedSince;
    const reason: AlarmReason | null =
      noFaceMs >= this.#cfg.absentMs
        ? 'absent'
        : eyesClosedMs >= this.#cfg.asleepMs
          ? 'asleep'
          : null;
    this.#state = { reason, noFaceMs, eyesClosedMs };
    return this.#state;
  }

  reset(): void {
    this.#noFaceSince = null;
    this.#closedSince = null;
    this.#openSince = null;
    this.#state = { reason: null, noFaceMs: 0, eyesClosedMs: 0 };
  }
}

/** Beep patterns: [frequency Hz, start offset s, duration s] per tone, repeated every `period` s. */
const PATTERNS: Record<AlarmReason, { period: number; tones: [number, number, number][] }> = {
  // Two falling tones: "come back".
  absent: {
    period: 1.6,
    tones: [
      [880, 0, 0.16],
      [660, 0.22, 0.2],
    ],
  },
  // Three quick high tones, more insistent: meant to wake someone up.
  asleep: {
    period: 1.1,
    tones: [
      [1320, 0, 0.1],
      [1320, 0.15, 0.1],
      [1760, 0.3, 0.14],
    ],
  },
};

/** Volume ramps from START to MAX over RAMP_S, so a sleeping learner is woken without a blast at first. */
const START_GAIN = 0.18;
const MAX_GAIN = 0.7;
const RAMP_S = 20;

/**
 * Plays the alarm until `stop()`. Browsers only allow audio after a user
 * gesture, so call `unlock()` from a click handler (the "Turn sensing on"
 * button) before the first alarm.
 */
export class AlarmSound {
  #ctx: AudioContext | null = null;
  #timer = 0;
  #reason: AlarmReason | null = null;
  #startedAt = 0;

  get playing(): AlarmReason | null {
    return this.#reason;
  }

  /** Creates or resumes the audio context. Call from a user gesture. */
  unlock(): void {
    try {
      this.#ctx ??= new AudioContext();
      if (this.#ctx.state === 'suspended') void this.#ctx.resume();
    } catch (error) {
      console.warn('Audio is not available; the alarm will be visual only', error);
    }
  }

  start(reason: AlarmReason): void {
    if (this.#reason === reason) return;
    this.stop();
    const ctx = this.#ctx;
    if (!ctx) return;
    this.#reason = reason;
    this.#startedAt = ctx.currentTime;
    const pattern = PATTERNS[reason];
    const play = (): void => {
      const elapsed = ctx.currentTime - this.#startedAt;
      const gain = START_GAIN + (MAX_GAIN - START_GAIN) * Math.min(1, elapsed / RAMP_S);
      this.#burst(ctx, pattern.tones, gain);
    };
    play();
    this.#timer = window.setInterval(play, pattern.period * 1000);
  }

  stop(): void {
    window.clearInterval(this.#timer);
    this.#timer = 0;
    this.#reason = null;
  }

  /** One short pattern, e.g. for a "Test sound" button. Call from a user gesture. */
  test(reason: AlarmReason = 'absent'): void {
    this.unlock();
    if (this.#ctx) this.#burst(this.#ctx, PATTERNS[reason].tones, START_GAIN * 1.5);
  }

  #burst(ctx: AudioContext, tones: readonly [number, number, number][], gain: number): void {
    const t0 = ctx.currentTime + 0.02;
    for (const [freq, offset, dur] of tones) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // 10 ms attack and exponential release: no clicks at the edges.
      env.gain.setValueAtTime(0.0001, t0 + offset);
      env.gain.exponentialRampToValueAtTime(gain, t0 + offset + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + dur);
      osc.connect(env).connect(ctx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + dur + 0.02);
    }
  }
}
