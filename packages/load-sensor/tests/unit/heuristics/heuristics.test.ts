import { describe, expect, it } from 'vitest';
import { FEATURE_COUNT, FEATURE_INDEX as I } from '../../../src/core/features/index.js';
import {
  AffectEstimator,
  EngagementEstimator,
  FatigueEstimator,
  FrustrationEstimator,
  HEURISTIC_CONFIG,
  Rolling,
  STRAIN_STORAGE_KEY,
  StrainTracker,
  localDate,
  strainLevel,
  type HeuristicSecond,
  type StrainStorage,
} from '../../../src/core/heuristics/index.js';

type Named = Partial<Record<keyof typeof I, number>>;

function second(
  opts: {
    valid?: boolean;
    validRatio?: number;
    raw?: Named;
    z?: Named | null;
    aux?: Partial<HeuristicSecond['aux']>;
  } = {},
): HeuristicSecond {
  const vec = (named: Named): Float32Array => {
    const v = new Float32Array(FEATURE_COUNT);
    for (const [k, x] of Object.entries(named)) v[I[k as keyof typeof I]] = x;
    return v;
  };
  const valid = opts.valid ?? true;
  return {
    valid,
    validRatio: opts.validRatio ?? (valid ? 1 : 0),
    raw: vec(opts.raw ?? { gaze_centred_fraction: 1 }),
    z: opts.z === null ? null : vec(opts.z ?? {}),
    aux: {
      longClosures: 0,
      yawns: 0,
      nods: 0,
      offScreenFraction: 0,
      faceSize: 0.1,
      ...opts.aux,
    },
  };
}

const feed = <T>(n: number, fn: () => T): T => {
  let out!: T;
  for (let i = 0; i < n; i += 1) out = fn();
  return out;
};

describe('Rolling', () => {
  it('keeps the last N items in order', () => {
    const r = new Rolling<number>(3);
    for (let i = 1; i <= 5; i += 1) r.push(i);
    expect(r.last()).toEqual([3, 4, 5]);
    expect(r.last(2)).toEqual([4, 5]);
    r.clear();
    expect(r.last()).toEqual([]);
  });
});

describe('engagement heuristic (§7)', () => {
  it('High when present, facing the screen, gaze centred', () => {
    const e = new EngagementEstimator();
    expect(feed(30, () => e.update(second()))).toBe('High');
  });

  it('Low when looking away most of the time', () => {
    const e = new EngagementEstimator();
    const away = second({ raw: { gaze_centred_fraction: 0 }, aux: { offScreenFraction: 1 } });
    expect(feed(30, () => e.update(away))).toBe('Low');
  });

  it('Low when the face is missing (validRatio 0)', () => {
    const e = new EngagementEstimator();
    expect(feed(30, () => e.update(second({ valid: false })))).toBe('Low');
  });

  it('per-second score combines presence, on-screen and gaze-centred shares', () => {
    const s = second({
      validRatio: 0.8,
      raw: { gaze_centred_fraction: 0.5 },
      aux: { offScreenFraction: 0.5 },
    });
    expect(EngagementEstimator.secondScore(s)).toBeCloseTo(0.8 * (0.25 + 0.25), 6);
  });
});

describe('frustration heuristic (§7)', () => {
  const furrowed = second({ z: { brow_inner_gap_mean: -2 } });

  it('needs High load sustained for 15 s', () => {
    const f = new FrustrationEstimator();
    const n = HEURISTIC_CONFIG.frustration.sustainedHighSeconds;
    expect(feed(n - 1, () => f.update(furrowed, 'High'))).toBe(false);
    expect(f.update(furrowed, 'High')).toBe(true);
  });

  it('is false with High load but a relaxed face', () => {
    const f = new FrustrationEstimator();
    expect(feed(30, () => f.update(second(), 'High'))).toBe(false);
  });

  it('resets when load drops', () => {
    const f = new FrustrationEstimator();
    feed(20, () => f.update(furrowed, 'High'));
    expect(f.update(furrowed, 'Medium')).toBe(false);
    expect(f.update(furrowed, 'High')).toBe(false);
  });

  it('pressed lips count only with expression features on (FR3)', () => {
    const pressed = second({ z: { lip_thickness_mean: -2 } });
    expect(feed(20, () => new FrustrationEstimator(true)).update(pressed, 'High')).toBe(false);
    const on = new FrustrationEstimator(true);
    const off = new FrustrationEstimator(false);
    expect(feed(20, () => on.update(pressed, 'High'))).toBe(true);
    expect(feed(20, () => off.update(pressed, 'High'))).toBe(false);
  });
});

