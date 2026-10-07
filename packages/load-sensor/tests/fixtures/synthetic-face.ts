/**
 * Synthetic face meshes with known ground truth, for feature tests.
 *
 * Builds the landmarks the features use from a simple frontal face model in
 * inter-ocular units, rotates it by a known head pose, places it in the frame
 * and normalises it exactly as the provider does (x / width, y / height,
 * z / width). Pure geometry: no image of anyone is involved.
 *
 * Because every parameter is known, tests can check that a feature recovers
 * it, and that the same scenario sampled at 10 fps and 30 fps gives the same
 * per-second features.
 */
import { LANDMARK_COUNT } from '../../src/core/landmarks/types.js';

export interface FaceParams {
  /** Head pose in degrees, same convention as headPose(). */
  readonly yaw?: number;
  readonly pitch?: number;
  readonly roll?: number;
  /** Eye aspect ratio of each eye (open ≈ 0.3, closed ≈ 0.05). */
  readonly ear?: number;
  readonly earLeft?: number;
  readonly earRight?: number;
  /** Iris offset in eye widths (same as irisOffset()). */
  readonly irisDx?: number;
  readonly irisDy?: number;
  /** Extra brow height above neutral, in IOD. */
  readonly browLift?: number;
  /** Inner brow gap in IOD (neutral 0.3). */
  readonly browInnerGap?: number;
  /** Inner lip gap in IOD. */
  readonly mouthOpen?: number;
  /** Total lip thickness in IOD (neutral 0.2). */
  readonly lipThickness?: number;
  /** Face size: inter-ocular distance in frame heights. */
  readonly size?: number;
  /** Face centre in normalised frame coordinates. */
  readonly cx?: number;
  readonly cy?: number;
}

export const DEFAULT_ASPECT = 4 / 3;

type P = [number, number, number];

/** Neutral brow height above the eye line, in IOD. */
const BROW_Y = -0.35;
const MOUTH_Y = 0.85;
const EYE_HALF_WIDTH = 0.25;

export function syntheticFace(params: FaceParams = {}, aspect = DEFAULT_ASPECT): Float32Array {
  const earR = params.earRight ?? params.ear ?? 0.3;
  const earL = params.earLeft ?? params.ear ?? 0.3;
  // EAR = (2·2h) / (2·eyeWidth) with eyeWidth 0.5  ⇒  h = EAR / 4.
  const hR = earR / 4;
  const hL = earL / 4;
  const dx = params.irisDx ?? 0;
  const dy = params.irisDy ?? 0;
  const lift = params.browLift ?? 0;
  const gap = params.browInnerGap ?? 0.3;
  const open = params.mouthOpen ?? 0;
  const thick = params.lipThickness ?? 0.2;

  const pts = new Map<number, P>([
    // Right eye (subject's right; image left), centre (−0.5, 0).
    [33, [-0.5 - EYE_HALF_WIDTH, 0, 0]],
    [133, [-0.5 + EYE_HALF_WIDTH, 0, 0]],
    [160, [-0.6, -hR, 0]],
    [158, [-0.4, -hR, 0]],
    [153, [-0.4, hR, 0]],
    [144, [-0.6, hR, 0]],
    [159, [-0.5, -hR, 0]],
    // Left eye, centre (+0.5, 0).
    [362, [0.5 - EYE_HALF_WIDTH, 0, 0]],
    [263, [0.5 + EYE_HALF_WIDTH, 0, 0]],
    [385, [0.4, -hL, 0]],
    [387, [0.6, -hL, 0]],
    [373, [0.6, hL, 0]],
    [380, [0.4, hL, 0]],
    [386, [0.5, -hL, 0]],
    // Brows.
    [105, [-0.5, BROW_Y - lift, 0]],
    [334, [0.5, BROW_Y - lift, 0]],
    [107, [-gap / 2, BROW_Y + 0.02 - lift, 0]],
    [336, [gap / 2, BROW_Y + 0.02 - lift, 0]],
    // Head axis.
    [10, [0, -0.9, 0]],
    [152, [0, 1.3, 0]],
    // Lips.
    [13, [0, MOUTH_Y - open / 2, 0]],
    [14, [0, MOUTH_Y + open / 2, 0]],
    [0, [0, MOUTH_Y - open / 2 - thick / 2, 0]],
    [17, [0, MOUTH_Y + open / 2 + thick / 2, 0]],
  ]);
  // Irises: centre + 4 rim points, offset in eye widths (2 × half width).
  for (const [centre, eyeX] of [
    [468, -0.5],
    [473, 0.5],
  ] as const) {
    const c: P = [eyeX + dx * 2 * EYE_HALF_WIDTH, dy * 2 * EYE_HALF_WIDTH, 0];
    pts.set(centre, c);
    pts.set(centre + 1, [c[0] + 0.06, c[1], 0]);
    pts.set(centre + 2, [c[0], c[1] - 0.06, 0]);
    pts.set(centre + 3, [c[0] - 0.06, c[1], 0]);
    pts.set(centre + 4, [c[0], c[1] + 0.06, 0]);
  }

  const R = rotation(params.yaw ?? 0, params.pitch ?? 0, params.roll ?? 0);
  const size = params.size ?? 0.18;
  const cx = (params.cx ?? 0.5) * aspect;
  const cy = params.cy ?? 0.45;

  const out = new Float32Array(LANDMARK_COUNT * 3);
  for (let i = 0; i < LANDMARK_COUNT; i += 1) {
    const [x, y, z] = apply(R, pts.get(i) ?? [0, 0.2, 0]);
    // Frame-height units → provider's per-axis normalisation.
    out[i * 3] = (cx + size * x) / aspect;
    out[i * 3 + 1] = cy + size * y;
    out[i * 3 + 2] = (size * z) / aspect;
  }
  return out;
}

