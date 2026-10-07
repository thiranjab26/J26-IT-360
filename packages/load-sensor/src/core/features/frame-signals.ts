import { earLeft, earRight, interocularDistance, irisOffset } from './eye.js';
import { browInnerGap, browRaise, lipThickness, mouthOpen } from './expression.js';
import type { FaceMesh } from './geometry.js';
import { faceAxes, poseFromAxes } from './head-pose.js';

/**
 * Per-frame signals (ARCHITECTURE.md §5.1), computed from one face mesh.
 * Lengths are in inter-ocular distances, angles in degrees, gaze in eye widths.
 */
export interface FrameSignals {
  readonly earLeft: number;
  readonly earRight: number;
  /** Mean of both eyes. */
  readonly ear: number;
  readonly irisDx: number;
  readonly irisDy: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  readonly browRaise: number;
  readonly browInnerGap: number;
  readonly mouthOpen: number;
  readonly lipThickness: number;
  /** Inter-ocular distance in frame heights (how large the face is in the frame). */
  readonly iod: number;
}

/**
 * Computes every per-frame signal. Returns null if the geometry is degenerate
 * (zero-size face or a non-finite value), so a bad mesh is treated as "no
 * face" downstream instead of as data.
 */
export function computeFrameSignals(mesh: FaceMesh): FrameSignals | null {
  const iod = interocularDistance(mesh);
  if (!(iod > 0)) return null;

  const axes = faceAxes(mesh);
  const pose = poseFromAxes(axes);
  const gaze = irisOffset(mesh, axes.y);
  const eR = earRight(mesh);
  const eL = earLeft(mesh);

  const signals: FrameSignals = {
    earLeft: eL,
    earRight: eR,
    ear: (eL + eR) / 2,
    irisDx: gaze.dx,
    irisDy: gaze.dy,
    yaw: pose.yaw,
    pitch: pose.pitch,
    roll: pose.roll,
    browRaise: browRaise(mesh, iod),
    browInnerGap: browInnerGap(mesh, iod),
    mouthOpen: mouthOpen(mesh, iod),
    lipThickness: lipThickness(mesh, iod),
    iod,
  };
  return Object.values(signals).every(Number.isFinite) ? signals : null;
}
