import type { Level } from '../events/types.js';
import { HEURISTIC_CONFIG } from './config.js';

/**
 * Today's accumulated totals behind `strain` (§8a). Derived numbers only:
 * never frames, landmarks or features. Kept on this device; one day at a time.
 */
export interface DayTotals {
  /** Local calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  /** Seconds of valid sensing today (face present): time on task. */
  readonly onTaskS: number;
  /** Seconds at published High load today. */
  readonly highLoadS: number;
  /** Seconds at fatigue High today. */
  readonly fatigueHighS: number;
  /** Seconds on task since the last break. */
  readonly sinceBreakS: number;
  /** Wall clock (ms since epoch) of the last update; a long gap counts as a break. */
  readonly updatedAtMs: number;
}

/** The part of `Storage` used, so tests can pass a double. */
export type StrainStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const STRAIN_STORAGE_KEY = 'adaptlearn.c2.strain.v1';

/** `localStorage` if this page may use it, else null (private mode, blocked storage). */
export function defaultStrainStorage(): StrainStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // accessing localStorage itself throws when site data is blocked
  }
}

export interface StrainInput {
  /** The second had a face (counts as time on task). */
  readonly valid: boolean;
  /** Published load and fatigue this second (null when unknown). */
  readonly load: Level | null;
  readonly fatigue: Level | null;
}

export interface StrainResult {
  readonly strain: Level;
  readonly suggestBreak: boolean;
}

export interface StrainTrackerOptions {
  /** null = keep totals in memory only. Default: `defaultStrainStorage()`. */
  readonly storage?: StrainStorage | null;
  /** Wall clock, ms since epoch (default `Date.now`). Only for the day boundary and break gaps. */
  readonly now?: () => number;
}

/**
 * `strain` and `suggest_break` (§8a): how worn out is the learner today?
 * Points from time on task, time at High load, time since the last break and
 * time at fatigue High; see HEURISTIC_CONFIG.strain.
 *
 * Fed once per second of the feature pipeline while sensing. Totals survive a
 * page reload (same day) through `storage`; a new local day starts from zero
 * and overwrites the stored day, so at most one day is ever kept. Limitation:
 * time with sensing off is not seen, so strain under-reports for learners who
 * study with the camera off.
 */
export class StrainTracker {
  readonly #cfg = HEURISTIC_CONFIG.strain;
  readonly #storage: StrainStorage | null;
  readonly #now: () => number;
  #totals: DayTotals;
  #absentRunS = 0;
  #fatigueHighRunS = 0;
  #lastSaveMs = Number.NEGATIVE_INFINITY;

  constructor(options: StrainTrackerOptions = {}) {
    this.#storage = options.storage === undefined ? defaultStrainStorage() : options.storage;
    this.#now = options.now ?? (() => Date.now());
    this.#totals = emptyDay(this.#now());
  }

  get totals(): DayTotals {
    return this.#totals;
  }

