// Demo and debug page for the load sensor (TODO A2–A3): camera control and a
// live landmark overlay with fps, backend and frame time. The consent screen
// and feature charts come with TODO A4–A6.
//
// Sensing is off until the user presses "Turn sensing on" (invariant 4).

import { Camera, type CameraStatus } from '../core/camera/index.js';
import {
  LandmarkTracker,
  TfjsFaceMeshProvider,
  UnsupportedBackendError,
} from '../core/landmarks/index.js';
import { formatMs, LandmarkOverlay, StatsPanel } from './debug-overlay.js';

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

const app = document.querySelector<HTMLElement>('#app');
if (app) mount(app);

function mount(root: HTMLElement): void {
  const heading = el('h1', 'AdaptLearn C02 — Load sensor');
  const status = el('p', STATUS_TEXT.idle);
  status.dataset.testid = 'sensor-status';
  status.setAttribute('role', 'status');

  const enableBtn = button('Turn sensing on', 'enable');
  const pauseBtn = button('Pause', 'pause');
  const resumeBtn = button('Resume', 'resume');
  const disableBtn = button('Turn sensing off', 'disable');
  const controls = el('div');
  controls.className = 'controls';
  controls.append(enableBtn, pauseBtn, resumeBtn, disableBtn);

  const stage = el('div');
  stage.className = 'stage';
  const video = document.createElement('video');
  video.setAttribute('aria-label', 'Camera preview (never recorded or uploaded)');
  const canvas = document.createElement('canvas');
  stage.append(video, canvas);

  const panel = el('section');
  panel.setAttribute('aria-label', 'Debug read-out');
  const stats = new StatsPanel(panel, [
    { testId: 'camera-status', label: 'Camera' },
    { testId: 'live-tracks', label: 'Live camera tracks' },
    { testId: 'frame-clock', label: 'Frame clock' },
    { testId: 'resolution', label: 'Resolution' },
    { testId: 'camera-frames', label: 'Camera frames' },
    { testId: 'backend', label: 'Backend' },
    { testId: 'fps', label: 'Landmark fps' },
    { testId: 'frame-p50', label: 'Frame time p50' },
    { testId: 'frame-p95', label: 'Frame time p95' },
    { testId: 'dropped', label: 'Skipped (busy / rate)' },
    { testId: 'face', label: 'Face' },
    { testId: 'tensors', label: 'TF.js tensors' },
    { testId: 'errors', label: 'Inference errors' },
  ]);

  root.append(heading, status, controls, stage, panel);

  const camera = new Camera({ video });
  const provider = new TfjsFaceMeshProvider({
    modelBaseUrl: `${import.meta.env.BASE_URL}models/`,
    wasmBaseUrl: `${import.meta.env.BASE_URL}wasm/`,
  });
  const tracker = new LandmarkTracker(camera, provider);
  const overlay = new LandmarkOverlay(canvas);

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
  });
  tracker.onError((error) => {
    console.warn('Landmark inference failed for one frame', error);
  });

  camera.onStatus(({ status: next, error }) => {
    if (next !== 'active' && next !== 'paused') {
      tracker.stop();
      overlay.clear();
      face = 'not tracking';
    }
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
    status.textContent =
      message ??
      (modelState === 'loading' && (s === 'active' || s === 'paused')
        ? 'Loading the face model (served from this site, nothing is uploaded)…'
        : s === 'paused' && camera.pauseReasons.has('hidden') && !camera.pauseReasons.has('user')
          ? 'Sensing is paused while this tab is hidden.'
          : STATUS_TEXT[s]);
    const on = s === 'active' || s === 'paused' || s === 'starting';
    enableBtn.disabled = on;
    disableBtn.disabled = !on;
    pauseBtn.disabled = s !== 'active';
    resumeBtn.disabled = !(s === 'paused' && camera.pauseReasons.has('user'));
    stage.dataset.active = String(s === 'active' || s === 'paused');
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
  }

  render();
  renderStats();
  // The read-out refreshes twice a second; it is for humans, not measurement.
  window.setInterval(renderStats, 500);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, testId: string): HTMLButtonElement {
  const b = el('button', label);
  b.type = 'button';
  b.dataset.testid = testId;
  return b;
}
