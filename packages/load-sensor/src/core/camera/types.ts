/**
 * Camera module types. Frames exist only inside camera/ and landmarks/
 * (ARCHITECTURE.md §9); everything downstream receives numbers.
 */

/**
 * Lifecycle and failure states of the camera.
 *
 * Failures are normal states, not exceptions ("degrade, don't crash"): each one
 * has its own value so the UI can tell the learner what to do about it.
 *
 * - `idle`              — never started.
 * - `starting`          — waiting for `getUserMedia` (the permission prompt may be open).
 * - `active`            — frames are being delivered.
 * - `paused`            — stream kept open, no frames delivered (user pause or tab hidden).
 * - `stopped`           — all tracks stopped; the camera LED is off.
 * - `permission_denied` — the user or a browser policy refused camera access.
 * - `no_camera`         — no camera exists, or the one in use was unplugged / revoked.
 * - `camera_in_use`     — a camera exists but could not be opened (another app holds it).
 * - `unsupported`       — no `getUserMedia` here (old browser, or not https/localhost).
 * - `error`             — anything else; see `Camera.lastError`.
 *
 * This is the camera's own state, not `LoadStateEvent.status`; the mapping to
 * the shared event schema is done by the public API (TODO A5).
 */
export type CameraStatus =
  | 'idle'
  | 'starting'
  | 'active'
  | 'paused'
  | 'stopped'
  | 'permission_denied'
  | 'no_camera'
  | 'camera_in_use'
  | 'unsupported'
  | 'error';

/** The subset of `CameraStatus` that means "could not get or keep a camera". */
export type CameraFailure = Extract<
  CameraStatus,
  'permission_denied' | 'no_camera' | 'camera_in_use' | 'unsupported' | 'error'
>;

/** Why the camera is paused. Both must be cleared before frames flow again. */
export type PauseReason = 'user' | 'hidden';

/** Which browser clock drives the frame loop (reported in the debug overlay and bench). */
export type FrameClock = 'video-frame-callback' | 'animation-frame';

/** Details of the most recent failure, safe to show in a debug UI. */
export interface CameraError {
  readonly status: CameraFailure;
  /** `DOMException.name` or `Error.name`, e.g. `NotAllowedError`. */
  readonly name: string;
  readonly message: string;
}

/**
 * One camera frame handed to the landmark provider.
 *
 * `tMs` is the frame's own media timestamp, not the wall clock, so features
 * stay correct when the frame rate varies (CLAUDE.md: time comes from the frame).
 * It increases strictly from one frame to the next within a session.
 */
export interface CameraFrame {
  readonly video: HTMLVideoElement;
  readonly tMs: number;
  readonly width: number;
  readonly height: number;
}