  /**
   * Call when sensing starts. Loads today's totals; if sensing was off for
   * longer than `breakAfterAbsentMs`, that gap counts as a break.
   */
  begin(): void {
    const now = this.#now();
    const stored = this.#load();
    const base = stored?.date === localDate(now) ? stored : this.#sameDay(now);
    const gap = now - base.updatedAtMs;
    this.#totals = {
      ...base,
      sinceBreakS: gap >= this.#cfg.breakAfterAbsentMs ? 0 : base.sinceBreakS,
      updatedAtMs: now,
    };
    this.#absentRunS = 0;
    this.#fatigueHighRunS = 0;
  }

  update(input: StrainInput): StrainResult {
    const now = this.#now();
    const t = this.#sameDay(now);
    let { onTaskS, highLoadS, fatigueHighS, sinceBreakS } = t;

    if (input.valid) {
      onTaskS += 1;
      sinceBreakS += 1;
      this.#absentRunS = 0;
    } else {
      this.#absentRunS += 1;
      // Away from the camera long enough = a break.
      if (this.#absentRunS * 1000 >= this.#cfg.breakAfterAbsentMs) sinceBreakS = 0;
    }
    if (input.load === 'High') highLoadS += 1;
    if (input.fatigue === 'High') {
      fatigueHighS += 1;
      this.#fatigueHighRunS += 1;
    } else {
      this.#fatigueHighRunS = 0;
    }

    this.#totals = {
      date: t.date,
      onTaskS,
      highLoadS,
      fatigueHighS,
      sinceBreakS,
      updatedAtMs: now,
    };
    if (now - this.#lastSaveMs >= this.#cfg.saveEveryMs) this.flush();
    return this.result();
  }

  /** Current level and break advice without adding a second. */
  result(): StrainResult {
    const strain = strainLevel(this.#totals);
    return {
      strain,
      suggestBreak:
        strain === 'High' || this.#fatigueHighRunS >= this.#cfg.fatigueHighForBreakSeconds,
    };
  }

  /** The learner took a break (a game, a stretch, or the host app says so). */
  markBreak(): void {
    this.#totals = { ...this.#sameDay(this.#now()), sinceBreakS: 0 };
    this.#fatigueHighRunS = 0;
    this.flush();
  }

  /** Writes the totals now. Storage failures (quota, blocked) leave memory-only totals. */
  flush(): void {
    this.#lastSaveMs = this.#now();
    if (!this.#storage) return;
    try {
      this.#storage.setItem(STRAIN_STORAGE_KEY, JSON.stringify(this.#totals));
    } catch {
      // Not fatal: strain keeps working for this page's lifetime.
    }
  }

  /** Totals for the day containing `now`: the current ones, or a fresh day after midnight. */
  #sameDay(now: number): DayTotals {
    return this.#totals.date === localDate(now) ? this.#totals : emptyDay(now);
  }

  #load(): DayTotals | null {
    if (!this.#storage) return null;
    try {
      const text = this.#storage.getItem(STRAIN_STORAGE_KEY);
      if (text === null) return null;
      const parsed = parseTotals(JSON.parse(text));
      if (!parsed) this.#storage.removeItem(STRAIN_STORAGE_KEY);
      return parsed;
    } catch {
      return null;
    }
  }
}

export function strainLevel(t: DayTotals): Level {
  const c = HEURISTIC_CONFIG.strain;
  const minutes = (s: number): number => s / 60;
  const steps = (value: number, [one, two]: readonly number[]): number =>
    value >= (two ?? Infinity) ? 2 : value >= (one ?? Infinity) ? 1 : 0;

  const points =
    steps(minutes(t.onTaskS), c.onTaskMinutes) +
    steps(minutes(t.highLoadS), c.highLoadMinutes) +
    steps(minutes(t.sinceBreakS), c.sinceBreakMinutes) +
    (minutes(t.fatigueHighS) >= c.fatigueHighMinutes ? 1 : 0);
  if (points >= c.pointsHigh) return 'High';
  if (points >= c.pointsMedium) return 'Medium';
  return 'Low';
}

/** Local calendar date `YYYY-MM-DD`: a learner's "day" ends at their midnight, not UTC's. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function emptyDay(now: number): DayTotals {
  return {
    date: localDate(now),
    onTaskS: 0,
    highLoadS: 0,
    fatigueHighS: 0,
    sinceBreakS: 0,
    updatedAtMs: now,
  };
}

/** Accepts only the exact shape written by `flush`; anything else is discarded. */
function parseTotals(value: unknown): DayTotals | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const count = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  if (typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return null;
  if (![v.onTaskS, v.highLoadS, v.fatigueHighS, v.sinceBreakS, v.updatedAtMs].every(count)) {
    return null;
  }
  return {
    date: v.date,
    onTaskS: v.onTaskS as number,
    highLoadS: v.highLoadS as number,
    fatigueHighS: v.fatigueHighS as number,
    sinceBreakS: v.sinceBreakS as number,
    updatedAtMs: v.updatedAtMs as number,
  };
}
