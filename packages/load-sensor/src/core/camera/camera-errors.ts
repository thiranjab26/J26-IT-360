import type { CameraError, CameraFailure } from './types.js';

/**
 * Maps a `getUserMedia` rejection to a camera status.
 *
 * Names come from the Media Capture spec, plus the legacy names older Chrome
 * versions still throw (`PermissionDeniedError`, `DevicesNotFoundError`,
 * `TrackStartError`, `ConstraintNotSatisfiedError`).
 */
const FAILURE_BY_ERROR_NAME: Readonly<Record<string, CameraFailure>> = {
  // The user clicked "Block", dismissed the prompt permanently, or a
  // Permissions-Policy / enterprise policy forbids the camera.
  NotAllowedError: 'permission_denied',
  PermissionDeniedError: 'permission_denied',
  SecurityError: 'permission_denied',

  // No video input device. We only use `ideal` constraints, so an
  // OverconstrainedError also means "no camera can serve this request at all".
  NotFoundError: 'no_camera',
  DevicesNotFoundError: 'no_camera',
  OverconstrainedError: 'no_camera',
  ConstraintNotSatisfiedError: 'no_camera',

  // The device exists but the OS could not open it: on Windows this is almost
  // always another app (Teams, Zoom) holding the camera. Firefox reports some
  // of these cases as AbortError.
  NotReadableError: 'camera_in_use',
  TrackStartError: 'camera_in_use',
  AbortError: 'camera_in_use',

  // Thrown when getUserMedia is called with invalid constraints or outside a
  // secure context in some browsers.
  TypeError: 'unsupported',
};

/** Classifies any thrown value from `getUserMedia` or `video.play()`. */
export function classifyCameraError(error: unknown): CameraError {
  const name = errorName(error);
  const status = FAILURE_BY_ERROR_NAME[name] ?? 'error';
  const message = error instanceof Error ? error.message : String(error);
  return { status, name, message };
}

function errorName(error: unknown): string {
  // DOMException is an Error in browsers and in Node >= 17, but some test
  // doubles and older engines only provide a `name` field.
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const { name } = error;
    if (typeof name === 'string') return name;
  }
  return 'UnknownError';
}
