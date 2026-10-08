// Cog admin: settings panel for the load-sensor demo (cog-admin.html). No login for now: it is
// a local settings page for the person running the demo.
//
// - Settings are written to localStorage and the sensor page picks them up
//   live through the `storage` event (src/demo/settings.ts).
// - Live status and session commands go over a same-origin BroadcastChannel.
//   Only counters and states cross it, never frames or landmarks (invariant 1).
// - Turning sensing *on* stays on the sensor page, where the camera and its
//   consent are (invariant 4). From here it can be paused, resumed or stopped.
// - The research pipeline constants are shown read-only: they are baked into
//   feature_spec.json and must match what the model was trained on.

import '../demo/styles.css';
import './admin.css';
import { FEATURE_CONFIG } from '../core/features/config.js';
import { AlarmSound } from '../demo/attention-alarm.js';
import {
  DEFAULT_SETTINGS,
  LIMITS,
  openControlChannel,
  SettingsStore,
  STORAGE_PREFIX,
  type ControlCommand,
  type DemoSettings,
  type SensorStatus,
} from '../demo/settings.js';

// Static inline icons (24Ã—24, stroke = currentColor). No icon font or CDN (invariant 3).
const ICONS = {
  logo: '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7a5 5 0 1 0 5 5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  overview:
    '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  camera:
    '<path d="M15 10.5 20.2 7.6a.5.5 0 0 1 .8.4v8a.5.5 0 0 1-.8.4L15 13.5"/><rect x="3" y="6" width="12" height="12" rx="2.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  heart:
    '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  flask:
    '<path d="M9.5 3.5h5M10.5 3.5v6L5 19a1.3 1.3 0 0 0 1.1 2h11.8A1.3 1.3 0 0 0 19 19l-5.5-9.5v-6"/><path d="M7.5 15h9"/>',
  shield:
    '<path d="M12 3 5 6v5c0 4.5 3 8.4 7 10 4-1.6 7-5.5 7-10V6l-7-3z"/><path d="m9 12 2 2 4-4"/>',
  external:
    '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  pause:
    '<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>',
  play: '<path d="M7 5.5v13a.8.8 0 0 0 1.2.7l10.5-6.5a.8.8 0 0 0 0-1.4L8.2 4.8A.8.8 0 0 0 7 5.5z"/>',
  power: '<path d="M12 3v8"/><path d="M6.4 6.4a8 8 0 1 0 11.2 0"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  coffee:
    '<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5v2.5M12 3.5v2.5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  trash:
    '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4.5h6V7"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  volume:
    '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
} as const;

/** No status for this long and the sensor page counts as closed (it publishes every 500 ms). */
const STALE_MS = 2000;

const CAMERA_LABEL: Record<SensorStatus['camera'], string> = {
  idle: 'Off',
  starting: 'Starting',
  active: 'Live',
  paused: 'Paused',
  stopped: 'Off',
  permission_denied: 'Permission denied',
  no_camera: 'No camera',
  camera_in_use: 'Camera in use',
  unsupported: 'Unsupported',
  error: 'Error',
};

interface Section {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly element: HTMLElement;
}

