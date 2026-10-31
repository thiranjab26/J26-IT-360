// Pilot-study runner (TODO B1). Built only with `--mode study`
// (`pnpm dev:study`, `pnpm build:study`); absent from the normal build
// (ARCHITECTURE.md Â§9 "Study mode storage").
//
// Flow: participant code + consent check â†’ camera â†’ rest block (baseline) â†’
// four task blocks in Latin-square order, NASA-TLX + boredom + tiredness after
// each â†’ SUS â†’ quality summary â†’ export one JSON file.
//
// Recorded: derived numbers per frame (src/core/recorder), never images and
// never the landmark mesh. The camera preview is shown to the participant only;
// its pixels are never read here.

import './study.css';
import spec from '../../public/models/classifier/feature_spec.json';
import { Camera } from '../core/camera/index.js';
import {
  LandmarkTracker,
  TfjsFaceMeshProvider,
  UnsupportedBackendError,
} from '../core/landmarks/index.js';
import {
  IndexedDbRecorderStore,
  MemoryRecorderStore,
  SessionRecorder,
  TASK_CONDITIONS,
  checkSessionExport,
  exportFileName,
  exportSession,
  sessionQuality,
  type BlockKind,
  type RecorderStore,
  type SessionMeta,
} from '../core/recorder/index.js';
import { FeaturePipeline } from '../core/window/index.js';
import { BLOCK_TEXT, blockSeconds } from './config.js';
import { el, susForm, tlxForm } from './forms.js';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('#app missing');

if (import.meta.env.MODE !== 'study') {
  root.append(
    el('h1', 'Study mode is off'),
    el('p', 'Start it with `pnpm dev:study` or build it with `pnpm build:study`.'),
  );
} else {
  runStudy(root);
}

