import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fake camera for Playwright (Chromium / Edge).
 *
 * Default: Chromium's synthetic test pattern. It has no face in it, so the
 * sensor honestly settles on `status: "no_face"`: this proves the camera, model,
 * caching and network behaviour, but not the landmark model or `active`.
 *
 * Optional: a face clip, given as an absolute path in `ADAPTLEARN_FAKE_VIDEO`
 * (`.mjpeg` or `.y4m`; Chromium loops it). The clip must stay OUTSIDE this
 * repository (CLAUDE.md invariant 2: no raw video in git, not even as a test
 * fixture), so the path is refused if it points inside the package. With a
 * clip, the tests that need a face (status `active`) run instead of skipping,
 * and the benchmark measures the full landmark path.
 *
 * Recording one (Windows, your own face, kept on your machine only):
 *   ffmpeg -f dshow -i video="<camera name>" -t 120 -vf scale=640:480 -r 30 -q:v 4 C:\clips\face.mjpeg
 * (`ffmpeg -list_devices true -f dshow -i dummy` lists camera names.)
 */

const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function resolveClip(): string | null {
  const raw = process.env.ADAPTLEARN_FAKE_VIDEO?.trim();
  if (!raw) return null;
  const path = resolve(raw);
  const inside = relative(PACKAGE_ROOT, path);
  if (!inside.startsWith('..') && !isAbsolute(inside)) {
    throw new Error(
      `ADAPTLEARN_FAKE_VIDEO points inside the repository (${path}). Keep face clips outside it (CLAUDE.md invariant 2).`,
    );
  }
  if (!/\.(mjpeg|y4m)$/i.test(path)) {
    throw new Error(`ADAPTLEARN_FAKE_VIDEO must be a .mjpeg or .y4m file, got ${path}`);
  }
  if (!existsSync(path)) throw new Error(`ADAPTLEARN_FAKE_VIDEO file not found: ${path}`);
  return path;
}

/** Absolute path of the face clip, or null for the synthetic pattern. */
export const FACE_CLIP: string | null = resolveClip();

/** Chromium flags: grant the camera without a prompt and feed it fake frames. */
export const FAKE_CAMERA_ARGS: readonly string[] = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  ...(FACE_CLIP ? [`--use-file-for-fake-video-capture=${FACE_CLIP}`] : []),
];

/** What the camera shows, for test titles and bench output. */
export const CAMERA_SOURCE: 'synthetic-pattern' | 'face-clip' = FACE_CLIP
  ? 'face-clip'
  : 'synthetic-pattern';
