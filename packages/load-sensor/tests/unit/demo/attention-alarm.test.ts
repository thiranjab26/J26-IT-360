import { describe, expect, it } from 'vitest';
import { ATTENTION_DEFAULTS, AttentionMonitor } from '../../../src/demo/attention-alarm.js';

const FPS = 15;
const STEP = 1000 / FPS;

/** Feeds `seconds` of frames produced by `frame(tMs)` and returns the last reason. */
function run(
  m: AttentionMonitor,
  startMs: number,
  seconds: number,
  frame: (tMs: number) => { faceFound: boolean; eyesClosed: boolean },
): { reason: string | null; endMs: number; firstAlarmMs: number | null } {
  let t = startMs;
  let firstAlarmMs: number | null = null;
  const end = startMs + seconds * 1000;
  while (t < end) {
    const s = m.update({ tMs: t, ...frame(t) });
    if (s.reason && firstAlarmMs === null) firstAlarmMs = t;
    t += STEP;
  }
  return { reason: m.state.reason, endMs: t, firstAlarmMs };
}

const open = { faceFound: true, eyesClosed: false };
const closed = { faceFound: true, eyesClosed: true };
const noFace = { faceFound: false, eyesClosed: false };

describe('AttentionMonitor (demo away / asleep alarm)', () => {
  it('stays quiet for a normal face with blinks', () => {
    const m = new AttentionMonitor();
    // A 200 ms blink every 4 s.
    const r = run(m, 0, 60, (t) => (t % 4000 < 200 ? closed : open));
    expect(r.firstAlarmMs).toBeNull();
  });

  it('does not alarm for a 2 s eye rest', () => {
    const m = new AttentionMonitor();
    run(m, 0, 5, () => open);
    const r = run(m, 5000, 2, () => closed);
    expect(r.reason).toBeNull();
  });

  it('alarms "asleep" after 3 s of closed eyes and stops once they reopen', () => {
    const m = new AttentionMonitor();
    run(m, 0, 5, () => open);
    const sleep = run(m, 5000, 4, () => closed);
    expect(sleep.reason).toBe('asleep');
    expect((sleep.firstAlarmMs ?? 0) - 5000).toBeGreaterThanOrEqual(ATTENTION_DEFAULTS.asleepMs);
    expect((sleep.firstAlarmMs ?? 0) - 5000).toBeLessThan(ATTENTION_DEFAULTS.asleepMs + STEP);
    const wake = run(m, sleep.endMs, 0.5, () => open);
    expect(wake.reason).toBeNull();
  });

  it('ignores a one-frame EAR flicker while the eyes stay closed', () => {
    const m = new AttentionMonitor();
    run(m, 0, 2, () => open);
    let i = 0;
    // Closed, with a single "open" frame every second (noise near the threshold).
    const r = run(m, 2000, 4, () => (i++ % FPS === 7 ? open : closed));
    expect(r.reason).toBe('asleep');
  });

  it('alarms "absent" after 5 s without a face and stops when the face is back', () => {
    const m = new AttentionMonitor();
    run(m, 0, 3, () => open);
    const away = run(m, 3000, 4.5, () => noFace);
    expect(away.reason).toBeNull();
    const longer = run(m, away.endMs, 1, () => noFace);
    expect(longer.reason).toBe('absent');
    const back = run(m, longer.endMs, 0.2, () => open);
    expect(back.reason).toBeNull();
  });

  it('treats a head drop with closed eyes as absent once the face is lost long enough', () => {
    const m = new AttentionMonitor();
    run(m, 0, 2, () => open);
    run(m, 2000, 1, () => closed);
    const r = run(m, 3000, 6, () => noFace);
    expect(r.reason).toBe('absent');
  });

  it('reset clears running timers (e.g. after a pause)', () => {
    const m = new AttentionMonitor();
    run(m, 0, 4, () => noFace);
    m.reset();
    const r = run(m, 10_000, 2, () => noFace);
    expect(r.reason).toBeNull();
  });
});