function runStudy(app: HTMLElement): void {
  const seconds = blockSeconds(location.search);
  const store: RecorderStore =
    typeof indexedDB === 'undefined' ? new MemoryRecorderStore() : new IndexedDbRecorderStore();

  // â”€â”€ Sensing: same parts as the demo page, frames go to the recorder only â”€â”€
  const video = el('video', undefined, 'preview');
  video.muted = true;
  video.playsInline = true;
  const camera = new Camera({ video });
  const provider = new TfjsFaceMeshProvider({
    modelBaseUrl: `${import.meta.env.BASE_URL}models/`,
    wasmBaseUrl: `${import.meta.env.BASE_URL}wasm/`,
  });
  const tracker = new LandmarkTracker(camera, provider, { targetFps: 15 });
  const pipeline = new FeaturePipeline();
  let recorder: SessionRecorder | null = null;
  let faceFound = false;

  tracker.onSample((sample) => {
    faceFound = sample.face !== null;
    const aspect = video.videoWidth > 0 ? video.videoWidth / video.videoHeight : 4 / 3;
    pipeline.push(sample.tMs, sample.face?.landmarks ?? null, aspect);
  });
  pipeline.onFrame((f) => {
    recorder?.pushFrame(f);
  });

  const header = el('header', undefined, 'study-header');
  const status = el('span', 'Camera off', 'chip');
  header.append(el('strong', 'AdaptLearn pilot study'), status);
  const screen = el('section');
  // The video stays in the page for the whole session and is only hidden:
  // browsers pause a media element that is removed from the document, which
  // would stop the frames (and the recording) after the camera check.
  const preview = el('div', undefined, 'card');
  preview.append(video);
  preview.hidden = true;
  app.append(header, preview, screen);

  setInterval(() => {
    const on = camera.status === 'active' && tracker.running;
    status.textContent = on
      ? `Camera on Â· ${faceFound ? 'face found' : 'no face'} Â· ${tracker.stats.fps.toFixed(0)} fps`
      : `Camera ${camera.status}`;
    status.dataset.state = on ? (faceFound ? 'ok' : 'warn') : 'off';
    const err = recorder?.writeError;
    if (err) status.textContent += ' Â· SAVE FAILED, export now';
  }, 500);

  /** Shows a screen; the camera preview only on the camera check, so no one watches themselves during tasks. */
  function show(nodes: HTMLElement[], withPreview = false): void {
    preview.hidden = !withPreview;
    screen.replaceChildren(...nodes);
    window.scrollTo(0, 0);
  }

  async function startSensing(): Promise<string | null> {
    const result = await camera.start();
    if (result !== 'active' && result !== 'paused') return `Camera: ${result}`;
    try {
      await provider.init();
    } catch (error) {
      camera.stop();
      return error instanceof UnsupportedBackendError
        ? 'This device cannot run the face model (no WebGL or WebAssembly).'
        : 'The face model failed to load.';
    }
    tracker.start();
    return null;
  }

  function stopSensing(): void {
    tracker.stop();
    camera.stop();
  }

  // â”€â”€ Screens â”€â”€

  async function setupScreen(): Promise<void> {
    const form = el('form', undefined, 'card');
    const code = el('select');
    code.add(new Option('Chooseâ€¦', ''));
    for (let i = 1; i <= 8; i += 1) code.add(new Option(`P0${String(i)}`));
    const signed = checkbox('The participant has signed the paper consent form.');
    const told = checkbox(
      'I explained that the camera image never leaves this computer and only numbers are kept.',
    );
    const notes = el('textarea');
    notes.maxLength = 500;
    notes.rows = 3;
    notes.placeholder = 'Lighting, glasses, device, anything unusual. No names.';
    const error = el('p', '', 'error');
    const start = el('button', 'Start session', 'btn btn-primary');
    start.type = 'submit';
    form.append(
      el('h2', 'New session'),
      labelled('Participant code', code),
      signed.element,
      told.element,
      labelled('Experimenter notes', notes),
      error,
      start,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!code.value || !signed.input.checked || !told.input.checked) {
        error.textContent = 'Choose a participant code and confirm both consent items.';
        return;
      }
      recorder = new SessionRecorder({
        store,
        participant: code.value,
        featureCodeHash: spec.code_hash,
      });
      recorder.setNotes(notes.value);
      cameraScreen();
    });
    show([form, await storedSessions()]);
  }

  function cameraScreen(): void {
    const card = el('div', undefined, 'card');
    const msg = el('p', 'Turn the camera on and check that the face is found.', 'hint');
    const on = el('button', 'Turn camera on', 'btn btn-primary');
    const next = el('button', 'Continue to rest block', 'btn');
    next.disabled = true;
    on.addEventListener('click', () => {
      on.disabled = true;
      msg.textContent = 'Starting camera and loading the face modelâ€¦';
      void startSensing().then((problem) => {
        msg.textContent = problem ?? 'Check the chip above says "face found", then continue.';
        on.disabled = problem === null;
        next.disabled = problem !== null;
      });
    });
    next.addEventListener('click', () => {
      blockIntro(0);
    });
    card.append(el('h2', 'Camera check'), msg, on, next);
    show([card], true);
  }

  /** Block 0 is rest; blocks 1â€“4 follow the participant's Latin-square row. */
  function kindOf(step: number): BlockKind {
    return step === 0 ? 'rest' : (recorder?.meta.order[step - 1] ?? 'easy');
  }

  function blockIntro(step: number): void {
    const kind = kindOf(step);
    const text = BLOCK_TEXT[kind];
    const card = el('div', undefined, 'card');
    const go = el('button', `Start ${text.title}`, 'btn btn-primary');
    go.addEventListener('click', () => {
      runBlock(step);
    });
    card.append(
      el('p', `Part ${String(step + 1)} of ${String(TASK_CONDITIONS.length + 1)}`, 'hint'),
      el('h2', text.title),
      el('p', text.instructions),
      el('p', `${String(Math.round(seconds / 60))} minutes`, 'hint'),
      go,
    );
    show([card]);
  }

  function runBlock(step: number): void {
    const r = recorder;
    if (!r) return;
    const kind = kindOf(step);
    // The rest block is the baseline: start it from fresh references.
    if (kind === 'rest') pipeline.reset();
    const record = r.beginBlock(kind, seconds);
    const card = el('div', undefined, 'card block-run');
    const clock = el('p', '', 'clock');
    const stop = el('button', 'End block early (experimenter)', 'btn btn-quiet');
    card.append(
      el('h2', BLOCK_TEXT[kind].title),
      clock,
      el('p', BLOCK_TEXT[kind].instructions),
      stop,
    );
    show([card]);

    const startedAt = performance.now();
    const tick = (): void => {
      const left = Math.max(0, seconds - (performance.now() - startedAt) / 1000);
      clock.textContent = `${String(Math.floor(left / 60))}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
      if (left <= 0) end();
    };
    const timer = setInterval(tick, 250);
    tick();
    function end(): void {
      clearInterval(timer);
      r?.endBlock();
      if (kind === 'rest') blockIntro(step + 1);
      else afterBlock(step, record.index);
    }
    stop.addEventListener('click', end);
  }

  function afterBlock(step: number, index: number): void {
    show([
      tlxForm(BLOCK_TEXT[kindOf(step)].title, (tlx, extra) => {
        recorder?.setBlockAnswers(index, tlx, extra);
        if (step < TASK_CONDITIONS.length) blockIntro(step + 1);
        else susScreen();
      }),
    ]);
  }

  function susScreen(): void {
    show([
      susForm((answers) => {
        recorder?.setSus(answers);
        void finishScreen();
      }),
    ]);
  }

  async function finishScreen(): Promise<void> {
    const r = recorder;
    if (!r) return;
    stopSensing();
    await r.finish().catch(() => undefined);
    const out = await exportSession(store, r.meta.id);
    const q = sessionQuality(out.blocks, out.frames);
    const card = el('div', undefined, 'card');
    const table = el('table');
    const head = el('tr');
    for (const h of ['Block', 'Seconds', 'fps', 'Face %', 'Blinks/min', 'Warnings']) {
      head.append(el('th', h));
    }
    table.append(head);
    for (const b of q.blocks) {
      const row = el('tr');
      row.append(
        el('td', `${String(b.index)} ${b.kind}`),
        el('td', b.seconds.toFixed(0)),
        el('td', b.fps.toFixed(1)),
        el('td', (b.faceRatio * 100).toFixed(0)),
        el('td', b.blinksPerMin.toFixed(1)),
        el('td', b.warnings.join('; ') || 'ok'),
      );
      table.append(row);
    }
    const again = el('button', 'New session', 'btn');
    again.addEventListener('click', () => {
      recorder = null;
      void setupScreen();
    });
    card.append(
      el('h2', 'Session finished â€” thank you'),
      el(
        'p',
        q.ok
          ? 'Quality checks passed.'
          : 'Some quality checks failed: see the table before the participant leaves.',
        q.ok ? 'hint' : 'error',
      ),
      table,
      el('p', `SUS score: ${String(out.sus?.score ?? 'â€”')}`),
      exportButton(r.meta),
      again,
    );
    show([card]);
  }

  function exportButton(meta: SessionMeta): HTMLElement {
    const wrap = el('div', undefined, 'export');
    const button = el('button', 'Export session file', 'btn btn-primary');
    const msg = el('p', '', 'hint');
    button.addEventListener('click', () => {
      void (async () => {
        const out = await exportSession(store, meta.id);
        // The self-check runs on every export, not only in the unit tests.
        const problems = checkSessionExport(out);
        if (problems.length > 0) {
          msg.className = 'error';
          msg.textContent = `Export refused: ${problems.join('; ')}`;
          return;
        }
        // A local download of derived numbers; nothing is uploaded.
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(out)], { type: 'application/json' }),
        );
        const a = el('a');
        a.href = url;
        a.download = exportFileName(meta);
        a.click();
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 1000);
        msg.textContent = `Saved ${a.download} (${String(out.frames.length)} frames). Back it up to two places outside git today.`;
      })();
    });
    wrap.append(button, msg);
    return wrap;
  }

  /** Sessions still in this browser, unfinished ones included (a crashed tab). */
  async function storedSessions(): Promise<HTMLElement> {
    const card = el('div', undefined, 'card');
    card.append(el('h2', 'Stored sessions on this computer'));
    const sessions = await store.listSessions().catch(() => []);
    if (sessions.length === 0) {
      card.append(el('p', 'None.', 'hint'));
      return card;
    }
    for (const meta of sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
      const row = el('div', undefined, 'session-row');
      const del = el('button', 'Delete', 'btn btn-quiet');
      del.addEventListener('click', () => {
        if (!confirm(`Delete ${meta.participant}'s session from this browser? Export it first.`))
          return;
        void store.deleteSession(meta.id).then(() => setupScreen());
      });
      row.append(
        el(
          'span',
          `${meta.participant} Â· ${meta.startedAt.slice(0, 16).replace('T', ' ')} Â· ${String(meta.blocks.length)} blocks Â· ${meta.finishedAt ? 'finished' : 'unfinished'}`,
        ),
        exportButton(meta),
        del,
      );
      card.append(row);
    }
    return card;
  }

  void setupScreen();
}

function checkbox(text: string): { element: HTMLElement; input: HTMLInputElement } {
  const label = el('label', undefined, 'check');
  const input = el('input');
  input.type = 'checkbox';
  label.append(input, el('span', text));
  return { element: label, input };
}

function labelled(text: string, control: HTMLElement): HTMLElement {
  const label = el('label', undefined, 'field');
  label.append(el('span', text), control);
  return label;
}