type M3 = [P, P, P];

/** R = Ry(yaw) · Rx(pitch) · Rz(roll), the decomposition headPose() inverts. */
function rotation(yawDeg: number, pitchDeg: number, rollDeg: number): M3 {
  const [y, p, r] = [yawDeg, pitchDeg, rollDeg].map((d) => (d * Math.PI) / 180) as [
    number,
    number,
    number,
  ];
  const Ry: M3 = [
    [Math.cos(y), 0, Math.sin(y)],
    [0, 1, 0],
    [-Math.sin(y), 0, Math.cos(y)],
  ];
  const Rx: M3 = [
    [1, 0, 0],
    [0, Math.cos(p), -Math.sin(p)],
    [0, Math.sin(p), Math.cos(p)],
  ];
  const Rz: M3 = [
    [Math.cos(r), -Math.sin(r), 0],
    [Math.sin(r), Math.cos(r), 0],
    [0, 0, 1],
  ];
  return mul(mul(Ry, Rx), Rz);
}

function mul(a: M3, b: M3): M3 {
  const col = (j: 0 | 1 | 2): P => [b[0][j], b[1][j], b[2][j]];
  const row = (r: P): P => [dot3(r, col(0)), dot3(r, col(1)), dot3(r, col(2))];
  return [row(a[0]), row(a[1]), row(a[2])];
}

function dot3(u: P, v: P): number {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
}

function apply(m: M3, [x, y, z]: P): P {
  return [
    m[0][0] * x + m[0][1] * y + m[0][2] * z,
    m[1][0] * x + m[1][1] * y + m[1][2] * z,
    m[2][0] * x + m[2][1] * y + m[2][2] * z,
  ];
}

export interface FrameSample {
  readonly tMs: number;
  readonly landmarks: Float32Array | null;
}

export interface SequenceOptions {
  readonly fps: number;
  readonly durationMs: number;
  readonly startMs?: number;
  /** ± uniform jitter on each frame time, deterministic. */
  readonly jitterMs?: number;
  /** Face parameters at time t (ms from start); null = no face in this frame. */
  readonly face: (tMs: number) => FaceParams | null;
}

/** Samples a scenario at a given frame rate, like a camera would. */
export function renderSequence(options: SequenceOptions): FrameSample[] {
  const { fps, durationMs, startMs = 0, jitterMs = 0 } = options;
  const out: FrameSample[] = [];
  const n = Math.floor((durationMs * fps) / 1000);
  for (let i = 0; i < n; i += 1) {
    const ideal = (i * 1000) / fps;
    const jitter = jitterMs * Math.sin(i * 12.9898) * 0.999;
    const t = Math.max(0, ideal + jitter);
    const params = options.face(t);
    out.push({ tMs: startMs + t, landmarks: params ? syntheticFace(params) : null });
  }
  return out;
}

/** Eye aspect ratio over time for blinks at the given start times (ms). */
export function blinkingEar(
  t: number,
  blinks: readonly { readonly at: number; readonly durationMs: number }[],
  open = 0.3,
  closed = 0.05,
): number {
  return blinks.some((b) => t >= b.at && t < b.at + b.durationMs) ? closed : open;
}