describe('fatigue heuristic (§8a)', () => {
  it('Low for an alert learner', () => {
    const f = new FatigueEstimator();
    expect(feed(120, () => f.update(second({ raw: { eyes_closed_fraction: 0.03 } })))).toBe('Low');
  });

  it('High when eyes are closed ≥ 15 % of the time and closures are long (PERCLOS)', () => {
    const f = new FatigueEstimator();
    let t = 0;
    const level = feed(60, () =>
      f.update(
        second({
          raw: { eyes_closed_fraction: 0.2 },
          aux: { longClosures: t++ % 20 === 0 ? 1 : 0 },
        }),
      ),
    );
    expect(f.points()).toBe(3);
    expect(level).toBe('High');
  });

  it('a single yawn is Medium, not High', () => {
    const f = new FatigueEstimator();
    feed(10, () => f.update(second()));
    f.update(second({ aux: { yawns: 1 } }));
    expect(feed(10, () => f.update(second()))).toBe('Medium');
  });

  it('yawns are forgotten after five minutes', () => {
    const f = new FatigueEstimator();
    f.update(second({ aux: { yawns: 1 } }));
    expect(
      feed(HEURISTIC_CONFIG.fatigue.eventSeconds + HEURISTIC_CONFIG.fatigue.confirm, () =>
        f.update(second()),
      ),
    ).toBe('Low');
  });

  it('PERCLOS ignores seconds without a face', () => {
    const f = new FatigueEstimator();
    feed(30, () => f.update(second({ raw: { eyes_closed_fraction: 0.02 } })));
    feed(30, () => f.update(second({ valid: false, raw: { eyes_closed_fraction: 1 } })));
    expect(f.points()).toBe(0);
  });
});

describe('affect heuristic (§8a)', () => {
  it('neutral at baseline', () => {
    const a = new AffectEstimator();
    expect(feed(10, () => a.update(second()))).toBe('neutral');
  });

  it('frustrated: brows together and lips pressed', () => {
    const a = new AffectEstimator();
    expect(
      feed(10, () =>
        a.update(second({ z: { brow_inner_gap_mean: -1.5, lip_thickness_mean: -1.5 } })),
      ),
    ).toBe('frustrated');
  });

  it('confused: brows together without pressed lips, or brows raised', () => {
    const a = new AffectEstimator();
    expect(feed(10, () => a.update(second({ z: { brow_inner_gap_mean: -1.5 } })))).toBe('confused');
    const b = new AffectEstimator();
    expect(feed(10, () => b.update(second({ z: { brow_raise_mean: 2 } })))).toBe('confused');
  });

  it('a 1 s twitch does not change the state (hysteresis)', () => {
    const a = new AffectEstimator();
    feed(10, () => a.update(second()));
    expect(a.update(second({ z: { brow_raise_mean: 20 } }))).toBe('neutral');
  });
});

class MemoryStorage implements StrainStorage {
  readonly map = new Map<string, string>();
  failWrites = false;
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.failWrites) throw new DOMException('full', 'QuotaExceededError');
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