function mount(root: HTMLElement): void {
  const settings = new SettingsStore();
  const sound = new AlarmSound();
  sound.volume = settings.value.alarm.volume / 100;

  let status: SensorStatus | null = null;
  let lastStatusAt = 0;
  const channel = openControlChannel((m) => {
    if (m.type !== 'status') return;
    status = m.status;
    lastStatusAt = performance.now();
    renderStatus();
  });
  channel?.post({ type: 'hello' });
  const send = (command: ControlCommand): void => {
    channel?.post({ type: 'command', command });
  };

  // â”€â”€ Sections â”€â”€
  const overview = buildOverview(send);
  const sensing = buildSensing(settings);
  const alarm = buildAlarm(settings, sound);
  const wellbeing = buildWellbeing(settings);
  const research = buildResearch();
  const privacy = buildPrivacy(settings);

  const sections: Section[] = [
    { id: 'overview', label: 'Overview', icon: ICONS.overview, element: overview.element },
    { id: 'sensing', label: 'Sensing', icon: ICONS.camera, element: sensing.element },
    { id: 'alarm', label: 'Alarm', icon: ICONS.bell, element: alarm.element },
    { id: 'wellbeing', label: 'Wellbeing', icon: ICONS.heart, element: wellbeing.element },
    { id: 'research', label: 'Research config', icon: ICONS.flask, element: research },
    { id: 'privacy', label: 'Privacy & data', icon: ICONS.shield, element: privacy.element },
  ];

  // â”€â”€ Sidebar â”€â”€
  const side = el('nav', 'admin-side');
  side.setAttribute('aria-label', 'Admin sections');
  const brand = el('a', 'admin-brand');
  brand.href = '#overview';
  const mark = el('span', 'brand-mark');
  mark.append(icon(ICONS.logo));
  const brandText = el('span', 'admin-brand-text');
  brandText.append(el('span', 'brand-eyebrow', 'AdaptLearn Â· C02'), el('strong', '', 'Cog admin'));
  brand.append(mark, brandText);
  const navList = el('ul', 'admin-nav');
  const navLinks = new Map<string, HTMLAnchorElement>();
  for (const s of sections) {
    const li = el('li');
    const a = el('a', 'admin-nav-link');
    a.href = `#${s.id}`;
    a.append(icon(s.icon), el('span', '', s.label));
    li.append(a);
    navList.append(li);
    navLinks.set(s.id, a);
  }
  const sensorLink = el('a', 'btn btn-small admin-open');
  sensorLink.href = `${import.meta.env.BASE_URL}index.html`;
  sensorLink.target = 'adaptlearn-c2-sensor';
  sensorLink.append(icon(ICONS.external), el('span', '', 'Open sensor page'));
  side.append(brand, navList, sensorLink);

  // â”€â”€ Header â”€â”€
  const head = el('header', 'admin-head');
  const titles = el('div');
  titles.append(
    el('h1', '', 'Cognitive load sensor'),
    el(
      'p',
      'admin-sub',
      'Settings apply instantly to the sensor page in this browser. Nothing here is sent anywhere.',
    ),
  );
  const conn = el('div', 'status-pill');
  conn.dataset.testid = 'admin-connection';
  const connDot = el('span', 'dot');
  const connText = el('span', '', 'Looking for the sensor pageâ€¦');
  connText.setAttribute('role', 'status');
  conn.append(connDot, connText);
  const saved = el('span', 'admin-saved');
  saved.append(icon(ICONS.check), el('span', '', 'Saved'));
  const headRight = el('div', 'admin-head-right');
  headRight.append(saved, conn);
  head.append(titles, headRight);

  const content = el('main', 'admin-main');
  content.append(head, ...sections.map((s) => s.element));
  root.append(side, content);

  // â”€â”€ Behaviour â”€â”€
  let savedTimer = 0;
  settings.onChange((s) => {
    sound.volume = s.alarm.volume / 100;
    sensing.render(s);
    alarm.render(s);
    wellbeing.render(s);
    privacy.render();
    saved.dataset.show = 'true';
    window.clearTimeout(savedTimer);
    savedTimer = window.setTimeout(() => {
      delete saved.dataset.show;
    }, 1400);
  });

  // Highlight the section in view.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const [id, a] of navLinks) {
          if (id === e.target.id) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        }
      }
    },
    { rootMargin: '-35% 0px -60% 0px' },
  );
  for (const s of sections) observer.observe(s.element);

  function renderStatus(): void {
    const fresh = status !== null && performance.now() - lastStatusAt < STALE_MS;
    if (!channel) {
      connText.textContent = 'Live link not supported in this browser';
      conn.dataset.tone = 'error';
    } else if (!fresh) {
      connText.textContent = 'Sensor page not open';
      conn.dataset.tone = 'idle';
    } else if (status?.camera === 'active') {
      connText.textContent = 'Connected Â· sensing live';
      conn.dataset.tone = 'live';
    } else {
      connText.textContent = 'Connected Â· sensing off';
      conn.dataset.tone = status?.camera === 'paused' ? 'paused' : 'idle';
    }
    overview.render(fresh ? status : null);
  }

  sensing.render(settings.value);
  alarm.render(settings.value);
  wellbeing.render(settings.value);
  privacy.render();
  renderStatus();
  window.setInterval(renderStatus, 1000);
}

