/**
 * Soft game sounds, synthesised with the Web Audio API: no audio files, nothing
 * fetched, works offline. Notes come from a C-major pentatonic scale, so any
 * sequence sounds calm. Quiet by design; a mute switch is in the Break header.
 */

export type SfxName = 'tap' | 'progress' | 'success' | 'match' | 'miss' | 'win';

/** Pentatonic note frequencies (Hz), C5 upwards. */
const C5 = 523.25;
const D5 = 587.33;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const C6 = 1046.5;

/** [frequency, start s, duration s] per note. */
const SOUNDS: Record<SfxName, readonly (readonly [number, number, number])[]> = {
  tap: [[G5, 0, 0.06]],
  progress: [[E5, 0, 0.05]],
  success: [
    [E5, 0, 0.12],
    [G5, 0.09, 0.12],
    [C6, 0.18, 0.22],
  ],
  match: [
    [G5, 0, 0.1],
    [C6, 0.08, 0.18],
  ],
  miss: [[D5 / 2, 0, 0.14]],
  win: [
    [C5, 0, 0.14],
    [E5, 0.11, 0.14],
    [G5, 0.22, 0.14],
    [A5, 0.33, 0.14],
    [C6, 0.44, 0.4],
  ],
};

const VOLUME = 0.12;
const PREF_KEY = 'adaptlearn.c2.sfx';

export class Sfx {
  #ctx: AudioContext | null = null;
  #muted: boolean;
  readonly #listeners = new Set<(muted: boolean) => void>();

  constructor() {
    this.#muted = readPref() === 'off';
  }

  get muted(): boolean {
    return this.#muted;
  }

  set muted(value: boolean) {
    this.#muted = value;
    writePref(value ? 'off' : 'on');
    for (const l of this.#listeners) l(value);
  }

  /** Notified when muted changes, so every sound toggle on the page stays in sync. */
  onChange(listener: (muted: boolean) => void): void {
    this.#listeners.add(listener);
  }

  /** Call from a user gesture (browsers block audio until one). */
  unlock(): void {
    try {
      this.#ctx ??= new AudioContext();
      if (this.#ctx.state === 'suspended') void this.#ctx.resume();
    } catch {
      this.#ctx = null;
    }
  }

  play(name: SfxName): void {
    const ctx = this.#ctx;
    if (!ctx || this.#muted || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + 0.01;
    for (const [freq, at, dur] of SOUNDS[name]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      // Triangle is a little warmer than sine and still soft.
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(VOLUME, t0 + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.03);
    }
  }
}

function readPref(): string | null {
  try {
    return localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
}

function writePref(value: string): void {
  try {
    localStorage.setItem(PREF_KEY, value);
  } catch {
    // Storage blocked: the setting lasts for this visit only.
  }
}