describe('strain and suggest_break (§8a)', () => {
  const day = new Date(2026, 9, 10, 9, 0, 0).getTime(); // 10 Oct 2026, 09:00 local

  function tracker(storage: StrainStorage | null = new MemoryStorage(), start = day) {
    let now = start;
    const t = new StrainTracker({ storage, now: () => now });
    return {
      t,
      advance: (ms: number) => {
        now += ms;
      },
      seconds: (n: number, input: Partial<Parameters<StrainTracker['update']>[0]> = {}) => {
        let r = t.result();
        for (let i = 0; i < n; i += 1) {
          now += 1000;
          r = t.update({ valid: true, load: 'Medium', fatigue: 'Low', ...input });
        }
        return r;
      },
    };
  }

  it('starts Low and accumulates time on task', () => {
    const { t, seconds } = tracker();
    t.begin();
    expect(seconds(60).strain).toBe('Low');
    expect(t.totals.onTaskS).toBe(60);
    expect(t.totals.sinceBreakS).toBe(60);
  });

  it('Medium after 50 min without a break plus 30 min at High load', () => {
    const { t, seconds } = tracker();
    t.begin();
    seconds(50 * 60 - 30 * 60);
    expect(seconds(30 * 60, { load: 'High' }).strain).toBe('Medium');
  });

  it('High with a long day, much High load and no break → suggest_break', () => {
    expect(
      strainLevel({
        date: '2026-10-10',
        onTaskS: 5 * 3600,
        highLoadS: 3600,
        fatigueHighS: 0,
        sinceBreakS: 0,
        updatedAtMs: 0,
      }),
    ).toBe('High');
    const { t, seconds } = tracker();
    t.begin();
    const r = seconds(95 * 60, { load: 'High' });
    expect(r.strain).toBe('High');
    expect(r.suggestBreak).toBe(true);
  });

  it('suggests a break after fatigue High for 2 minutes even when strain is Low', () => {
    const { t, seconds } = tracker();
    t.begin();
    expect(seconds(119, { fatigue: 'High' }).suggestBreak).toBe(false);
    expect(seconds(1, { fatigue: 'High' }).suggestBreak).toBe(true);
  });

  it('markBreak resets time since the last break, not today’s totals', () => {
    const { t, seconds } = tracker();
    t.begin();
    seconds(600);
    t.markBreak();
    expect(t.totals.sinceBreakS).toBe(0);
    expect(t.totals.onTaskS).toBe(600);
  });

  it('5 minutes without a face counts as a break', () => {
    const { t, seconds } = tracker();
    t.begin();
    seconds(600);
    seconds(299, { valid: false });
    expect(t.totals.sinceBreakS).toBe(600);
    seconds(1, { valid: false });
    expect(t.totals.sinceBreakS).toBe(0);
  });

  it('persists today’s totals across a reload; a gap of 5+ min counts as a break', () => {
    const storage = new MemoryStorage();
    const a = tracker(storage);
    a.t.begin();
    a.seconds(1200);
    a.t.flush();

    const b = tracker(storage, day + 1200_000 + 60_000); // reloaded one minute later
    b.t.begin();
    expect(b.t.totals.onTaskS).toBe(1200);
    expect(b.t.totals.sinceBreakS).toBe(1200);

    const c = tracker(storage, day + 1200_000 + 10 * 60_000); // ten minutes later
    c.t.begin();
    expect(c.t.totals.onTaskS).toBe(1200);
    expect(c.t.totals.sinceBreakS).toBe(0);
  });

  it('stores only derived numbers and a date', () => {
    const storage = new MemoryStorage();
    const { t, seconds } = tracker(storage);
    t.begin();
    seconds(40);
    t.flush();
    const stored = JSON.parse(storage.map.get(STRAIN_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(Object.keys(stored).sort()).toEqual(
      ['date', 'fatigueHighS', 'highLoadS', 'onTaskS', 'sinceBreakS', 'updatedAtMs'].sort(),
    );
    expect(Object.values(stored).every((v) => typeof v === 'number' || typeof v === 'string')).toBe(
      true,
    );
  });

  it('a new local day starts from zero', () => {
    const storage = new MemoryStorage();
    const a = tracker(storage, new Date(2026, 9, 10, 23, 59, 0).getTime());
    a.t.begin();
    a.seconds(30);
    expect(a.t.totals.date).toBe('2026-10-10');
    a.seconds(60); // crosses local midnight
    expect(a.t.totals.date).toBe('2026-10-11');
    expect(a.t.totals.onTaskS).toBeLessThanOrEqual(60);

    const b = tracker(storage, new Date(2026, 9, 12, 8, 0, 0).getTime());
    b.t.begin();
    expect(b.t.totals.onTaskS).toBe(0);
  });

  it('discards corrupt stored totals', () => {
    const storage = new MemoryStorage();
    storage.map.set(STRAIN_STORAGE_KEY, JSON.stringify({ date: localDate(day), onTaskS: -5 }));
    const { t } = tracker(storage);
    t.begin();
    expect(t.totals.onTaskS).toBe(0);
    expect(storage.map.has(STRAIN_STORAGE_KEY)).toBe(false);

    storage.map.set(STRAIN_STORAGE_KEY, '{not json');
    tracker(storage).t.begin();
  });

  it('keeps working when storage fails or is unavailable', () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const a = tracker(storage);
    a.t.begin();
    expect(a.seconds(60).strain).toBe('Low');
    const b = tracker(null);
    b.t.begin();
    expect(b.seconds(60).strain).toBe('Low');
  });
});