// â”€â”€ Overview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildOverview(send: (c: ControlCommand) => void): {
  element: HTMLElement;
  render(s: SensorStatus | null): void;
} {
  const { element, body } = section(
    'overview',
    'Overview',
    'Live state of the sensor page, refreshed twice a second.',
  );

  const tiles = el('div', 'admin-tiles');
  const tile = (
    label: string,
    testId: string,
  ): { value: HTMLElement; sub: HTMLElement; root: HTMLElement } => {
    const t = el('div', 'admin-tile');
    const value = el('span', 'admin-tile-value', 'â€“');
    value.dataset.testid = testId;
    const sub = el('span', 'admin-tile-sub', '');
    t.append(el('span', 'admin-tile-label', label), value, sub);
    tiles.append(t);
    return { value, sub, root: t };
  };
  const cam = tile('Camera', 'admin-camera');
  const fps = tile('Landmark fps', 'admin-fps');
  const p95 = tile('Inference p95', 'admin-p95');
  const face = tile('Face', 'admin-face');
  const screen = tile('Screen time', 'admin-screen');
  const alarmTile = tile('Alarm', 'admin-alarm');

  // Calibration progress.
  const calib = el('div', 'admin-calib');
  const calibTop = el('div', 'admin-calib-top');
  const calibLabel = el('span', 'admin-calib-label', 'Baseline');
  const calibValue = el('span', 'admin-calib-value', 'â€“');
  calibTop.append(calibLabel, calibValue);
  const track = el('div', 'admin-progress');
  const bar = el('div', 'admin-progress-bar');
  track.append(bar);
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', 'Baseline calibration');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  const calibHint = el(
    'p',
    'admin-hint',
    'Per-learner normalisation collects 60 valid seconds before load can be classified.',
  );
  calib.append(calibTop, track, calibHint);

  // Load state: the classifier ships with phase B, so no fake output here.
  const load = el('div', 'admin-load');
  const loadHead = el('div', 'admin-load-head');
  loadHead.append(
    el('span', 'admin-calib-label', 'Cognitive load'),
    el('span', 'admin-badge', 'Model pending'),
  );
  const levels = el('div', 'admin-levels');
  for (const l of ['Low', 'Medium', 'High']) levels.append(el('span', 'admin-level', l));
  load.append(
    loadHead,
    levels,
    el(
      'p',
      'admin-hint',
      'The 1D-CNN + GRU classifier is not trained yet. Load state and confidence appear here once it ships; the event stream reports load_state: null until then.',
    ),
  );

  const panel = el('div', 'admin-overview');
  panel.append(calib, load);

  // Session controls.
  const controls = el('div', 'admin-controls');
  const pause = button('Pause', ICONS.pause, 'admin-pause');
  const resume = button('Resume', ICONS.play, 'admin-resume');
  const stop = button('Turn sensing off', ICONS.power, 'admin-stop', 'btn-danger');
  const recal = button('Recalibrate', ICONS.refresh, 'admin-recalibrate');
  recal.title = 'Throw away the baseline and collect a new one.';
  const brk = button('Mark a break', ICONS.coffee, 'admin-break');
  brk.title = 'Reset the eye and movement break timers.';
  pause.addEventListener('click', () => {
    send('pause');
  });
  resume.addEventListener('click', () => {
    send('resume');
  });
  stop.addEventListener('click', () => {
    send('stop');
  });
  recal.addEventListener('click', () => {
    send('recalibrate');
  });
  brk.addEventListener('click', () => {
    send('break-taken');
  });
  controls.append(pause, resume, recal, brk, stop);
  const controlsNote = el(
    'p',
    'admin-hint',
    'Sensing is turned on from the sensor page itself, where the camera preview and its permission prompt are.',
  );

  body.append(tiles, panel, controls, controlsNote);

  return {
    element,
    render(s) {
      const running = s !== null && (s.camera === 'active' || s.camera === 'paused');
      setText(cam.value, s ? CAMERA_LABEL[s.camera] : 'Not connected');
      cam.root.dataset.tone = !s
        ? 'idle'
        : s.camera === 'active'
          ? 'live'
          : s.camera === 'paused'
            ? 'busy'
            : ['idle', 'stopped'].includes(s.camera)
              ? 'idle'
              : 'error';
      setText(
        cam.sub,
        s ? (s.backend ? `Backend ${s.backend}` : `Model ${s.modelState}`) : 'Open the sensor page',
      );
      setText(fps.value, running ? s.fps.toFixed(1) : 'â€“');
      setText(fps.sub, s ? `target ${String(s.targetFps)}` : '');
      setText(
        p95.value,
        running && Number.isFinite(s.inferenceP95) ? `${s.inferenceP95.toFixed(0)} ms` : 'â€“',
      );
      setText(
        p95.sub,
        running && Number.isFinite(s.inferenceP50)
          ? `p50 ${s.inferenceP50.toFixed(0)} ms`
          : 'time inside the face model',
      );
      setText(
        face.value,
        !s
          ? 'â€“'
          : s.face === 'found'
            ? 'Detected'
            : s.face === 'none'
              ? 'Searching'
              : 'Not tracking',
      );
      face.root.dataset.tone = s?.face === 'found' ? 'live' : s?.face === 'none' ? 'busy' : 'idle';
      setText(face.sub, s ? `${String(s.errors)} inference errors` : '');
      setText(screen.value, s ? clock(s.onScreenMs) : 'â€“');
      setText(screen.sub, s ? `eye break ${clock(s.sinceEyeBreakMs)} ago` : '');
      setText(
        alarmTile.value,
        !s ? 'â€“' : s.alarm === 'absent' ? 'Away' : s.alarm === 'asleep' ? 'Eyes closed' : 'Quiet',
      );
      alarmTile.root.dataset.tone = s?.alarm ? 'error' : 'idle';
      setText(alarmTile.sub, s?.alarm ? 'Beeping on the sensor page' : '');

      const pct = running ? Math.round(s.calibrationProgress * 100) : 0;
      bar.style.width = `${String(pct)}%`;
      track.setAttribute('aria-valuenow', String(pct));
      calib.dataset.ready = String(running && s.phase === 'ready');
      setText(
        calibValue,
        !running
          ? 'Waiting for sensing'
          : s.phase === 'ready'
            ? s.classifiable
              ? 'Ready Â· window full'
              : 'Ready Â· filling window'
            : `Calibrating ${String(pct)} %`,
      );

      pause.disabled = s?.camera !== 'active';
      resume.hidden = s?.camera !== 'paused';
      pause.hidden = s?.camera === 'paused';
      stop.disabled = !running && s?.camera !== 'starting';
      recal.disabled = !running;
      brk.disabled = !running;
    },
  };
}

