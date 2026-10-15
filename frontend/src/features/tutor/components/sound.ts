import { useSyncExternalStore } from 'react';

/**
 * Tiny game sounds made with the browser's own audio synth, so there are no sound files to
 * ship or load. Off until the student turns it on (the speaker in the header), and the choice
 * is remembered. Every call is safe on a browser without audio: it just stays silent.
 */
const KEY = 'adaptlearn-sound';

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

let enabled = readStored();
const listeners = new Set<() => void>();
let context: AudioContext | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* the choice just will not be remembered */
  }
  listeners.forEach((listener) => listener());
  if (on) playCue('tap');
}

export function useSoundEnabled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => enabled,
    () => false,
  );
}

export type Cue = 'tap' | 'run' | 'correct' | 'wrong' | 'xp' | 'levelup' | 'clear';

/** [frequency Hz, start s, length s, wave, loudness] */
type Note = [number, number, number, OscillatorType, number];

const CUES: Record<Cue, Note[]> = {
  tap: [[620, 0, 0.06, 'triangle', 0.12]],
  run: [
    [420, 0, 0.07, 'square', 0.07],
    [560, 0.07, 0.09, 'square', 0.07],
  ],
  correct: [
    [523, 0, 0.12, 'triangle', 0.2],
    [659, 0.1, 0.12, 'triangle', 0.2],
    [784, 0.2, 0.22, 'triangle', 0.2],
  ],
  wrong: [
    [220, 0, 0.16, 'sawtooth', 0.12],
    [165, 0.14, 0.26, 'sawtooth', 0.12],
  ],
  xp: [
    [988, 0, 0.07, 'square', 0.08],
    [1319, 0.07, 0.2, 'square', 0.08],
  ],
  levelup: [
    [523, 0, 0.12, 'triangle', 0.22],
    [659, 0.11, 0.12, 'triangle', 0.22],
    [784, 0.22, 0.12, 'triangle', 0.22],
    [1047, 0.33, 0.12, 'triangle', 0.22],
    [1319, 0.44, 0.4, 'triangle', 0.22],
  ],
  clear: [
    [392, 0, 0.14, 'square', 0.1],
    [523, 0.14, 0.14, 'square', 0.1],
    [659, 0.28, 0.14, 'square', 0.1],
    [784, 0.42, 0.14, 'square', 0.1],
    [1047, 0.56, 0.5, 'square', 0.1],
  ],
};

export function playCue(cue: Cue): void {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return;
    context ??= new Audio();
    if (context.state === 'suspended') void context.resume();
    const now = context.currentTime;
    for (const [frequency, start, length, wave, loudness] of CUES[cue]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = wave;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(loudness, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + length);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + start);
      oscillator.stop(now + start + length + 0.02);
    }
  } catch {
    /* no audio on this device: stay silent */
  }
}
