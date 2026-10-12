import { describe, expect, it } from 'vitest';
import {
  HABIT_DEFAULT_REASON,
  pickHabit,
  type HabitSignals,
} from '../../../src/demo/wellbeing-panel.js';

const calm: HabitSignals = {
  presence: 'present',
  engagement: null,
  fatigue: null,
  frustration: null,
  strain: null,
};

describe('healthy study habit (one at a time, from engagement)', () => {
  it('follows engagement: Low → posture, Medium → stretch, High → blink', () => {
    expect(pickHabit({ ...calm, engagement: 'Low' }, null, 0).id).toBe('posture');
    expect(pickHabit({ ...calm, engagement: 'Medium' }, null, 0).id).toBe('stretch');
    expect(pickHabit({ ...calm, engagement: 'High' }, null, 0).id).toBe('blink');
  });

  it('puts tiredness and frustration ahead of engagement', () => {
    expect(pickHabit({ ...calm, engagement: 'High', fatigue: 'High' }, null, 0).id).toBe('walk');
    expect(pickHabit({ ...calm, engagement: 'High', frustration: true }, null, 0).id).toBe(
      'breathe',
    );
    expect(pickHabit({ ...calm, engagement: 'Low', strain: 'High' }, null, 0).id).toBe('eyes');
  });

  it('names the signal in the reason', () => {
    expect(pickHabit({ ...calm, engagement: 'Low' }, null, 0).reason).toContain('engagement Low');
  });

  it('never repeats the featured tip; falls through to the next rule', () => {
    const s: HabitSignals = { ...calm, fatigue: 'High', engagement: 'Low' };
    expect(pickHabit(s, 'walk', 0).id).toBe('posture');
  });

  it('rotates when the face is not present or no signal is known', () => {
    const away = pickHabit({ ...calm, presence: 'absent', engagement: 'Low' }, null, 2);
    expect(away.reason).toBe(HABIT_DEFAULT_REASON);
    const off = pickHabit(null, null, 2);
    expect(off).toEqual(away);
    expect(pickHabit(null, null, 3).id).not.toBe(off.id);
  });

  it('rotation skips the featured tip', () => {
    const first = pickHabit(null, null, 0).id;
    expect(pickHabit(null, first, 0).id).not.toBe(first);
  });
});
