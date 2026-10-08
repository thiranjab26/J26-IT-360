// Demo and debug page for the load sensor (TODO A2–A4), in two tabs:
// - Camera: camera control, a live landmark overlay with fps, backend and
//   frame time, and (dev builds) the fixture recorder.
// - Signals: calibration, KPIs, EAR trace and the per-second features.
// The consent screen comes with TODO A6.
//
// Sensing is off until the user presses "Turn sensing on" (invariant 4).

import './styles.css';
import { Camera, type CameraStatus } from '../core/camera/index.js';
import {
  LandmarkTracker,
  TfjsFaceMeshProvider,
  UnsupportedBackendError,
} from '../core/landmarks/index.js';
import { FeaturePipeline } from '../core/window/index.js';
import { formatMs, LandmarkOverlay, StatsPanel } from './debug-overlay.js';
import { FixtureRecorder } from './fixture-recorder.js';
import { SignalsPanel } from './signals-panel.js';
import { Tabs, type TabTone } from './tabs.js';

const STATUS_TEXT: Record<CameraStatus, string> = {
  idle: 'Sensing is off.',
  starting: 'Waiting for camera permission…',
  active: 'Sensing is on.',
  paused: 'Sensing is paused.',
  stopped: 'Sensing is off.',
  permission_denied:
    'Camera permission was denied. Allow the camera in the browser’s site settings, then try again.',
  no_camera: 'No camera was found, or it was disconnected.',
  camera_in_use: 'The camera is being used by another app. Close that app and try again.',
  unsupported: 'This browser cannot open the camera here (it needs https or localhost).',
  error: 'The camera could not be started.',
};

type Tone = 'idle' | 'busy' | 'live' | 'paused' | 'error';

// Static inline icons (24×24, stroke = currentColor). No icon font or CDN (invariant 3).
const ICONS = {
  logo: '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7a5 5 0 1 0 5 5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  camera:
    '<path d="M15 10.5 20.2 7.6a.5.5 0 0 1 .8.4v8a.5.5 0 0 1-.8.4L15 13.5"/><rect x="3" y="6" width="12" height="12" rx="2.5"/>',
  cameraOff:
    '<path d="M3 3l18 18"/><path d="M15 10.5 20.2 7.6a.5.5 0 0 1 .8.4v8a.5.5 0 0 1-.8.4L15 13.5"/><path d="M11 6h1.5A2.5 2.5 0 0 1 15 8.5V12M15 16a2.5 2.5 0 0 1-2.5 2H5.5A2.5 2.5 0 0 1 3 15.5v-7A2.5 2.5 0 0 1 5 6"/>',
  pause:
    '<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>',
  play: '<path d="M7 5.5v13a.8.8 0 0 0 1.2.7l10.5-6.5a.8.8 0 0 0 0-1.4L8.2 4.8A.8.8 0 0 0 7 5.5z"/>',
  power: '<path d="M12 3v8"/><path d="M6.4 6.4a8 8 0 1 0 11.2 0"/>',
  shield:
    '<path d="M12 3 5 6v5c0 4.5 3 8.4 7 10 4-1.6 7-5.5 7-10V6l-7-3z"/><path d="m9 12 2 2 4-4"/>',
  expand: '<path d="M14 4h6v6"/><path d="M20 4l-7 7"/><path d="M10 20H4v-6"/><path d="M4 20l7-7"/>',
} as const;

const app = document.querySelector<HTMLElement>('#app');
if (app) mount(app);

