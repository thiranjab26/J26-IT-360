import { describe, expect, it } from 'vitest';
import { MemoryGame, seeded, shuffle } from '../../../src/demo/break/memory-game.js';
import {
  ROUTINE,
  STRETCH_DEFAULTS,
  StretchSession,
  type Pose,
} from '../../../src/demo/break/stretch-session.js';

const STEP = 1000 / 15;
/** The learner's resting pose is not 0/0/0: the game must work relative to it. */
const NEUTRAL: Pose = { yaw: 4, pitch: -3, roll: 2 };

function feed(s: StretchSession, from: number, ms: number, pose: Pose | null, step = STEP): number {
  let t = from;
  for (; t < from + ms; t += step) s.update(t, pose);
  return t;
}

/** A fresh session that has already measured NEUTRAL; returns it and the time. */
function playing(targets = ROUTINE): { s: StretchSession; t: number } {
  const s = new StretchSession(targets);
  const t = feed(s, 0, STRETCH_DEFAULTS.neutralMs + 2 * STEP, NEUTRAL);
  return { s, t };
}

function only(i: number): (typeof ROUTINE)[number] {
  const target = ROUTINE[i];
  if (!target) throw new Error('routine is too short');
  return target;
}

function at(rel: Pose): Pose {
  return {
    yaw: NEUTRAL.yaw + rel.yaw,
    pitch: NEUTRAL.pitch + rel.pitch,
    roll: NEUTRAL.roll + rel.roll,
  };
}

