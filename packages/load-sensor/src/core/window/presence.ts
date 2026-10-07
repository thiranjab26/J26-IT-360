import { FEATURE_CONFIG } from '../features/config.js';

/**
 * - `present`: face visible and facing the screen.
 * - `away`: face visible but looking off-screen for longer than `awayAfterMs`.
 * - `absent`: no face for longer than `absentAfterMs`.
 * - `unknown`: no frames yet.
 */
export type Presence = 'present' | 'away' | 'absent' | 'unknown';

/**
 * Presence from per-frame face and off-screen flags, timed on the frame clock.
 * Short glances away or a face lost for a moment do not change the state:
 * both need to last before they count (ARCHITECTURE.md §8a).
 */
export class PresenceTracker {
  readonly #absentAfterMs: number;
  readonly #awayAfterMs: number;
  #lastFaceMs: number | null = null;
  #offScreenSinceMs: number | null = null;
  #state: Presence = 'unknown';

  constructor(
    absentAfterMs: number = FEATURE_CONFIG.presence.absentAfterMs,
    awayAfterMs: number = FEATURE_CONFIG.presence.awayAfterMs,
  ) {
    this.#absentAfterMs = absentAfterMs;
    this.#awayAfterMs = awayAfterMs;
  }

  get state(): Presence {
    return this.#state;
  }

  update(tMs: number, facePresent: boolean, offScreen: boolean): Presence {
    if (facePresent) {
      this.#lastFaceMs = tMs;
      if (offScreen) this.#offScreenSinceMs ??= tMs;
      else this.#offScreenSinceMs = null;
      const away =
        this.#offScreenSinceMs !== null && tMs - this.#offScreenSinceMs > this.#awayAfterMs;
      this.#state = away ? 'away' : 'present';
      return this.#state;
    }

    this.#offScreenSinceMs = null;
    if (this.#lastFaceMs === null) {
      this.#lastFaceMs = tMs;
      this.#state = 'unknown';
    } else if (tMs - this.#lastFaceMs > this.#absentAfterMs) {
      this.#state = 'absent';
    }
    // A face lost for less than absentAfterMs keeps the previous state.
    return this.#state;
  }

  reset(): void {
    this.#lastFaceMs = null;
    this.#offScreenSinceMs = null;
    this.#state = 'unknown';
  }
}