function mount(root: HTMLElement): void {
  // ── Header ──
  const brandMark = el('div');
  brandMark.className = 'brand-mark';
  brandMark.append(icon(ICONS.logo));
  const eyebrow = el('p', 'AdaptLearn · Component 02');
  eyebrow.className = 'brand-eyebrow';
  const heading = el('h1', 'AdaptLearn C02 — Load sensor');
  const brandText = el('div');
  brandText.append(eyebrow, heading);
  const brand = el('div');
  brand.className = 'brand';
  brand.append(brandMark, brandText);

  const pill = el('div');
  pill.className = 'status-pill';
  const pillDot = el('span');
  pillDot.className = 'dot';
  const status = el('span', STATUS_TEXT.idle);
  status.dataset.testid = 'sensor-status';
  status.setAttribute('role', 'status');
  pill.append(pillDot, status);

  const topbar = el('header');
  topbar.className = 'topbar';
  topbar.append(brand, pill);

  // ── Camera stage ──
  const stage = el('div');
  stage.className = 'stage';
  const video = document.createElement('video');
  video.setAttribute('aria-label', 'Camera preview (never recorded or uploaded)');
  const canvas = document.createElement('canvas');

  const empty = el('div');
  empty.className = 'stage-empty';
  const emptyIcon = el('div');
  emptyIcon.className = 'icon';
  emptyIcon.append(icon(ICONS.cameraOff));
  const emptyTitle = el('strong', 'Camera is off');
  const emptyText = el(
    'span',
    'Turn sensing on to start. Video is analysed on this device and never recorded or uploaded.',
  );
  empty.append(emptyIcon, emptyTitle, emptyText);

  const hud = el('div');
  hud.className = 'hud';
  const liveChip = el('span');
  liveChip.className = 'chip';
  const liveDot = el('span');
  liveDot.className = 'dot';
  const liveText = el('span', 'LIVE');
  liveChip.append(liveDot, liveText);
  const faceChip = el('span', 'Starting…');
  faceChip.className = 'chip';
  hud.append(liveChip, faceChip);

  const privacy = el('span');
  privacy.className = 'chip privacy-chip';
  privacy.append(icon(ICONS.shield), el('span', 'On-device · nothing uploaded'));

  // Viewfinder corners: decoration only.
  const corners = el('div');
  corners.className = 'viewfinder';
  corners.setAttribute('aria-hidden', 'true');

  // Shown only while the camera is docked as a mini preview on another tab.
  const expandBtn = el('button');
  expandBtn.type = 'button';
  expandBtn.className = 'dock-expand';
  expandBtn.dataset.testid = 'dock-expand';
  expandBtn.setAttribute('aria-label', 'Open the camera view');
  expandBtn.append(icon(ICONS.expand));

  stage.append(video, canvas, corners, empty, hud, privacy, expandBtn);

  // ── Controls ──
  const enableBtn = button('Turn sensing on', 'enable', ICONS.camera, 'btn-primary');
  const pauseBtn = button('Pause', 'pause', ICONS.pause);
  const resumeBtn = button('Resume', 'resume', ICONS.play);
  const disableBtn = button('Turn sensing off', 'disable', ICONS.power, 'btn-danger');
  const spacer = el('div');
  spacer.className = 'spacer';
  const pointsSwitch = toggle('Feature points', 'toggle-points', false);
  pointsSwitch.root.title = 'Ring and number every landmark the features use (TODO A4 check).';
  const controls = el('div');
  controls.className = 'controls';
  controls.append(enableBtn, pauseBtn, resumeBtn, disableBtn, spacer, pointsSwitch.root);

  const cameraCard = el('section');
  cameraCard.className = 'card camera-card';
  cameraCard.setAttribute('aria-label', 'Camera');
  cameraCard.append(stage, controls);

  // ── Side panel ──
  const stats = new StatsPanel();

  const perfCard = card('Performance');
  stats.addTiles(perfCard, [
    { testId: 'fps', label: 'Landmark fps / target' },
    { testId: 'backend', label: 'Backend' },
    { testId: 'frame-p50', label: 'Frame time p50' },
    { testId: 'frame-p95', label: 'Frame time p95' },
  ]);

  const cameraInfo = card('Camera');
  stats.addList(cameraInfo, [
    { testId: 'camera-status', label: 'Status' },
    { testId: 'live-tracks', label: 'Live tracks' },
    { testId: 'frame-clock', label: 'Frame clock' },
    { testId: 'resolution', label: 'Resolution' },
    { testId: 'camera-frames', label: 'Frames received' },
  ]);

  const pipelineInfo = card('Pipeline');
  stats.addList(pipelineInfo, [
    { testId: 'face', label: 'Face' },
    { testId: 'dropped', label: 'Skipped (busy / rate)' },
    { testId: 'tensors', label: 'TF.js tensors' },
    { testId: 'errors', label: 'Inference errors' },
  ]);

  const side = el('aside');
  side.className = 'side';
  side.setAttribute('aria-label', 'Debug read-out');
  side.append(perfCard, cameraInfo, pipelineInfo);

  const layout = el('div');
  layout.className = 'layout';
  layout.append(cameraCard, side);

  const footer = el(
    'p',
    'Debug view · MediaPipe FaceMesh via TensorFlow.js · all models served from this site',
  );
  footer.className = 'footer';

  // ── Signals dashboard (A4) ──
  const signals = new SignalsPanel();
  const expressionSwitch = toggle('Expression features', 'toggle-expression', true);
  expressionSwitch.root.title =
    'FR3 ablation: off zeroes mouth-open and lip-thickness. Changing it restarts calibration.';
  signals.toolbar.prepend(expressionSwitch.root);
  // Development builds only: the recorder is tree-shaken out of production.
  const recorder = import.meta.env.DEV ? new FixtureRecorder() : null;

  // ── Tabs: Camera | Signals ──
  const cameraPanel = el('section');
  cameraPanel.id = 'panel-camera';
  cameraPanel.className = 'panel camera-panel';
  cameraPanel.append(layout, ...(recorder ? [recorder.element] : []));
  const signalsPanel = el('section');
  signalsPanel.id = 'panel-signals';
  signalsPanel.className = 'panel';
  signalsPanel.append(signals.element);
  const tabs = new Tabs(
    [
      // Kept rendered so the video keeps producing frames; on the Signals tab
      // it shrinks to a mini preview in the corner (styles.css, "Dock").
      { id: 'camera', index: '01', label: 'Camera', panel: cameraPanel, keepRendered: true },
      { id: 'signals', index: '02', label: 'Signals', panel: signalsPanel },
    ],
    'Views',
  );
  tabs.onChange(() => {
    window.scrollTo({ top: 0 });
    render();
  });
  expandBtn.addEventListener('click', () => {
    tabs.select('camera', true);
  });

  root.append(topbar, tabs.element, cameraPanel, signalsPanel, footer);

  // ── Pipeline ──
  const camera = new Camera({ video });
  const provider = new TfjsFaceMeshProvider({
    modelBaseUrl: `${import.meta.env.BASE_URL}models/`,
    wasmBaseUrl: `${import.meta.env.BASE_URL}wasm/`,
  });
  const tracker = new LandmarkTracker(camera, provider);
  const overlay = new LandmarkOverlay(canvas);
  let pipeline = createPipeline(true);

  function createPipeline(useExpressionFeatures: boolean): FeaturePipeline {
    const p = new FeaturePipeline({ useExpressionFeatures });
    p.onFrame((f) => {
      signals.pushFrame(f);
    });
    p.onSecond((s) => {
      signals.pushSecond(s);
      signals.setState(p.state);
    });
    return p;
  }

  pointsSwitch.input.addEventListener('change', () => {
    overlay.featurePoints = pointsSwitch.input.checked;
  });
  expressionSwitch.input.addEventListener('change', () => {
    // A different feature definition needs a fresh baseline (FeaturePipelineOptions).
    pipeline = createPipeline(expressionSwitch.input.checked);
    signals.reset();
    if (camera.status === 'active' || camera.status === 'paused') signals.setState(pipeline.state);
  });

  let cameraFrames = 0;
  let face = 'not tracking';
  let modelState: 'not loaded' | 'loading' | 'ready' | 'failed' = 'not loaded';
  let message: string | null = null;

  camera.onFrame(() => {
    cameraFrames += 1;
  });

  tracker.onSample((sample) => {
    face = sample.face ? 'found' : 'none';
    overlay.draw(sample.face, video.videoWidth, video.videoHeight);
    const aspect = video.videoWidth > 0 ? video.videoWidth / video.videoHeight : 4 / 3;
    const landmarks = sample.face?.landmarks ?? null;
    pipeline.push(sample.tMs, landmarks, aspect);
    recorder?.push(sample.tMs, landmarks, aspect);
  });
  tracker.onError((error) => {
    console.warn('Landmark inference failed for one frame', error);
  });

  camera.onStatus(({ status: next, error }) => {
    if (next !== 'active' && next !== 'paused') {
      tracker.stop();
      overlay.clear();
      face = 'not tracking';
      // Sensing ended: the next session gets a fresh baseline.
      pipeline.reset();
      signals.reset();
    }
    if (next === 'active' && !pipeline.baseline.ready) signals.setState(pipeline.state);
    if (error) console.info(`Camera ${error.status}: ${error.name} — ${error.message}`);
    render();
  });

  enableBtn.addEventListener('click', () => {
    void enable();
  });
  pauseBtn.addEventListener('click', () => {
    camera.pause('user');
  });
  resumeBtn.addEventListener('click', () => {
    camera.resume('user');
  });
  disableBtn.addEventListener('click', () => {
    tracker.stop();
    camera.stop();
    message = null;
    render();
  });
  // Release the camera when the page goes away, including bfcache navigations.
  window.addEventListener('pagehide', () => {
    tracker.stop();
    camera.stop();
  });

  async function enable(): Promise<void> {
    message = null;
    const result = await camera.start();
    if (result !== 'active' && result !== 'paused') return;

    if (modelState !== 'ready') {
      modelState = 'loading';
      render();
      try {
        await provider.init();
        modelState = 'ready';
      } catch (error) {
        modelState = 'failed';
        camera.stop();
        message =
          error instanceof UnsupportedBackendError
            ? 'This device cannot run the face model fast enough (no WebGL or WebAssembly backend).'
            : `The face model could not be loaded: ${error instanceof Error ? error.message : String(error)}`;
        console.error(error);
        render();
        return;
      }
    }
    // The user may have turned sensing off while the model was loading.
    if (camera.status === 'active' || camera.status === 'paused') tracker.start();
    render();
  }

  function render(): void {
    const s = camera.status;
    const running = s === 'active' || s === 'paused';
    const loading = modelState === 'loading' && running;
    const hiddenPause =
      s === 'paused' && camera.pauseReasons.has('hidden') && !camera.pauseReasons.has('user');

    status.textContent =
      message ??
      (loading
        ? 'Loading the face model (served from this site, nothing is uploaded)…'
        : hiddenPause
          ? 'Sensing is paused while this tab is hidden.'
          : STATUS_TEXT[s]);
    pill.dataset.tone = toneFor(s, loading, message !== null);

    const on = running || s === 'starting';
    enableBtn.hidden = on;
    disableBtn.hidden = !on;
    const userPaused = s === 'paused' && camera.pauseReasons.has('user');
    resumeBtn.hidden = !userPaused;
    pauseBtn.hidden = userPaused;
    pauseBtn.disabled = s !== 'active';

    stage.dataset.active = String(running);
    stage.dataset.paused = String(s === 'paused');
    cameraPanel.dataset.running = String(running);
    expandBtn.hidden = tabs.active === 'camera';
    liveText.textContent = s === 'paused' ? 'PAUSED' : 'LIVE';
    renderFaceChip();
  }

  function renderFaceChip(): void {
    const text =
      modelState === 'loading'
        ? 'Loading model…'
        : face === 'found'
          ? 'Face detected'
          : face === 'none'
            ? 'No face in view'
            : 'Waiting for frames';
    if (faceChip.textContent !== text) faceChip.textContent = text;
    faceChip.dataset.face = face;
  }

  function renderStats(): void {
    const st = tracker.stats;
    const settings = camera.settings;
    stats.set('camera-status', camera.status);
    stats.set('live-tracks', String(camera.liveTrackCount));
    stats.set('frame-clock', camera.frameClock ?? '–');
    stats.set(
      'resolution',
      settings?.width && settings.height
        ? `${String(settings.width)}×${String(settings.height)} @ ${String(Math.round(settings.frameRate ?? 0))} fps`
        : '–',
    );
    stats.set('camera-frames', String(cameraFrames));
    stats.set('backend', provider.backend ?? modelState);
    stats.set('fps', tracker.running ? `${st.fps.toFixed(1)} / ${String(st.targetFps)}` : '–');
    stats.set('frame-p50', formatMs(st.inferenceP50));
    stats.set('frame-p95', formatMs(st.inferenceP95));
    stats.set('dropped', `${String(st.droppedBusy)} / ${String(st.droppedRate)}`);
    stats.set('face', face);
    stats.set('tensors', String(provider.numTensors ?? '–'));
    stats.set('errors', String(st.errors));
    renderFaceChip();
    renderTabMeta();
  }

  function renderTabMeta(): void {
    const s = camera.status;
    const tone = toneFor(s, false, message !== null);
    const camTone: TabTone = tone === 'paused' ? 'busy' : tone;
    tabs.setMeta(
      'camera',
      s === 'active'
        ? tracker.running
          ? `Live · ${tracker.stats.fps.toFixed(0)} fps`
          : 'Loading model'
        : s === 'paused'
          ? 'Paused'
          : s === 'starting'
            ? 'Starting'
            : camTone === 'error'
              ? 'Needs attention'
              : 'Off',
      camTone,
    );
    const state = pipeline.state;
    const running = s === 'active' || s === 'paused';
    if (!running) {
      tabs.setMeta('signals', 'Waiting for camera', 'idle');
    } else if (state.phase === 'calibrating') {
      tabs.setMeta(
        'signals',
        `Calibrating ${String(Math.round(state.calibrationProgress * 100))} %`,
        'busy',
      );
    } else {
      tabs.setMeta(
        'signals',
        state.classifiable ? 'Baseline ready' : 'Filling window',
        state.classifiable ? 'live' : 'busy',
      );
    }
  }

  render();
  renderStats();
  // The read-out refreshes twice a second; it is for humans, not measurement.
  window.setInterval(renderStats, 500);
}