describe('StretchSession (neck-stretch game)', () => {
  it('measures the neutral pose first, only while a face is visible', () => {
    const s = new StretchSession();
    const t = feed(s, 0, 2000, null);
    expect(s.state.phase).toBe('neutral');
    feed(s, t, STRETCH_DEFAULTS.neutralMs + 2 * STEP, NEUTRAL);
    expect(s.state.phase).toBe('playing');
    expect(s.state.pose?.yaw).toBeCloseTo(0, 6);
  });

  it('completes a target after holding it, measured from the neutral pose', () => {
    const s = new StretchSession();
    let t = feed(s, 0, STRETCH_DEFAULTS.neutralMs + 2 * STEP, NEUTRAL);
    const first = ROUTINE[0];
    if (!first) throw new Error('routine is empty');
    t = feed(s, t, STRETCH_DEFAULTS.holdMs - 300, at(first));
    expect(s.state.index).toBe(0);
    expect(s.state.hold).toBeGreaterThan(0.8);
    let completedAt: number | null = null;
    for (; t < 10_000 && completedAt === null; t += STEP) {
      if (s.update(t, at(first)).completed === 0) completedAt = t;
    }
    expect(completedAt).not.toBeNull();
    expect(s.state.index).toBe(1);
  });

  it('a short wobble off target is free; a longer one drains, never resets', () => {
    const { s, t: t0 } = playing();
    let t = feed(s, t0, 1500, at(only(0)));
    const before = s.state.hold;
    t = feed(s, t, 200, NEUTRAL); // 200 ms off: inside the grace period
    expect(s.state.hold).toBeCloseTo(before, 6);
    feed(s, t, 600, NEUTRAL); // longer: drains a little
    expect(s.state.hold).toBeGreaterThan(0);
    expect(s.state.hold).toBeLessThan(before);
  });

  it('turning further than the target still counts (reach, not bullseye)', () => {
    const { s, t } = playing([only(0)]);
    feed(s, t, STRETCH_DEFAULTS.holdMs + 300, at({ yaw: 35, pitch: 0, roll: 0 }));
    expect(s.state.phase).toBe('done');
  });

  it('a little short of the reach angle counts; well short does not', () => {
    const right = only(0);
    const near = playing([right]);
    feed(
      near.s,
      near.t,
      STRETCH_DEFAULTS.holdMs + 300,
      at({ yaw: right.yaw - 2, pitch: 0, roll: 0 }),
    );
    expect(near.s.state.phase).toBe('done');

    const far = playing([right]);
    feed(far.s, far.t, 6000, at({ yaw: right.yaw * 0.5, pitch: 0, roll: 0 }));
    expect(far.s.state.phase).toBe('playing');
    expect(far.s.state.reach).toBeGreaterThan(0.4);
    expect(far.s.state.reach).toBeLessThan(1);
  });

  it('the wrong direction, or far off to the side, never completes', () => {
    const right = only(0);
    const wrong = playing([right]);
    feed(wrong.s, wrong.t, 6000, at({ yaw: -right.yaw, pitch: 0, roll: 0 }));
    expect(wrong.s.state.phase).toBe('playing');
    expect(wrong.s.state.hold).toBe(0);

    const side = playing([right]);
    feed(side.s, side.t, 6000, at({ yaw: right.yaw, pitch: 16, roll: 0 }));
    expect(side.s.state.phase).toBe('playing');
  });

  it('holding near the edge does not flicker on and off (hysteresis)', () => {
    const right = only(0);
    const { s, t: t0 } = playing([right]);
    let t = feed(s, t0, 500, at({ yaw: right.yaw, pitch: 0, roll: 0 }));
    expect(s.state.onTarget).toBe(true);
    // Drift back to just under the entry threshold: still on.
    t = feed(
      s,
      t,
      500,
      at({ yaw: right.yaw - STRETCH_DEFAULTS.reachSlack - 1.5, pitch: 0, roll: 0 }),
    );
    expect(s.state.onTarget).toBe(true);
    // The same angle from off target is not enough to enter.
    feed(s, t, 1000, NEUTRAL);
    feed(
      s,
      t + 1000,
      300,
      at({ yaw: right.yaw - STRETCH_DEFAULTS.reachSlack - 1.5, pitch: 0, roll: 0 }),
    );
    expect(s.state.onTarget).toBe(false);
  });

  it('works on a slow laptop (4 fps face model)', () => {
    const slow = 250;
    const s = new StretchSession([only(0), only(1)]);
    let t = feed(s, 0, STRETCH_DEFAULTS.neutralMs + 2 * slow, NEUTRAL, slow);
    expect(s.state.phase).toBe('playing');
    t = feed(s, t, STRETCH_DEFAULTS.holdMs + 2 * slow, at(only(0)), slow);
    feed(s, t, STRETCH_DEFAULTS.holdMs + 2 * slow, at(only(1)), slow);
    expect(s.state.phase).toBe('done');
  });

  it('restarts the neutral measurement while the learner is still moving', () => {
    const s = new StretchSession();
    // Still settling: head swings by 12° every few frames.
    let t = 0;
    for (let i = 0; i < 30; i += 1, t += STEP) {
      s.update(t, { yaw: i % 6 < 3 ? 0 : 12, pitch: 0, roll: 0 });
    }
    expect(s.state.phase).toBe('neutral');
    feed(s, t, STRETCH_DEFAULTS.neutralMs + 2 * STEP, NEUTRAL);
    expect(s.state.phase).toBe('playing');
    // The neutral is the steady pose, not an average with the movement.
    expect(s.state.pose?.yaw).toBeCloseTo(0, 6);
  });

  it('says "face lost" only after a real loss, not a missed frame', () => {
    const { s, t: t0 } = playing();
    const t = feed(s, t0, 300, null);
    expect(s.state.faceLost).toBe(false);
    feed(s, t, 600, null);
    expect(s.state.faceLost).toBe(true);
  });

  it('a tilt target needs the roll angle, not a head turn', () => {
    const tilt = ROUTINE.find((r) => r.kind === 'tilt');
    if (!tilt) throw new Error('no tilt target');
    const s = new StretchSession([tilt]);
    let t = feed(s, 0, STRETCH_DEFAULTS.neutralMs + 2 * STEP, NEUTRAL);
    t = feed(s, t, 4000, at({ yaw: 20, pitch: 0, roll: 0 }));
    expect(s.state.hold).toBe(0);
    expect(s.state.phase).toBe('playing');
    feed(s, t, STRETCH_DEFAULTS.holdMs + 300, at({ yaw: 0, pitch: 0, roll: tilt.roll }));
    expect(s.state.phase).toBe('done');
  });

  it('frame gaps and lost faces never count as hold time', () => {
    const s = new StretchSession();
    const t = feed(s, 0, STRETCH_DEFAULTS.neutralMs + 2 * STEP, NEUTRAL);
    const first = ROUTINE[0];
    if (!first) throw new Error('routine is empty');
    s.update(t, at(first));
    s.update(t + 60_000, at(first)); // tab was hidden for a minute
    expect(s.state.hold).toBeLessThan(0.1);
    feed(s, t + 60_000, 5000, null);
    expect(s.state.index).toBe(0);
  });

  it('finishes the full routine', () => {
    const s = new StretchSession();
    let t = feed(s, 0, STRETCH_DEFAULTS.neutralMs + 2 * STEP, NEUTRAL);
    for (const target of ROUTINE) {
      t = feed(s, t, STRETCH_DEFAULTS.holdMs + 200, at(target));
    }
    expect(s.state.phase).toBe('done');
    expect(s.state.index).toBe(ROUTINE.length);
  });
});

