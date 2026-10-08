/**
 * Icon set for the Break games: drawn for this project on a 24 × 24 grid,
 * 1.75 px round strokes, so every icon has the same weight and corner style.
 * Inline SVG only: no icon font, no package, nothing fetched (invariant 3).
 */

const PATHS = {
  back: '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  camera:
    '<rect x="2.5" y="6.5" width="13" height="11" rx="2.5"/><path d="m15.5 10.5 5-3v9l-5-3"/>',
  cameraOff:
    '<path d="M3 3l18 18"/><path d="M15.5 13.5v1.5a2.5 2.5 0 0 1-2.5 2.5H5a2.5 2.5 0 0 1-2.5-2.5V9A2.5 2.5 0 0 1 5 6.5"/><path d="M9.5 6.5H13A2.5 2.5 0 0 1 15.5 9v1.5l5-3v9"/>',
  sound:
    '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path d="M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  mute: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  shuffle:
    '<path d="M3.5 7h3c4.5 0 5.5 10 10 10h4"/><path d="M3.5 17h3c1.7 0 2.8-1.5 3.7-3.4"/><path d="M13.8 10.4C14.7 8.5 15.8 7 17.5 7h3"/><path d="m18 4.5 2.5 2.5L18 9.5M18 14.5l2.5 2.5-2.5 2.5"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.3 1.4M9.5 2.5h5"/>',
  moves:
    '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.1"/><path d="M19.5 12a7.5 7.5 0 0 1-13 5.1"/><path d="M17.8 3.5v3.6h-3.6M6.2 20.5v-3.6h3.6"/>',
  pairs:
    '<rect x="3.5" y="7" width="10" height="13" rx="2"/><path d="M8.5 4h10a2 2 0 0 1 2 2v11"/>',
  trophy:
    '<path d="M8 4h8v5.5a4 4 0 0 1-8 0z"/><path d="M8 6H5.5a2.8 2.8 0 0 0 2.8 4M16 6h2.5a2.8 2.8 0 0 1-2.8 4"/><path d="M12 13.5V17M8.5 20.5h7M9.8 17h4.4"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  grid12:
    '<rect x="3.5" y="5" width="4.5" height="6" rx="1"/><rect x="9.75" y="5" width="4.5" height="6" rx="1"/><rect x="16" y="5" width="4.5" height="6" rx="1"/><rect x="3.5" y="13" width="4.5" height="6" rx="1"/><rect x="9.75" y="13" width="4.5" height="6" rx="1"/><rect x="16" y="13" width="4.5" height="6" rx="1"/>',
  neck: '<circle cx="12" cy="8" r="3.5"/><path d="M6.5 21v-1.5a5.5 5.5 0 0 1 11 0V21"/><path d="M3.5 9.5a8.6 8.6 0 0 1 1.7-5M20.5 9.5a8.6 8.6 0 0 0-1.7-5"/>',
  cards:
    '<rect x="3" y="6.5" width="9" height="13" rx="2" transform="rotate(-8 7.5 13)"/><rect x="11.5" y="4.5" width="9" height="13" rx="2" transform="rotate(8 16 11)"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  spark: '<path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7-5.6-1.9L10.1 9z"/>',
  right: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  left: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  up: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
  down: '<path d="M12 5v14"/><path d="m18 13-6 6-6-6"/>',
  upRight: '<path d="M7 17 17 7"/><path d="M9 7h8v8"/>',
  downLeft: '<path d="M17 7 7 17"/><path d="M15 17H7V9"/>',
  tiltRight:
    '<g transform="rotate(18 12 12)"><circle cx="12" cy="9" r="3.5"/><path d="M7 18.5h10"/></g><path d="M18.5 4.5a8 8 0 0 1 1.5 4"/>',
  tiltLeft:
    '<g transform="rotate(-18 12 12)"><circle cx="12" cy="9" r="3.5"/><path d="M7 18.5h10"/></g><path d="M5.5 4.5a8 8 0 0 0-1.5 4"/>',
  heart:
    '<path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10z"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, className = 'ico'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  // Static constants above, never user or network data.
  svg.innerHTML = PATHS[name];
  return svg;
}

/** Icon + text button. `iconOnly` keeps the text for screen readers only. */
export function iconButton(
  name: IconName,
  label: string,
  className = 'gbtn',
  iconOnly = false,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = iconOnly ? `${className} gbtn-icon` : className;
  const text = document.createElement('span');
  text.textContent = label;
  if (iconOnly) text.className = 'visually-hidden';
  if (label) b.title = label;
  b.append(icon(name), text);
  return b;
}

/** Replaces a button's icon and label in place (for toggles). */
export function setIconButton(b: HTMLButtonElement, name: IconName, label: string): void {
  const text = b.querySelector('span');
  if (text && text.textContent !== label) text.textContent = label;
  // Title too: on small screens toolbar buttons collapse to their icon.
  b.title = label;
  if (b.dataset.icon === name) return;
  b.dataset.icon = name;
  b.querySelector('svg')?.replaceWith(icon(name));
}
