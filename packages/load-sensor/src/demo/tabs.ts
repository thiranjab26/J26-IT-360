/**
 * Accessible tab bar for the demo page (WAI-ARIA tabs pattern): arrow keys,
 * Home and End move between tabs, and the choice is kept in the URL hash so a
 * reload or a shared link opens the same view.
 */

export interface TabSpec {
  readonly id: string;
  /** Short channel number shown before the label, e.g. "01". */
  readonly index: string;
  readonly label: string;
  readonly panel: HTMLElement;
  /**
   * Keep the panel rendered while another tab is active (it gets
   * `data-active="false"` instead of `hidden`). The camera panel needs this:
   * a `display: none` video may stop delivering frame callbacks.
   */
  readonly keepRendered?: boolean;
}

export type TabTone = 'idle' | 'live' | 'busy' | 'warn' | 'error';

interface TabParts {
  readonly spec: TabSpec;
  readonly button: HTMLButtonElement;
  readonly meta: HTMLElement;
}

export class Tabs {
  readonly element: HTMLElement;
  readonly #tabs: TabParts[] = [];
  readonly #indicator: HTMLElement;
  readonly #listeners = new Set<(id: string) => void>();
  #active: string;

  constructor(specs: readonly TabSpec[], label: string) {
    const first = specs[0];
    if (!first) throw new Error('Tabs need at least one tab');

    this.element = document.createElement('nav');
    this.element.className = 'tabs';
    const list = document.createElement('div');
    list.className = 'tabs-list';
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', label);

    for (const spec of specs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tab';
      button.id = `tab-${spec.id}`;
      button.dataset.testid = `tab-${spec.id}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', spec.panel.id);

      const index = document.createElement('span');
      index.className = 'tab-index';
      index.textContent = spec.index;
      const text = document.createElement('span');
      text.className = 'tab-text';
      const name = document.createElement('span');
      name.className = 'tab-label';
      name.textContent = spec.label;
      const meta = document.createElement('span');
      meta.className = 'tab-meta';
      text.append(name, meta);
      const dot = document.createElement('span');
      dot.className = 'tab-dot';
      dot.setAttribute('aria-hidden', 'true');
      button.append(index, text, dot);

      spec.panel.setAttribute('role', 'tabpanel');
      spec.panel.setAttribute('aria-labelledby', button.id);

      button.addEventListener('click', () => {
        this.select(spec.id);
      });
      button.addEventListener('keydown', (e) => {
        this.#onKey(e, spec.id);
      });
      list.append(button);
      this.#tabs.push({ spec, button, meta });
    }

    this.#indicator = document.createElement('span');
    this.#indicator.className = 'tabs-indicator';
    this.#indicator.setAttribute('aria-hidden', 'true');
    list.append(this.#indicator);
    this.element.append(list);

    this.#active = this.#fromHash() ?? first.id;
    this.#apply();
    new ResizeObserver(() => {
      this.#placeIndicator();
    }).observe(list);
    window.addEventListener('hashchange', () => {
      const id = this.#fromHash();
      if (id) this.select(id);
    });
  }

  get active(): string {
    return this.#active;
  }

  select(id: string, focus = false): void {
    const tab = this.#tabs.find((t) => t.spec.id === id);
    if (!tab) return;
    if (focus) tab.button.focus();
    if (id === this.#active) return;
    this.#active = id;
    this.#apply();
    // replaceState, not location.hash: switching tabs should not fill the back button.
    history.replaceState(null, '', `#${id}`);
    for (const l of this.#listeners) l(id);
  }

  /** Live status line under a tab's label (e.g. "Live · 15 fps"). */
  setMeta(id: string, text: string, tone: TabTone): void {
    const tab = this.#tabs.find((t) => t.spec.id === id);
    if (!tab) return;
    if (tab.meta.textContent !== text) tab.meta.textContent = text;
    tab.button.dataset.tone = tone;
  }

  onChange(listener: (id: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #apply(): void {
    for (const { spec, button } of this.#tabs) {
      const on = spec.id === this.#active;
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
      spec.panel.dataset.active = String(on);
      if (!spec.keepRendered) spec.panel.hidden = !on;
    }
    this.#placeIndicator();
  }

  #placeIndicator(): void {
    const tab = this.#tabs.find((t) => t.spec.id === this.#active);
    if (!tab) return;
    this.#indicator.style.width = `${String(tab.button.offsetWidth)}px`;
    this.#indicator.style.transform = `translateX(${String(tab.button.offsetLeft)}px)`;
    // Animate only moves between tabs, not the first placement after layout.
    if (tab.button.offsetWidth > 0 && !this.#indicator.dataset.ready) {
      requestAnimationFrame(() => {
        this.#indicator.dataset.ready = 'true';
      });
    }
  }

  #onKey(e: KeyboardEvent, id: string): void {
    const i = this.#tabs.findIndex((t) => t.spec.id === id);
    const n = this.#tabs.length;
    const target =
      e.key === 'ArrowRight'
        ? (i + 1) % n
        : e.key === 'ArrowLeft'
          ? (i - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : -1;
    const next = this.#tabs[target];
    if (!next) return;
    e.preventDefault();
    this.select(next.spec.id, true);
  }

  #fromHash(): string | null {
    const id = location.hash.slice(1);
    return this.#tabs.some((t) => t.spec.id === id) ? id : null;
  }
}
