import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  LIMITS,
  mergeSettings,
  sanitizeSettings,
} from '../../../src/demo/settings.js';

describe('demo settings (admin panel)', () => {
  it('falls back to defaults for missing or malformed input', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ alarm: { enabled: 'yes', absentS: Number.NaN } })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('clamps numbers to their limits and snaps them to the step', () => {
    const s = sanitizeSettings({
      sensing: { targetFps: 999 },
      alarm: { asleepS: 0.2, volume: 42 },
      wellbeing: { eyeBreakMin: 23 },
    });
    expect(s.sensing.targetFps).toBe(LIMITS.targetFps.max);
    // The floor stays above the longest blink (500 ms), so a blink never trips the alarm.
    expect(s.alarm.asleepS).toBe(LIMITS.asleepS.min);
    expect(s.alarm.asleepS * 1000).toBeGreaterThan(500);
    expect(s.alarm.volume).toBe(40);
    expect(s.wellbeing.eyeBreakMin).toBe(25);
  });

  it('merges a partial patch without touching other values', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { alarm: { enabled: false } });
    expect(s.alarm).toEqual({ ...DEFAULT_SETTINGS.alarm, enabled: false });
    expect(s.sensing).toEqual(DEFAULT_SETTINGS.sensing);
    expect(s.wellbeing).toEqual(DEFAULT_SETTINGS.wellbeing);
  });

  it('keeps defaults inside their own limits', () => {
    expect(sanitizeSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});
