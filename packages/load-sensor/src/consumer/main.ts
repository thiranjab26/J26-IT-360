// Mock consumer (TODO A5): what C01 / C03 / C04 see. Open it in another tab
// next to the sensor demo, turn sensing on there, and events appear here.
//
// It imports ONLY the integration file, exactly as a teammate would:
//   import { subscribe, onLoadChange, … } from '@adaptlearn/load-sensor/signals';
// No camera, no model, no network: it listens on a same-origin BroadcastChannel.

import './consumer.css';
import {
  getLatestSignal,
  onAffectChange,
  onFatigueChange,
  onLoadChange,
  onPresenceChange,
  onStrainChange,
  STALE_AFTER_MS,
  subscribe,
  type LoadStateEvent,
} from '../signals.js';

const MAX_LOG = 50;

const root = document.querySelector<HTMLElement>('#consumer');
if (root) mount(root);

function mount(main: HTMLElement): void {
  const header = el('header', 'c-head');
  header.append(
    el('h1', '', 'Mock consumer'),
    el(
      'p',
      'c-sub',
      'Listens on the adaptlearn.load-state channel through signals.ts. Turn sensing on in the sensor tab.',
    ),
  );
  const conn = el('p', 'c-conn', 'Waiting for a sensor…');
  conn.dataset.testid = 'consumer-connection';
  conn.setAttribute('role', 'status');
  header.append(conn);

  // ── 1. Field helpers: one callback per signal, only on change ──
  const fields = el('section', 'c-card');
  fields.append(el('h2', '', 'Field helpers (on…Change)'));
  const grid = el('dl', 'c-grid');
  fields.append(grid);
  const show = (key: string, label: string): ((v: string | null) => void) => {
    const box = el('div');
    const dd = el('dd', '', '—');
    dd.dataset.testid = `consumer-${key}`;
    box.append(el('dt', '', label), dd);
    grid.append(box);
    return (v) => {
      dd.textContent = v ?? 'null';
      dd.dataset.null = String(v === null);
    };
  };
  const showLoad = show('load', 'onLoadChange');
  const showPresence = show('presence', 'onPresenceChange');
  const showFatigue = show('fatigue', 'onFatigueChange');
  const showAffect = show('affect', 'onAffectChange');
  const showStrain = show('strain', 'onStrainChange');

  onLoadChange((level) => {
    showLoad(level);
  });
  onPresenceChange((p) => {
    showPresence(p);
  });
  onFatigueChange((f) => {
    showFatigue(f);
  });
  onAffectChange((a) => {
    showAffect(a);
  });
  onStrainChange((s) => {
    showStrain(s);
  });

  // ── 2. subscribe(): every event, heartbeats included ──
  const logCard = el('section', 'c-card');
  logCard.append(el('h2', '', 'subscribe() — every event'));
  const log = el('ol', 'c-log');
  log.dataset.testid = 'consumer-log';
  log.setAttribute('aria-live', 'polite');
  logCard.append(log);

  // ── 3. getLatestSignal(): poll when you need it ──
  const latestCard = el('section', 'c-card');
  latestCard.append(el('h2', '', 'getLatestSignal()'));
  const latest = el('pre', 'c-json', 'null');
  latest.dataset.testid = 'consumer-latest';
  latestCard.append(latest);

  main.append(header, fields, logCard, latestCard);

  let count = 0;
  subscribe((event: LoadStateEvent) => {
    count += 1;
    conn.textContent = `Live · ${String(count)} events · last ${event.timestamp}`;
    conn.dataset.state = 'live';
    log.dataset.count = String(count);

    const item = el('li');
    item.textContent = `${event.timestamp.slice(11, 19)}  ${event.status.padEnd(14)} load=${String(event.load_state)}  conf=${event.confidence === null ? 'null' : event.confidence.toFixed(2)}  presence=${String(event.presence)}`;
    log.prepend(item);
    while (log.children.length > MAX_LOG) log.lastElementChild?.remove();
  });

  // A dead sensor (tab closed) stops heartbeats: show it as a consumer should treat it.
  window.setInterval(() => {
    const e = getLatestSignal();
    latest.textContent = JSON.stringify(e, null, 2);
    if (!e && count > 0) {
      conn.textContent = `No sensor for over ${String(STALE_AFTER_MS / 1000)} s: treat every signal as null.`;
      conn.dataset.state = 'stale';
    }
  }, 1000);
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
