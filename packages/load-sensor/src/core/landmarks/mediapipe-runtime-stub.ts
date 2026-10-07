/**
 * Build-time replacement for `@mediapipe/face_mesh` and `@mediapipe/face_detection`
 * (wired up in vite.config.ts `resolve.alias`).
 *
 * The face-landmarks-detection and face-detection packages import these for
 * their `runtime: 'mediapipe'` mode. We only use `runtime: 'tfjs'` (adapter A,
 * ARCHITECTURE.md §3), and the real packages would:
 *  - fail to bundle cleanly (they are not ES modules, so `FaceMesh` resolves to
 *    undefined under Vite/Rolldown), and
 *  - default to loading their WASM and model files from cdn.jsdelivr.net,
 *    which invariant 3 forbids.
 * Replacing them keeps that code path out of the bundle entirely. If anything
 * ever selects the MediaPipe runtime, it fails loudly instead of reaching a CDN.
 */

/** Stands in for the `FaceMesh` / `FaceDetection` classes; `new` on it throws. */
function mediaPipeRuntimeUnavailable(): never {
  throw new Error(
    "The MediaPipe runtime is not bundled; use runtime: 'tfjs' (ARCHITECTURE.md §3, invariant 3).",
  );
}

export const FaceMesh = mediaPipeRuntimeUnavailable;
export const FaceDetection = mediaPipeRuntimeUnavailable;
