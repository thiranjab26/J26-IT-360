import { isParticipantCode } from './latin-square.js';
import { FRAME_COLUMNS, NOTES_MAX_LENGTH, SESSION_KIND } from './session.js';

/**
 * Recorder self-check (TODO B1; invariants 1, 2 and 7): proves an export holds
 * no image data and no landmark mesh before it is offered as a download, and
 * the unit tests run it against a real export.
 *
 * Checked structurally rather than trusting the recorder:
 * - frame rows have exactly the FRAME_COLUMNS columns (34 numbers, nowhere
 *   near the 478 × 2 or × 3 of a mesh);
 * - no other numeric array is longer than LONGEST_OTHER_ARRAY (the longest
 *   legitimate one is the 10 SUS answers);
 * - no binary values (ArrayBuffer, typed arrays, Blob);
 * - no string looks like a data URL or a base64 payload, and none is longer
 *   than the notes limit;
 * - the participant code is P01…P08.
 */

/** Longest numeric array allowed outside `frames` (SUS has 10 answers). */
export const LONGEST_OTHER_ARRAY = 16;

/** Any base64 run this long is a payload, not a word. */
const BASE64_RUN = /[A-Za-z0-9+/]{120,}={0,2}/;
const DATA_URL = /^\s*data:/i;

export function checkSessionExport(value: unknown): string[] {
  const problems: string[] = [];
  if (typeof value !== 'object' || value === null) return ['export is not an object'];
  const root = value as Record<string, unknown>;

  if (root.kind !== SESSION_KIND) problems.push(`kind is not "${SESSION_KIND}"`);
  if (typeof root.participant !== 'string' || !isParticipantCode(root.participant)) {
    problems.push('participant is not a P01…P08 code');
  }
  const columns = root.columns;
  if (
    !Array.isArray(columns) ||
    columns.length !== FRAME_COLUMNS.length ||
    columns.some((c, i) => c !== FRAME_COLUMNS[i])
  ) {
    problems.push('columns differ from FRAME_COLUMNS');
  }

  const frames = root.frames;
  if (!Array.isArray(frames)) {
    problems.push('frames is not an array');
  } else {
    for (let i = 0; i < frames.length; i += 1) {
      const row: unknown = frames[i];
      if (
        !Array.isArray(row) ||
        row.length !== FRAME_COLUMNS.length ||
        !row.every((v) => typeof v === 'number' && Number.isFinite(v))
      ) {
        problems.push(`frame ${String(i)} is not ${String(FRAME_COLUMNS.length)} finite numbers`);
        break;
      }
    }
  }

  walk(root, '$', problems, frames);
  return problems;
}

function walk(value: unknown, path: string, problems: string[], frames: unknown): void {
  if (value === frames) return; // checked row by row above
  if (typeof value === 'string') {
    if (DATA_URL.test(value)) problems.push(`${path} is a data URL`);
    else if (BASE64_RUN.test(value)) problems.push(`${path} holds a base64 payload`);
    else if (value.length > NOTES_MAX_LENGTH) problems.push(`${path} is a long string`);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || isBlob(value)) {
    problems.push(`${path} is binary data`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > LONGEST_OTHER_ARRAY && value.every((v) => typeof v === 'number')) {
      problems.push(`${path} is a numeric array of ${String(value.length)} (mesh-sized data?)`);
      return;
    }
    value.forEach((v, i) => {
      walk(v, `${path}[${String(i)}]`, problems, frames);
    });
    return;
  }
  for (const [key, v] of Object.entries(value)) walk(v, `${path}.${key}`, problems, frames);
}

function isBlob(value: object): boolean {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}