function toneFor(status: CameraStatus, loading: boolean, failed: boolean): Tone {
  if (failed) return 'error';
  if (loading || status === 'starting') return 'busy';
  switch (status) {
    case 'active':
      return 'live';
    case 'paused':
      return 'paused';
    case 'idle':
    case 'stopped':
      return 'idle';
    default:
      return 'error';
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(paths: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  // Paths are the static constants above, never user or network data.
  svg.innerHTML = paths;
  return svg;
}

function card(title: string): HTMLElement {
  const section = el('section');
  section.className = 'card';
  const header = el('div');
  header.className = 'card-header';
  const h = el('h2', title);
  h.className = 'card-title';
  header.append(h);
  section.append(header);
  return section;
}

function button(label: string, testId: string, svg: string, variant?: string): HTMLButtonElement {
  const b = el('button');
  b.type = 'button';
  b.className = variant ? `btn ${variant}` : 'btn';
  b.dataset.testid = testId;
  b.append(icon(svg), el('span', label));
  return b;
}

/** Accessible switch: a real checkbox with role="switch", styled as a toggle. */
function toggle(
  label: string,
  testId: string,
  checked: boolean,
): { root: HTMLLabelElement; input: HTMLInputElement } {
  const root = el('label');
  root.className = 'switch';
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.setAttribute('role', 'switch');
  input.dataset.testid = testId;
  const track = el('span');
  track.className = 'switch-track';
  track.setAttribute('aria-hidden', 'true');
  root.append(input, track, el('span', label));
  return { root, input };
}