// â”€â”€ Sensing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildSensing(store: SettingsStore): {
  element: HTMLElement;
  render(s: DemoSettings): void;
} {
  const { element, body, actions } = section(
    'sensing',
    'Sensing',
    'How the landmark model runs and what the camera view shows.',
  );
  actions.append(
    resetButton(() => {
      store.update({ sensing: DEFAULT_SETTINGS.sensing });
    }),
  );
  const fps = slider({
    label: 'Landmark rate cap',
    hint: 'Highest inference rate. Lower saves battery on slow laptops; blinks need at least ~10 fps to be caught reliably.',
    limits: LIMITS.targetFps,
    unit: 'fps',
    def: DEFAULT_SETTINGS.sensing.targetFps,
    testId: 'set-fps',
    onInput: (v) => {
      store.update({ sensing: { targetFps: v } });
    },
  });
  const points = switchRow({
    label: 'Feature points overlay',
    hint: 'Ring and number every landmark the features use, over the camera preview.',
    testId: 'set-points',
    onChange: (v) => {
      store.update({ sensing: { featurePoints: v } });
    },
  });
  const expr = switchRow({
    label: 'Expression features',
    hint: 'FR3 ablation switch. Off zeroes mouth-open and lip-thickness. Changing it restarts calibration.',
    testId: 'set-expression',
    tag: 'FR3',
    onChange: (v) => {
      store.update({ sensing: { expressionFeatures: v } });
    },
  });
  body.append(rows(fps.root, points.root, expr.root));
  return {
    element,
    render(s) {
      fps.set(s.sensing.targetFps);
      points.set(s.sensing.featurePoints);
      expr.set(s.sensing.expressionFeatures);
    },
  };
}

