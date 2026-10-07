import { FEATURE_LANDMARKS } from '../core/features/index.js';

/**
 * Development-only tool (not in production builds): records the landmark
 * points the features use, so you can save test fixtures of your own face
 * blinking, looking away, turning, leaving the frame (TODO A4).
 *
 * Privacy: only the ~40 landmarks in FEATURE_LANDMARKS are kept (not the
 * 478-point mesh), as numbers, never images. The file is saved by your
 * browser to your own disk; nothing is uploaded.
 */

export const FIXTURE_INDICES: readonly number[] = FEATURE_LANDMARKS.map((l) => l.index).sort(
  (a, b) => a - b,
);

export interface LandmarkFixture {
  readonly schema: 1;
  readonly kind: 'c2-landmark-fixture';
  readonly scenario: string;
  readonly notes: string;
  /** Frame width / height. */
  readonly aspect: number;
  /** Landmark indices stored per frame, in this order. */
  readonly indices: readonly number[];
  /** Optional ground truth the tests check, e.g. how many times you blinked on purpose. */
  readonly expected: { readonly blinks?: number };
  /** t = frame ms from the start; p = [x, y, z] for each index (4 dp), or null = no face. */
  readonly frames: readonly { readonly t: number; readonly p: number[] | null }[];
}

const SCENARIOS = [
  ['blinks', 'Blink on purpose, counting the blinks'],
  ['look-away', 'Look at the screen, then away, then back'],
  ['head-turn', 'Turn your head left, right, up, down'],
  ['leave-frame', 'Leave the frame for a few seconds, then come back'],
  ['neutral', 'Work normally (reading, thinking)'],
] as const;

export class FixtureRecorder {
  readonly element: HTMLElement;
  readonly #status: HTMLElement;
  readonly #button: HTMLButtonElement;
  readonly #scenario: HTMLSelectElement;
  readonly #duration: HTMLSelectElement;
  readonly #blinks: HTMLInputElement;

  #recording: {
    startMs: number | null;
    endAfterMs: number;
    aspect: number;
    frames: { t: number; p: number[] | null }[];
  } | null = null;

  constructor() {
    this.element = document.createElement('details');
    this.element.className = 'card dev-tools';
    const summary = document.createElement('summary');
    summary.innerHTML =
      '<span class="dev-badge">DEV</span> Fixture recorder <span class="dev-sub">record your own landmark sequences for tests</span>';
    const body = document.createElement('div');
    body.className = 'dev-body';

    this.#scenario = document.createElement('select');
    for (const [value, label] of SCENARIOS) this.#scenario.add(new Option(label, value));
    this.#duration = document.createElement('select');
    for (const s of [10, 20, 30]) this.#duration.add(new Option(`${String(s)} s`, String(s)));
    this.#blinks = document.createElement('input');
    this.#blinks.type = 'number';
    this.#blinks.min = '0';
    this.#blinks.placeholder = 'optional';
    this.#button = document.createElement('button');
    this.#button.type = 'button';
    this.#button.className = 'btn btn-primary';
    this.#button.textContent = 'Record';
    this.#status = document.createElement('p');
    this.#status.className = 'dev-status';
    this.#status.textContent =
      'Saves only the feature landmarks as numbers (no images) to your Downloads. Put the file in tests/fixtures/.';

    body.append(
      field('Scenario', this.#scenario),
      field('Duration', this.#duration),
      field('Blinks performed', this.#blinks),
      this.#button,
      this.#status,
    );
    this.element.append(summary, body);

    this.#button.addEventListener('click', () => {
      if (this.#recording) this.#finish();
      else this.#start();
    });
  }

  /** Feed every processed frame while sensing is on. */
  push(tMs: number, landmarks: Float32Array | null, aspect: number): void {
    const r = this.#recording;
    if (!r) return;
    r.startMs ??= tMs;
    r.aspect = aspect;
    const t = Math.round(tMs - r.startMs);
    r.frames.push({ t, p: landmarks ? pick(landmarks) : null });
    const left = Math.max(0, Math.ceil((r.endAfterMs - t) / 1000));
    this.#status.textContent = `Recording… ${String(left)} s left · ${String(r.frames.length)} frames`;
    if (t >= r.endAfterMs) this.#finish();
  }

  #start(): void {
    this.#recording = {
      startMs: null,
      endAfterMs: Number(this.#duration.value) * 1000,
      aspect: 4 / 3,
      frames: [],
    };
    this.#button.textContent = 'Stop';
    this.#status.textContent = 'Recording starts with the next frame…';
  }

  #finish(): void {
    const r = this.#recording;
    this.#recording = null;
    this.#button.textContent = 'Record';
    if (!r || r.frames.length === 0) {
      this.#status.textContent = 'Nothing recorded: is sensing on?';
      return;
    }
    const blinks = this.#blinks.value === '' ? undefined : Number(this.#blinks.value);
    const fixture: LandmarkFixture = {
      schema: 1,
      kind: 'c2-landmark-fixture',
      scenario: this.#scenario.value,
      notes: '',
      aspect: r.aspect,
      indices: FIXTURE_INDICES,
      expected: blinks === undefined ? {} : { blinks },
      frames: r.frames,
    };
    const name = `${this.#scenario.value}-${new Date().toISOString().slice(0, 10)}.landmarks.json`;
    // A local download of numbers the user just produced; nothing leaves the device.
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(fixture)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    this.#status.textContent = `Saved ${name} (${String(r.frames.length)} frames). Move it into tests/fixtures/.`;
  }
}

function pick(landmarks: Float32Array): number[] {
  const out: number[] = [];
  for (const i of FIXTURE_INDICES) {
    for (let k = 0; k < 3; k += 1) out.push(Math.round((landmarks[i * 3 + k] ?? 0) * 1e4) / 1e4);
  }
  return out;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'dev-field';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(span, control);
  return wrap;
}
