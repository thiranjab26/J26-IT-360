// Demo and debug page for the load sensor (TODO A2–A4), in three tabs:
// - Camera: camera control, the live landmark overlay, the Wellbeing panel
//   (away/asleep alarm, screen time, health tips) and, in dev builds, the
//   fixture recorder.
// - Signals: calibration, KPIs, EAR trace and the per-second features.
// - Performance: fps, backend, frame time and pipeline read-outs.
// - Break: two short calm games (neck stretch steered by head pose, memory match).
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
import { AlarmSound, AttentionMonitor, type AlarmReason } from './attention-alarm.js';
import { BreakPanel } from './break/break-panel.js';
import { formatMs, LandmarkOverlay, StatsPanel } from './debug-overlay.js';
import { FixtureRecorder } from './fixture-recorder.js';
import { SignalsPanel } from './signals-panel.js';
import { Tabs, type TabTone } from './tabs.js';
import { WellbeingPanel } from './wellbeing-panel.js';

/** localStorage key for the alarm switch (a per-viewer preference only). */
const ALARM_PREF_KEY = 'adaptlearn.c2.alarm';

const ALARM_BANNER: Record<AlarmReason, string> = {
  absent: 'No one at the screen',
  asleep: 'Eyes closed — wake up',
};

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
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
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

  const scan = el('div');
  scan.className = 'scan';
  scan.setAttribute('aria-hidden', 'true');

  // Alarm banner over the video (also visible in the docked mini preview).
  const alarmBanner = el('div');
  alarmBanner.className = 'alarm-banner';
  alarmBanner.dataset.testid = 'alarm-banner';
  alarmBanner.setAttribute('aria-hidden', 'true');
  const alarmText = el('span', '');
  alarmBanner.append(icon(ICONS.bell), alarmText);

  stage.append(video, canvas, scan, corners, empty, hud, privacy, alarmBanner, expandBtn);

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

  // ── Wellbeing panel (right of the camera) ──
  const wellbeing = new WellbeingPanel();
  wellbeing.alarmSwitch.checked = readAlarmPref();

  // ── Performance read-outs (own tab) ──
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

  const perfGrid = el('div');
  perfGrid.className = 'perf-grid';
  perfGrid.setAttribute('aria-label', 'Debug read-out');
  perfGrid.append(perfCard, cameraInfo, pipelineInfo);

  const layout = el('div');
  layout.className = 'layout';
  layout.append(cameraCard, wellbeing.element);

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
  const perfPanel = el('section');
  perfPanel.id = 'panel-performance';
  perfPanel.className = 'panel';
  const perfHead = el('header');
  perfHead.className = 'section-head';
  const perfTitles = el('div');
  const perfTitle = el('h2', 'Performance');
  perfTitle.className = 'section-title';
  const perfSub = el(
    'p',
    'Live read-outs for debugging. Frame time here is time inside the face model; the latency benchmark (TODO A7) measures end to end.',
  );
  perfSub.className = 'section-sub';
  perfTitles.append(perfTitle, perfSub);
  perfHead.append(perfTitles);
  perfPanel.append(perfHead, perfGrid);
  const breakPanel = new BreakPanel({
    requestSensing: () => {
      alarmSound.unlock();
      void enable();
    },
    stopSensing: () => {
      disable();
    },
    onBreakTaken: () => {
      wellbeing.markBreak();
    },
    onLayout: () => {
      placeDock();
    },
  });
  const breakTabPanel = el('section');
  breakTabPanel.id = 'panel-break';
  breakTabPanel.className = 'panel';
  breakTabPanel.append(breakPanel.element);

  const tabs = new Tabs(
    [
      // Kept rendered so the video keeps producing frames; on the
      // other tabs it shrinks to a mini preview in the corner (styles.css, "Dock").
      { id: 'camera', index: '01', label: 'Camera', panel: cameraPanel, keepRendered: true },
      { id: 'signals', index: '02', label: 'Signals', panel: signalsPanel },
      { id: 'performance', index: '03', label: 'Performance', panel: perfPanel },
      { id: 'break', index: '04', label: 'Break', panel: breakTabPanel },
    ],
    'Views',
  );
  tabs.onChange((id) => {
    window.scrollTo({ top: 0 });
    // Games pause whenever their tab is not on screen.
    breakPanel.setVisible(id === 'break');
    render();
  });
  breakPanel.setVisible(tabs.active === 'break');
  wellbeing.onPlayStretch = () => {
    tabs.select('break');
    breakPanel.open('neck');
  };
  expandBtn.addEventListener('click', () => {
    tabs.select('camera', true);
  });

  root.append(topbar, tabs.element, cameraPanel, signalsPanel, perfPanel, breakTabPanel, footer);

  // ── Pipeline ──
  const camera = new Camera({ video });
  const provider = new TfjsFaceMeshProvider({
    modelBaseUrl: `${import.meta.env.BASE_URL}models/`,
    wasmBaseUrl: `${import.meta.env.BASE_URL}wasm/`,
  });
  const tracker = new LandmarkTracker(camera, provider);
  const overlay = new LandmarkOverlay(canvas);
  const attention = new AttentionMonitor();
  const alarmSound = new AlarmSound();
  let pipeline = createPipeline(true);

  function createPipeline(useExpressionFeatures: boolean): FeaturePipeline {
    const p = new FeaturePipeline({ useExpressionFeatures });
    p.onFrame((f) => {
      signals.pushFrame(f);
      breakPanel.pushPose(
        f.tMs,
        f.signals ? { yaw: f.signals.yaw, pitch: f.signals.pitch, roll: f.signals.roll } : null,
      );
      attention.update({ tMs: f.tMs, faceFound: f.signals !== null, eyesClosed: f.eyesClosed });
      renderAlarm();
    });
    p.onSecond((s) => {
      signals.pushSecond(s);
      wellbeing.pushSecond(s);
      signals.setState(p.state);
    });
    return p;
  }

  wellbeing.alarmSwitch.addEventListener('change', () => {
    writeAlarmPref(wellbeing.alarmSwitch.checked);
    // A click is a user gesture: the browser now allows audio.
    if (wellbeing.alarmSwitch.checked) alarmSound.unlock();
    renderAlarm();
  });
  wellbeing.testButton.addEventListener('click', () => {
    alarmSound.test();
  });

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
    const next = sample.face ? 'found' : 'none';
    if (next !== face) {
      face = next;
      renderFaceChip();
    }
    overlay.update(sample.face, video.videoWidth, video.videoHeight, sample.tMs);
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
      wellbeing.reset();
    }
    // No frames while paused: start the away/asleep timers again on resume.
    if (next !== 'active') attention.reset();
    renderAlarm();
    if (next === 'active' && !pipeline.baseline.ready) signals.setState(pipeline.state);
    if (error) console.info(`Camera ${error.status}: ${error.name} — ${error.message}`);
    render();
  });

  enableBtn.addEventListener('click', () => {
    // Unlock audio inside the click, before any await (autoplay policy).
    alarmSound.unlock();
    void enable();
  });
  pauseBtn.addEventListener('click', () => {
    camera.pause('user');
  });
  resumeBtn.addEventListener('click', () => {
    camera.resume('user');
  });
  disableBtn.addEventListener('click', () => {
    disable();
  });

  function disable(): void {
    tracker.stop();
    camera.stop();
    message = null;
    render();
  }

  /**
   * On the Break tab the neck game has a slot for the live preview: the camera
   * card is positioned over it (page coordinates, so scrolling needs no
   * updates). Moving the <video> element itself could pause it, so it stays put.
   */
  let dockFrame = 0;
  function placeDock(): void {
    if (dockFrame) return;
    dockFrame = requestAnimationFrame(() => {
      dockFrame = 0;
      const slot = tabs.active === 'break' ? breakPanel.cameraSlot : null;
      const running = camera.status === 'active' || camera.status === 'paused';
      const r = slot?.getBoundingClientRect();
      if (!r || !running || r.width === 0) {
        delete cameraPanel.dataset.dock;
        return;
      }
      cameraPanel.dataset.dock = 'slot';
      cameraCard.style.setProperty('--slot-x', `${String(r.left + window.scrollX)}px`);
      cameraCard.style.setProperty('--slot-y', `${String(r.top + window.scrollY)}px`);
      cameraCard.style.setProperty('--slot-w', `${String(r.width)}px`);
    });
  }
  window.addEventListener('resize', placeDock);
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
    breakPanel.setSensing(s === 'active');
    placeDock();
    liveText.textContent = s === 'paused' ? 'PAUSED' : 'LIVE';
    renderFaceChip();
  }

  function renderAlarm(): void {
    const sensing = camera.status === 'active';
    const reason = sensing && wellbeing.alarmSwitch.checked ? attention.state.reason : null;
    if (reason) alarmSound.start(reason);
    else alarmSound.stop();
    wellbeing.setAlarm(
      reason ??
        (!sensing ? 'sensing-off' : wellbeing.alarmSwitch.checked ? 'watching' : 'disabled'),
    );
    if (reason) {
      stage.dataset.alarm = reason;
      alarmText.textContent = ALARM_BANNER[reason];
    } else {
      delete stage.dataset.alarm;
    }
  }

  function renderFaceChip(): void {
    const text =
      modelState === 'loading'
        ? 'Loading model…'
        : face === 'found'
          ? 'Face detected'
          : face === 'none'
            ? 'Scanning for a face'
            : 'Waiting for frames';
    if (faceChip.textContent !== text) faceChip.textContent = text;
    faceChip.dataset.face = face;
    // Scan-line sweep while the model loads or no face has been found yet.
    const running = camera.status === 'active' || camera.status === 'paused';
    stage.dataset.scan = String(running && (modelState === 'loading' || face !== 'found'));
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
    wellbeing.tick(camera.status === 'active', face === 'found');
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
    const alarm = attention.state.reason;
    if (alarm && stage.dataset.alarm) {
      tabs.setMeta('camera', alarm === 'absent' ? 'Alarm · away' : 'Alarm · eyes closed', 'error');
    }
    tabs.setMeta(
      'performance',
      tracker.running && Number.isFinite(tracker.stats.inferenceP95)
        ? `p95 ${formatMs(tracker.stats.inferenceP95)}`
        : (provider.backend ?? 'Idle'),
      tracker.running ? 'live' : 'idle',
    );
    const game = breakPanel.active;
    tabs.setMeta(
      'break',
      game === 'neck'
        ? 'Playing · neck stretch'
        : game === 'memory'
          ? 'Playing · memory'
          : '2 calm games',
      game ? 'live' : 'idle',
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

function readAlarmPref(): boolean {
  try {
    return localStorage.getItem(ALARM_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeAlarmPref(on: boolean): void {
  try {
    localStorage.setItem(ALARM_PREF_KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked (private window): the switch still works for this visit.
  }
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