// â”€â”€ Alarm â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildAlarm(
  store: SettingsStore,
  sound: AlarmSound,
): { element: HTMLElement; render(s: DemoSettings): void } {
  const { element, body, actions } = section(
    'alarm',
    'Away & sleep alarm',
    'Beeps on the sensor page when no one is at the screen or the eyes stay closed. Demo only: keep it off in study sessions, a beep changes the workload.',
  );
  actions.append(
    resetButton(() => {
      store.update({ alarm: DEFAULT_SETTINGS.alarm });
    }),
  );
  const enabled = switchRow({
    label: 'Alarm enabled',
    hint: 'Also switchable from the Wellbeing panel on the sensor page.',
    testId: 'set-alarm',
    onChange: (v) => {
      store.update({ alarm: { enabled: v } });
    },
  });
  const absent = slider({
    label: 'Away after',
    hint: 'No face for this long. Presence already reads "absent" after 2 s; the margin lets a learner reach for a cup.',
    limits: LIMITS.absentS,
    unit: 's',
    def: DEFAULT_SETTINGS.alarm.absentS,
    testId: 'set-absent',
    onInput: (v) => {
      store.update({ alarm: { absentS: v } });
    },
  });
  const asleep = slider({
    label: 'Eyes closed after',
    hint: 'Continuous closure. A blink lasts at most 500 ms, so 1 s is the floor.',
    limits: LIMITS.asleepS,
    unit: 's',
    def: DEFAULT_SETTINGS.alarm.asleepS,
    testId: 'set-asleep',
    onInput: (v) => {
      store.update({ alarm: { asleepS: v } });
    },
  });
  const volume = slider({
    label: 'Volume',
    hint: 'Scales the alarm, which still ramps up over 20 s. 0 % leaves only the on-screen banner.',
    limits: LIMITS.volume,
    unit: '%',
    def: DEFAULT_SETTINGS.alarm.volume,
    testId: 'set-volume',
    onInput: (v) => {
      store.update({ alarm: { volume: v } });
    },
  });
  const test = button('Test sound', ICONS.volume, 'admin-test-sound', 'btn-small');
  test.addEventListener('click', () => {
    sound.test();
  });
  volume.control.append(test);
  body.append(rows(enabled.root, absent.root, asleep.root, volume.root));
  return {
    element,
    render(s) {
      enabled.set(s.alarm.enabled);
      absent.set(s.alarm.absentS);
      asleep.set(s.alarm.asleepS);
      volume.set(s.alarm.volume);
      for (const r of [absent.root, asleep.root]) r.dataset.muted = String(!s.alarm.enabled);
    },
  };
}

// â”€â”€ Wellbeing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildWellbeing(store: SettingsStore): {
  element: HTMLElement;
  render(s: DemoSettings): void;
} {
  const { element, body, actions } = section(
    'wellbeing',
    'Wellbeing reminders',
    'Break reminders on the sensor page. Time counts only while sensing is on and a face is present; 2 min away counts as a break.',
  );
  actions.append(
    resetButton(() => {
      store.update({ wellbeing: DEFAULT_SETTINGS.wellbeing });
    }),
  );
  const eye = slider({
    label: 'Eye break every',
    hint: '20 min follows the 20-20-20 rule: look 6 m away for 20 s.',
    limits: LIMITS.eyeBreakMin,
    unit: 'min',
    def: DEFAULT_SETTINGS.wellbeing.eyeBreakMin,
    testId: 'set-eye-break',
    onInput: (v) => {
      store.update({ wellbeing: { eyeBreakMin: v } });
    },
  });
  const move = slider({
    label: 'Movement break every',
    hint: 'Suggests the neck-stretch game and a short walk.',
    limits: LIMITS.moveBreakMin,
    unit: 'min',
    def: DEFAULT_SETTINGS.wellbeing.moveBreakMin,
    testId: 'set-move-break',
    onInput: (v) => {
      store.update({ wellbeing: { moveBreakMin: v } });
    },
  });
  body.append(rows(eye.root, move.root));
  return {
    element,
    render(s) {
      eye.set(s.wellbeing.eyeBreakMin);
      move.set(s.wellbeing.moveBreakMin);
    },
  };
}

// â”€â”€ Research config (read-only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const GROUP_LABEL: Record<keyof typeof FEATURE_CONFIG, string> = {
  blink: 'Blink detection',
  reference: 'Reference (open eye, neutral pose)',
  gaze: 'Gaze',
  offScreen: 'Off-screen',
  presence: 'Presence',
  yawn: 'Yawn',
  nod: 'Nod',
  second: 'Per-second aggregation',
  window: 'Classifier window',
  baseline: 'Baseline normalisation',
};