describe('MemoryGame', () => {
  it('deals each face exactly twice', () => {
    const g = new MemoryGame(8, seeded(1));
    const counts = new Map<number, number>();
    for (const c of g.cards) counts.set(c.face, (counts.get(c.face) ?? 0) + 1);
    expect(counts.size).toBe(8);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
  });

  it('shuffles reproducibly with a seed and differently with another', () => {
    const a = new MemoryGame(8, seeded(7)).cards.map((c) => c.face);
    const b = new MemoryGame(8, seeded(7)).cards.map((c) => c.face);
    const c = new MemoryGame(8, seeded(8)).cards.map((x) => x.face);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('keeps a pair, turns back a non-pair, and counts moves', () => {
    const g = new MemoryGame(3, seeded(3));
    const faces = g.cards.map((c) => c.face);
    const a = 0;
    const pair = faces.indexOf(faces[a] ?? -1, a + 1);
    const other = faces.findIndex((f) => f !== faces[a]);

    expect(g.flip(a).kind).toBe('first');
    expect(g.flip(other).kind).toBe('mismatch');
    expect(g.moves).toBe(1);
    expect(g.hideMismatch().sort()).toEqual([a, other].sort());

    expect(g.flip(a).kind).toBe('first');
    const r = g.flip(pair);
    expect(r.kind).toBe('match');
    expect(g.cards[a]?.state).toBe('matched');
    expect(g.moves).toBe(2);
  });

  it('flipping a third card turns a showing non-pair back at once', () => {
    const g = new MemoryGame(3, seeded(5));
    const faces = g.cards.map((c) => c.face);
    const a = 0;
    const b = faces.findIndex((f) => f !== faces[a]);
    const c = g.cards.findIndex((_, i) => i !== a && i !== b);
    g.flip(a);
    g.flip(b);
    const r = g.flip(c);
    expect(r.kind).toBe('first');
    if (r.kind === 'first') expect([...r.hidden].sort()).toEqual([a, b].sort());
    expect(g.cards[a]?.state).toBe('down');
  });

  it('clicking a card of the showing non-pair makes it the new first pick', () => {
    const g = new MemoryGame(3, seeded(5));
    const faces = g.cards.map((c) => c.face);
    const a = 0;
    const b = faces.findIndex((f) => f !== faces[a]);
    g.flip(a);
    g.flip(b);
    const r = g.flip(b);
    expect(r.kind).toBe('first');
    if (r.kind === 'first') expect([...r.hidden].sort()).toEqual([a, b].sort());
    expect(g.cards[a]?.state).toBe('down');
    expect(g.cards[b]?.state).toBe('up');
  });

  it('ignores matched and face-up cards and reports the win', () => {
    const g = new MemoryGame(2, seeded(9));
    const byFace = new Map<number, number[]>();
    g.cards.forEach((c, i) => byFace.set(c.face, [...(byFace.get(c.face) ?? []), i]));
    let last = null as ReturnType<MemoryGame['flip']> | null;
    for (const [x, y] of byFace.values()) {
      if (x === undefined || y === undefined) continue;
      expect(g.flip(x).kind).toBe('first');
      expect(g.flip(x).kind).toBe('ignored');
      last = g.flip(y);
    }
    expect(last?.kind).toBe('match');
    if (last?.kind === 'match') expect(last.won).toBe(true);
    expect(g.won).toBe(true);
    expect(g.moves).toBe(2);
  });

  it('shuffle keeps every item', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    shuffle(items, seeded(2));
    expect([...items].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
