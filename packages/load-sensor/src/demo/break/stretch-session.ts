/**
 * Neck-stretch game logic: pure, timed on the frame clock, no DOM.
 *
 * The learner moves their head (pose relative to a neutral captured at the
 * start) towards a sequence of gentle targets and holds each one. A target is
 * a *reach* goal: "at least this far, in this direction". Turning further is
 * fine, as it is in a real stretch; only the direction and a minimum matter.
 * Angles are comfortable mobility ranges, well inside normal neck movement;
 * this is a break activity, not a clinical exercise.
 *
 * Landmark head pose tends to read lower than the true rotation (the mesh's
 * depth axis is compressed), so the reach angles below are deliberately
 * modest: what the sensor reports for a clear, comfortable movement. Chosen
 * by hand, not measured.
 *
 * Sign conventions follow head-pose.ts: yaw + = turn to own right,
 * pitch + = head down, roll + = tilt towards own left shoulder.
 */

export interface Pose {
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
}

export interface StretchTarget {
  /** `turn`: reach a yaw/pitch direction. `tilt`: reach a roll angle (ear towards shoulder). */
  readonly kind: 'turn' | 'tilt';
  /** Reach angles (degrees from neutral); the direction and the minimum to reach. */
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  /** Full instruction, shown while the target is active. */
  readonly label: string;
  /** Short name for the step list. */
  readonly short: string;
  /** Direction cue, picks the step icon. */
  readonly cue: StretchCue;
}

export type StretchCue =
  'right' | 'left' | 'up' | 'down' | 'tiltRight' | 'tiltLeft' | 'upRight' | 'downLeft';

/**
 * Default routine: 18° yaw, 11° up / 13° down, 11° ear-to-shoulder tilt,
 * diagonals in between. Order alternates sides so the neck is never held to
 * one side twice in a row.
 */
export const ROUTINE: readonly StretchTarget[] = [
  {
    kind: 'turn',
    yaw: 18,
    pitch: 0,
    roll: 0,
    label: 'Turn slowly to your right',
    short: 'Turn right',
    cue: 'right',
  },
  {
    kind: 'turn',
    yaw: -18,
    pitch: 0,
    roll: 0,
    label: 'Now to your left',
    short: 'Turn left',
    cue: 'left',
  },
  {
    kind: 'turn',
    yaw: 0,
    pitch: -11,
    roll: 0,
    label: 'Look gently up',
    short: 'Look up',
    cue: 'up',
  },
  {
    kind: 'turn',
    yaw: 0,
    pitch: 13,
    roll: 0,
    label: 'Chin down towards your chest',
    short: 'Chin down',
    cue: 'down',
  },
  {
    kind: 'tilt',
    yaw: 0,
    pitch: 0,
    roll: -11,
    label: 'Tilt your right ear to your shoulder',
    short: 'Tilt right',
    cue: 'tiltRight',
  },
  {
    kind: 'tilt',
    yaw: 0,
    pitch: 0,
    roll: 11,
    label: 'Tilt your left ear to your shoulder',
    short: 'Tilt left',
    cue: 'tiltLeft',
  },
  {
    kind: 'turn',
    yaw: 13,
    pitch: -8,
    roll: 0,
    label: 'Up and to the right',
    short: 'Up right',
    cue: 'upRight',
  },
  {
    kind: 'turn',
    yaw: -13,
    pitch: 9,
    roll: 0,
    label: 'Down and to the left',
    short: 'Down left',
    cue: 'downLeft',
  },
];

export interface StretchConfig {
  /** Steady time with a face in view used to measure the neutral pose. */
  readonly neutralMs: number;
  /**
   * During neutral capture, a sample further than this (degrees) from the
   * running median restarts the capture: the learner was still moving.
   */
  readonly neutralSteadyDeg: number;
  /** Hold time per target. */
  readonly holdMs: number;
  /** A movement counts once it is within this many degrees of the reach angle. */
  readonly reachSlack: number;
  /**
   * Sideways allowance for a turn: a cone, `sideRatio` × the distance along
   * the target direction, never narrower than `minSide` degrees.
   */
  readonly sideRatio: number;
  readonly minSide: number;
  /** Once on target, drifting back by up to this many degrees still counts (hysteresis). */
  readonly hysteresis: number;
  /** Off target for less than this does not drain the hold: a wobble is free. */
  readonly graceMs: number;
  /** After the grace period the hold drains at this multiple of the fill rate. */
  readonly drainRate: number;
  /** No face for this long before "face not in view" (single missed frames are normal mid-turn). */
  readonly faceLostMs: number;
  /**
   * Longest frame step counted as playing time. Weak laptops run the face
   * model at 4–8 fps (125–250 ms per frame) and stall longer now and then; a
   * hidden tab or a pause is seconds. 600 ms separates the two.
   */
  readonly maxStepMs: number;
}