function buildResearch(): HTMLElement {
  const { element, body } = section(
    'research',
    'Research configuration',
    'Pipeline constants, read-only. They are written into feature_spec.json, so the live features always match the ones the model is trained on.',
  );
  const note = el('div', 'admin-note');
  note.append(
    icon(ICONS.flask),
    el(
      'p',
      '',
      'To change one, edit src/core/features/config.ts, regenerate feature_spec.json (pnpm feature-spec) and retrain. Tune from recorded fixtures and pilot data, never by guessing.',
    ),
  );
  const grid = el('div', 'admin-config');
  for (const key of Object.keys(FEATURE_CONFIG) as (keyof typeof FEATURE_CONFIG)[]) {
    const group = el('section', 'admin-config-group');
    group.append(el('h3', '', GROUP_LABEL[key]));
    const dl = el('dl');
    for (const [name, value] of Object.entries(FEATURE_CONFIG[key])) {
      dl.append(el('dt', '', name), el('dd', '', formatConst(name, value)));
    }
    group.append(dl);
    grid.append(group);
  }
  body.append(note, grid);
  return element;
}

function formatConst(name: string, value: unknown): string {
  if (typeof value !== 'number') return String(value);
  if (name.endsWith('Ms'))
    return value >= 60_000
      ? `${String(value / 60_000)} min`
      : value >= 1000
        ? `${String(value / 1000)} s`
        : `${String(value)} ms`;
  if (name.endsWith('Deg')) return `${String(value)}Â°`;
  if (/Ratio$|Fraction$/.test(name)) return `${String(Math.round(value * 100))} %`;
  if (name === 'seconds') return `${String(value)} s`;
  return String(value);
}

// â”€â”€ Privacy & data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildPrivacy(store: SettingsStore): { element: HTMLElement; render(): void } {
  const { element, body } = section(
    'privacy',
    'Privacy & data',
    'What the sensor does with the camera, and what this browser keeps.',
  );
  const promises = el('ul', 'admin-promises');
  for (const [title, text] of [
    [
      'Video stays on this device',
      'Frames are analysed in the browser and never uploaded, recorded or stored (FR7, NFR2).',
    ],
    [
      'No network at run time',
      'Models and WASM are served from this site; the sensor works offline after the first load.',
    ],
    [
      'Off by default',
      'Sensing starts only when you press "Turn sensing on" and can be paused or stopped any time.',
    ],
    [
      'Settings stay local',
      'The values on this page live in this browserâ€™s storage only, for this site.',
    ],
  ] as const) {
    const li = el('li');
    const ic = el('span', 'admin-promise-icon');
    ic.append(icon(ICONS.check));
    const txt = el('span');
    txt.append(el('strong', '', title), el('span', '', text));
    li.append(ic, txt);
    promises.append(li);
  }

  const storeCard = el('div', 'admin-storage');
  const storeHead = el('div', 'admin-storage-head');
  storeHead.append(el('h3', '', 'Stored in this browser'));
  const list = el('ul', 'admin-keys');
  list.dataset.testid = 'admin-keys';
  const actions = el('div', 'admin-controls');
  const reset = button('Reset all settings', ICONS.undo, 'admin-reset-all');
  reset.addEventListener('click', () => {
    store.reset();
  });
  const clear = button('Clear all local data', ICONS.trash, 'admin-clear', 'btn-danger');
  clear.addEventListener('click', () => {
    if (!window.confirm('Remove every AdaptLearn C02 value stored in this browser?')) return;
    for (const k of demoKeys()) {
      try {
        localStorage.removeItem(k);
      } catch {
        // Blocked storage: nothing to remove.
      }
    }
    store.reset();
    render();
  });
  actions.append(reset, clear);
  storeCard.append(storeHead, list, actions);

  body.append(promises, storeCard);

  function render(): void {
    const keys = demoKeys();
    list.replaceChildren();
    if (keys.length === 0) {
      list.append(el('li', 'admin-keys-empty', 'Nothing stored. Defaults are in use.'));
      return;
    }
    for (const k of keys) {
      const li = el('li');
      let size = 0;
      try {
        size = (localStorage.getItem(k) ?? '').length;
      } catch {
        // Blocked storage.
      }
      li.append(el('code', '', k), el('span', '', `${String(size)} B`));
      list.append(li);
    }
  }
  // Other tabs (sensor page, games) also write keys.
  window.addEventListener('storage', render);

  return { element, render };
}

function demoKeys(): string[] {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    return keys.sort();
  } catch {
    return [];
  }
}

