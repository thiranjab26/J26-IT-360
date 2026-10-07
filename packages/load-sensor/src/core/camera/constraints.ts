/**
 * Camera request (ARCHITECTURE.md §4).
 *
 * 640×480 at 30 fps: the face mesh model resizes its input to 192×192 (detector
 * 128×128), so more pixels cost decode and upload time without improving
 * landmarks. 30 fps gives the frame gate two camera frames per 15 fps inference
 * slot, so it can always find a fresh one.
 *
 * Every value is `ideal`, never `exact`, so any ordinary laptop or phone webcam
 * is accepted at whatever it can deliver (NFR4) instead of failing with
 * OverconstrainedError. Features use frame timestamps, so a camera that only
 * gives 15 or 24 fps still works.
 */
export const DEFAULT_VIDEO_CONSTRAINTS: Readonly<MediaTrackConstraints> = Object.freeze({
  width: { ideal: 640 },
  height: { ideal: 480 },
  frameRate: { ideal: 30 },
  facingMode: 'user',
});

/** Audio is never requested: the sensor uses the face only. */
export function buildMediaStreamConstraints(
  video: MediaTrackConstraints = DEFAULT_VIDEO_CONSTRAINTS,
): MediaStreamConstraints {
  return { audio: false, video: { ...video } };
}