export const STRETCH_DEFAULTS: StretchConfig = {
  neutralMs: 1200,
  neutralSteadyDeg: 6,
  holdMs: 2500,
  reachSlack: 3,
  sideRatio: 0.5,
  minSide: 6,
  hysteresis: 3,
  graceMs: 300,
  drainRate: 1,
  faceLostMs: 700,
  maxStepMs: 600,
};

export type StretchPhase = 'neutral' | 'playing' | 'done';

export interface StretchState {
  readonly phase: StretchPhase;
  /** Pose relative to neutral; null until neutral is known or while no face. */
  readonly pose: Pose | null;
  /** True after `faceLostMs` without a face, not on every missed frame. */
  readonly faceLost: boolean;
  /** 0..1 progress of the neutral capture. */
  readonly neutralProgress: number;
  readonly index: number;
  readonly target: StretchTarget | null;
  /** 0..1 hold progress on the current target. */
  readonly hold: number;
  readonly onTarget: boolean;
  /** 0..1: how far towards the current target's reach angle the head is. */
  readonly reach: number;
  /** Set on the update where a target was completed (its index). */
  readonly completed: number | null;
  readonly elapsedMs: number;
}

export class StretchSession {
  readonly #targets: readonly StretchTarget[];
  readonly #cfg: StretchConfig;
  #phase: StretchPhase = 'neutral';
  #lastT: number | null = null;
  #startT: number | null = null;
  #endT: number | null = null;
  #neutralMs = 0;
  #samples: Pose[] = [];
  #neutral: Pose | null = null;
  #index = 0;
  #hold = 0;
  #on = false;
  #offMs = 0;
  #noFaceMs = 0;
  #state: StretchState;

  constructor(
    targets: readonly StretchTarget[] = ROUTINE,
    config: StretchConfig = STRETCH_DEFAULTS,
  ) {
    if (targets.length === 0) throw new Error('A stretch routine needs at least one target');
    this.#targets = targets;
    this.#cfg = config;
    this.#state = this.#snapshot(null, null, 0);
  }

  get state(): StretchState {
    return this.#state;
  }

  get total(): number {
    return this.#targets.length;
  }

  get config(): StretchConfig {
    return this.#cfg;
  }

  /** Feeds one frame: absolute head pose, or null when no face was found. */
  update(tMs: number, pose: Pose | null): StretchState {
    const gap = this.#lastT === null ? 0 : tMs - this.#lastT;
    // Frame gaps (paused, tab hidden) never count as playing time.
    const dt = gap > 0 && gap <= this.#cfg.maxStepMs ? gap : 0;
    this.#lastT = tMs;
    this.#startT ??= tMs;
    let completed: number | null = null;
    this.#noFaceMs = pose ? 0 : this.#noFaceMs + Math.max(0, gap);

    if (this.#phase === 'neutral') {
      if (pose) this.#captureNeutral(pose, dt);
    } else if (this.#phase === 'playing' && pose && this.#neutral) {
      const target = this.#targets[this.#index];
      if (target) {
        this.#on = this.#isOn(relative(pose, this.#neutral), target, this.#on);
        const fill = dt / this.#cfg.holdMs;
        if (this.#on) {
          this.#offMs = 0;
          this.#hold = Math.min(1, this.#hold + fill);
        } else {
          this.#offMs += dt;
          if (this.#offMs > this.#cfg.graceMs) {
            this.#hold = Math.max(0, this.#hold - fill * this.#cfg.drainRate);
          }
        }
        if (this.#hold >= 1) {
          completed = this.#index;
          this.#index += 1;
          this.#hold = 0;
          this.#on = false;
          this.#offMs = 0;
          if (this.#index >= this.#targets.length) {
            this.#phase = 'done';
            this.#endT = tMs;
          }
        }
      }
    }
    // While the face is missing the hold is frozen: no fill, no drain.

    const rel = pose && this.#neutral ? relative(pose, this.#neutral) : null;
    this.#state = this.#snapshot(rel, completed, tMs);
    return this.#state;
  }