// â”€â”€ Building blocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function section(
  id: string,
  title: string,
  sub: string,
): { element: HTMLElement; body: HTMLElement; actions: HTMLElement } {
  const element = el('section', 'admin-section');
  element.id = id;
  element.setAttribute('aria-labelledby', `${id}-title`);
  const head = el('header', 'admin-section-head');
  const t = el('div');
  const h = el('h2', 'admin-section-title', title);
  h.id = `${id}-title`;
  t.append(h, el('p', 'admin-section-sub', sub));
  const actions = el('div', 'admin-section-actions');
  head.append(t, actions);
  const body = el('div', 'card admin-card');
  element.append(head, body);
  return { element, body, actions };
}

function rows(...items: HTMLElement[]): HTMLElement {
  const r = el('div', 'admin-rows');
  r.append(...items);
  return r;
}

function settingRow(
  label: string,
  hint: string,
  tag?: string,
): {
  root: HTMLElement;
  control: HTMLElement;
  labelEl: HTMLElement;
} {
  const root = el('div', 'admin-row');
  const text = el('div', 'admin-row-text');
  const labelEl = el('span', 'admin-row-label', label);
  if (tag) labelEl.append(el('span', 'admin-tag', tag));
  text.append(labelEl, el('span', 'admin-row-hint', hint));
  const control = el('div', 'admin-row-control');
  root.append(text, control);
  return { root, control, labelEl };
}

function switchRow(o: {
  label: string;
  hint: string;
  testId: string;
  tag?: string;
  onChange: (v: boolean) => void;
}): { root: HTMLElement; set(v: boolean): void } {
  const row = settingRow(o.label, o.hint, o.tag);
  const sw = el('label', 'switch');
  const input = el('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.setAttribute('aria-label', o.label);
  input.dataset.testid = o.testId;
  const track = el('span', 'switch-track');
  track.setAttribute('aria-hidden', 'true');
  const state = el('span', 'admin-switch-state', '');
  sw.append(input, track, state);
  input.addEventListener('change', () => {
    o.onChange(input.checked);
  });
  row.control.append(sw);
  return {
    root: row.root,
    set(v) {
      input.checked = v;
      setText(state, v ? 'On' : 'Off');
    },
  };
}

function slider(o: {
  label: string;
  hint: string;
  limits: { min: number; max: number; step: number };
  unit: string;
  def: number;
  testId: string;
  onInput: (v: number) => void;
}): { root: HTMLElement; control: HTMLElement; set(v: number): void } {
  const row = settingRow(o.label, o.hint);
  row.root.classList.add('admin-row-slider');
  const wrap = el('div', 'admin-slider');
  const input = el('input');
  input.type = 'range';
  input.min = String(o.limits.min);
  input.max = String(o.limits.max);
  input.step = String(o.limits.step);
  input.setAttribute('aria-label', o.label);
  input.dataset.testid = o.testId;
  const value = el('output', 'admin-value', '');
  const def = el('span', 'admin-default', `default ${String(o.def)} ${o.unit}`);
  // Commit on release (change) and while dragging (input); the store skips unchanged values.
  input.addEventListener('input', () => {
    paint(Number(input.value));
    o.onInput(Number(input.value));
  });
  wrap.append(input, value);
  row.control.append(wrap, def);

  function paint(v: number): void {
    setText(value, `${String(v)} ${o.unit}`);
    const pct = ((v - o.limits.min) / (o.limits.max - o.limits.min)) * 100;
    input.style.setProperty('--fill', `${pct.toFixed(1)}%`);
    def.dataset.changed = String(v !== o.def);
  }
  return {
    root: row.root,
    control: row.control,
    set(v) {
      // Do not fight the thumb while the user drags it.
      if (document.activeElement !== input || Number(input.value) !== v) input.value = String(v);
      paint(v);
    },
  };
}

function resetButton(onClick: () => void): HTMLButtonElement {
  const b = button('Reset', ICONS.undo, '', 'btn-small btn-ghost');
  b.addEventListener('click', onClick);
  return b;
}

function button(label: string, svg: string, testId: string, variant?: string): HTMLButtonElement {
  const b = el('button', variant ? `btn ${variant}` : 'btn');
  b.type = 'button';
  if (testId) b.dataset.testid = testId;
  b.append(icon(svg), el('span', '', label));
  return b;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** m:ss, or h:mm:ss past an hour. */
function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${ss}` : `${String(m)}:${ss}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
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

// Last, so every module-level constant above is initialised before use.
const root = document.querySelector<HTMLElement>('#cog-admin');
if (root) mount(root);