  /**
   * Neutral = median of a steady run of samples. A sample far from the running
   * median means the learner was still settling, so the capture starts again.
   */
  #captureNeutral(pose: Pose, dt: number): void {
    if (this.#samples.length >= 3) {
      const m = medianPose(this.#samples);
      const off = Math.max(
        Math.abs(pose.yaw - m.yaw),
        Math.abs(pose.pitch - m.pitch),
        Math.abs(pose.roll - m.roll),
      );
      if (off > this.#cfg.neutralSteadyDeg) {
        this.#samples = [];
        this.#neutralMs = 0;
      }
    }
    this.#samples.push(pose);
    this.#neutralMs += dt;
    if (this.#neutralMs >= this.#cfg.neutralMs) {
      this.#neutral = medianPose(this.#samples);
      this.#samples = [];
      this.#phase = 'playing';
    }
  }

  /** Reach test; `wasOn` loosens the thresholds by `hysteresis` degrees. */
  #isOn(p: Pose, t: StretchTarget, wasOn: boolean): boolean {
    const h = wasOn ? this.#cfg.hysteresis : 0;
    if (t.kind === 'tilt') {
      return Math.sign(t.roll) * p.roll >= Math.abs(t.roll) - this.#cfg.reachSlack - h;
    }
    const { along, side, need } = project(p, t);
    const sideMax = Math.max(this.#cfg.minSide, along * this.#cfg.sideRatio) + h;
    return along >= need - this.#cfg.reachSlack - h && side <= sideMax;
  }

  #reach(p: Pose | null, t: StretchTarget | null): number {
    if (!p || !t) return 0;
    if (t.kind === 'tilt') {
      const need = Math.max(1, Math.abs(t.roll) - this.#cfg.reachSlack);
      return clamp01((Math.sign(t.roll) * p.roll) / need);
    }
    const { along, need } = project(p, t);
    return clamp01(along / Math.max(1, need - this.#cfg.reachSlack));
  }

  #snapshot(pose: Pose | null, completed: number | null, tMs: number): StretchState {
    const target = this.#phase === 'playing' ? (this.#targets[this.#index] ?? null) : null;
    const start = this.#startT ?? tMs;
    return {
      phase: this.#phase,
      pose,
      faceLost: this.#lastT !== null && this.#noFaceMs >= this.#cfg.faceLostMs,
      neutralProgress: Math.min(1, this.#neutralMs / this.#cfg.neutralMs),
      index: this.#index,
      target,
      hold: this.#hold,
      onTarget: pose !== null && target !== null && this.#on,
      reach: this.#reach(pose, target),
      completed,
      elapsedMs: (this.#endT ?? tMs) - start,
    };
  }
}

/** Head position along / across a turn target's direction (degrees), and the reach angle. */
export function project(p: Pose, t: StretchTarget): { along: number; side: number; need: number } {
  const need = Math.hypot(t.yaw, t.pitch) || 1;
  const ux = t.yaw / need;
  const uy = t.pitch / need;
  return {
    along: p.yaw * ux + p.pitch * uy,
    side: Math.abs(-p.yaw * uy + p.pitch * ux),
    need,
  };
}

function relative(p: Pose, n: Pose): Pose {
  return { yaw: p.yaw - n.yaw, pitch: p.pitch - n.pitch, roll: p.roll - n.roll };
}

function median(values: readonly number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? (v[mid] ?? 0) : ((v[mid - 1] ?? 0) + (v[mid] ?? 0)) / 2;
}

function medianPose(samples: readonly Pose[]): Pose {
  return {
    yaw: median(samples.map((s) => s.yaw)),
    pitch: median(samples.map((s) => s.pitch)),
    roll: median(samples.map((s) => s.roll)),
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
