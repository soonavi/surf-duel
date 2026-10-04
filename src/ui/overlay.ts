import { formatDelta, formatTime } from '../game/time';

export type OverlayScreen = 'start' | 'loading' | 'pause' | 'results' | 'unsupported' | 'none';

export interface CourseCard {
  id: string;
  name: string;
  difficulty: string;
  blurb: string;
  swatch: [string, string];
  /** Your best time on this course, if any. */
  bestMs: number | null;
}

export interface ResultsRow {
  label: string;
  timeMs: number | null;
  deltaMs: number | null;
}

export interface ResultsView {
  courseName: string;
  timeMs: number;
  /** Versus your previous best; null on a first run. */
  deltaMs: number | null;
  isBest: boolean;
  rank: number | null;
  runs: number | null;
  topSpeed: number;
  splits: ResultsRow[];
  /** Other ghosts' times on this course, for comparison. */
  rivals: { label: string; timeMs: number }[];
  /** Why the run wasn't saved, if it wasn't. */
  note: string;
  canSaveDevGhost: boolean;
}

const tone = (delta: number | null): string => (delta === null ? '' : delta < 0 ? 'ahead' : delta > 0 ? 'behind' : 'even');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

/**
 * Full-screen HTML overlays (start, loading, pause, results), toasts and the
 * debug readout. In-race HUD elements live in hud.ts.
 */
export class Overlay {
  onEngage: (() => void) | null = null;
  onSelectCourse: ((id: string) => void) | null = null;
  onRestart: (() => void) | null = null;
  onMenu: (() => void) | null = null;
  onRaceAgain: (() => void) | null = null;
  onSaveDevGhost: (() => void) | null = null;

  private readonly root: HTMLElement;
  private readonly screens: Record<Exclude<OverlayScreen, 'none'>, HTMLElement>;
  private readonly messages: HTMLElement[];
  private readonly debugHud: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly courseList: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly loadingText: HTMLElement;
  private readonly results: HTMLElement;
  private toastTimer = 0;
  private current: OverlayScreen = 'start';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'ui-root';
    this.root.innerHTML = `
      <div class="crosshair" hidden></div>
      <pre class="debug-hud" aria-hidden="true"></pre>
      <div class="toast" role="status" aria-live="polite" hidden></div>

      <section class="overlay overlay--start" data-screen="start">
        <div class="card card--hero">
          <h1 class="title">SURF DUEL</h1>
          <p class="pitch">Slide the ramps. Race your friends. Build courses with AI.</p>
          <div class="course-list" role="group" aria-label="Choose a course"></div>
          <button class="btn btn--primary" data-action="engage" type="button">Play</button>
          <p class="message" role="status" aria-live="polite"></p>
          <p class="hint hint--howto">
            On a ramp to your <em>right</em>, hold <kbd>D</kbd>. To your <em>left</em>, hold <kbd>A</kbd>.
            Steer with the mouse, and don't press <kbd>W</kbd>.
          </p>
          <p class="hint">
            <span><kbd>Space</kbd> jump (hold to bunny-hop) &nbsp;·&nbsp; <kbd>R</kbd> last checkpoint &nbsp;·&nbsp;
            <kbd>Shift</kbd><kbd>R</kbd> restart &nbsp;·&nbsp; <kbd>Esc</kbd> pause</span>
          </p>
          <p class="phase-tag">Phase 3 · race loop</p>
        </div>
      </section>

      <section class="overlay" data-screen="loading" hidden>
        <div class="card">
          <div class="spinner" aria-hidden="true"></div>
          <p class="loading-text" role="status" aria-live="polite">Building course…</p>
        </div>
      </section>

      <section class="overlay overlay--pause" data-screen="pause" hidden>
        <div class="card">
          <h2>Paused</h2>
          <div class="btn-row">
            <button class="btn btn--primary" data-action="engage" type="button">Resume</button>
            <button class="btn btn--ghost" data-action="restart" type="button">Restart run</button>
            <button class="btn btn--ghost" data-action="menu" type="button">Menu</button>
          </div>
          <p class="message" role="status" aria-live="polite"></p>
          <p class="hint">Press <kbd>\`</kbd> to toggle the tuning panel</p>
        </div>
      </section>

      <section class="overlay" data-screen="results" hidden>
        <div class="card results" role="dialog" aria-labelledby="results-heading"></div>
      </section>

      <section class="overlay" data-screen="unsupported" hidden>
        <div class="card">
          <h2>Best on desktop</h2>
          <p class="pitch">Surf Duel needs a desktop browser with a mouse or trackpad.</p>
        </div>
      </section>
    `;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => {
      const found = this.root.querySelector<T>(sel);
      if (!found) throw new Error(`Overlay: missing ${sel}`);
      return found;
    };
    this.screens = {
      start: q('[data-screen="start"]'),
      loading: q('[data-screen="loading"]'),
      pause: q('[data-screen="pause"]'),
      results: q('[data-screen="results"]'),
      unsupported: q('[data-screen="unsupported"]'),
    };
    this.messages = [...this.root.querySelectorAll<HTMLElement>('.message')];
    this.debugHud = q('.debug-hud');
    this.crosshair = q('.crosshair');
    this.courseList = q('.course-list');
    this.toastEl = q('.toast');
    this.loadingText = q('.loading-text');
    this.results = q('.results');

    this.bindActions(this.root);
  }

  get screen(): OverlayScreen {
    return this.current;
  }

  show(screen: OverlayScreen): void {
    this.current = screen;
    for (const [name, element] of Object.entries(this.screens)) element.hidden = name !== screen;
    this.crosshair.hidden = screen !== 'none';
    if (screen !== 'none') this.setMessage('');
    // Move focus to the screen's main button for keyboard players.
    const primary = screen === 'none' ? null : this.screens[screen].querySelector<HTMLButtonElement>('.btn--primary');
    primary?.focus({ preventScroll: true });
  }

  setMessage(text: string): void {
    for (const m of this.messages) m.textContent = text;
  }

  setLoadingText(text: string): void {
    this.loadingText.textContent = text;
  }

  setCourses(cards: readonly CourseCard[], selected: string): void {
    this.courseList.replaceChildren(
      ...cards.map((c) => {
        const btn = el('button', undefined, 'course-card');
        btn.type = 'button';
        btn.dataset.id = c.id;
        btn.setAttribute('aria-pressed', String(c.id === selected));
        btn.style.setProperty('--swatch-a', c.swatch[0]);
        btn.style.setProperty('--swatch-b', c.swatch[1]);
        const meta = c.bestMs !== null ? `${c.difficulty} · best ${formatTime(c.bestMs)}` : c.difficulty;
        btn.append(el('span', c.name, 'course-card__name'), el('span', meta, 'course-card__meta'), el('span', c.blurb, 'course-card__blurb'));
        btn.addEventListener('click', () => this.onSelectCourse?.(c.id));
        return btn;
      }),
    );
  }

  setSelectedCourse(id: string): void {
    for (const btn of this.courseList.querySelectorAll<HTMLButtonElement>('.course-card')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.id === id));
    }
  }

  showResults(view: ResultsView): void {
    const r = this.results;
    r.replaceChildren();

    const badge = el('div', 'New personal best!', 'results__badge');
    badge.hidden = !view.isBest;
    const heading = el('h2', 'Finished');
    heading.id = 'results-heading';
    r.append(badge, el('p', view.courseName, 'results__course'), heading, el('div', formatTime(view.timeMs), 'results__time'));

    const delta = el('p', view.deltaMs === null ? 'First finish on this course' : `${formatDelta(view.deltaMs)} vs your best`, 'results__delta');
    delta.dataset.tone = view.isBest && view.deltaMs !== null ? 'ahead' : tone(view.deltaMs);
    r.append(delta);

    if (view.splits.length > 0) {
      const table = el('table', undefined, 'results__table');
      const head = el('tr');
      head.append(el('th', 'Split'), el('th', 'Time'), el('th', 'vs best'));
      table.append(head);
      for (const s of view.splits) {
        const row = el('tr');
        const d = el('td', s.deltaMs === null ? '—' : formatDelta(s.deltaMs));
        d.dataset.tone = tone(s.deltaMs);
        row.append(el('td', s.label), el('td', s.timeMs === null ? 'missed' : formatTime(s.timeMs)), d);
        table.append(row);
      }
      r.append(table);
    }

    const stats = el('div', undefined, 'results__stats');
    const stat = (label: string, value: string): HTMLElement => {
      const span = el('span', `${label} `);
      span.append(el('strong', value));
      return span;
    };
    stats.append(stat('Top speed', `${Math.round(view.topSpeed).toLocaleString()} u/s`));
    if (view.rank !== null && view.runs !== null) {
      stats.append(stat('Rank', `#${view.rank} of ${view.runs} ${view.runs === 1 ? 'run' : 'runs'}`));
    }
    for (const rival of view.rivals) {
      stats.append(stat(rival.label, `${formatTime(rival.timeMs)} (${formatDelta(view.timeMs - rival.timeMs)})`));
    }
    r.append(stats);

    const buttons = el('div', undefined, 'btn-row');
    const again = el('button', 'Race again', 'btn btn--primary');
    again.type = 'button';
    again.dataset.action = 'race-again';
    const menu = el('button', 'Menu', 'btn btn--ghost');
    menu.type = 'button';
    menu.dataset.action = 'menu';
    buttons.append(again, menu);
    if (view.canSaveDevGhost) {
      const save = el('button', 'Save as dev ghost', 'btn btn--ghost');
      save.type = 'button';
      save.dataset.action = 'save-dev-ghost';
      buttons.append(save);
    }
    r.append(buttons, el('p', 'R or Enter to race again · M for the menu', 'hint'), el('p', view.note, 'results__note'));
    this.bindActions(r);
    this.show('results');
  }

  toast(text: string, ms = 1600): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    this.toastEl.classList.remove('toast--in');
    void this.toastEl.offsetWidth; // restart the CSS animation
    this.toastEl.classList.add('toast--in');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.hidden = true;
    }, ms);
  }

  setDebugVisible(visible: boolean): void {
    this.debugHud.hidden = !visible;
  }

  setDebugText(text: string): void {
    if (this.debugHud.textContent !== text) this.debugHud.textContent = text;
  }

  private bindActions(scope: HTMLElement): void {
    const handlers: Record<string, () => void> = {
      engage: () => this.onEngage?.(),
      restart: () => this.onRestart?.(),
      menu: () => this.onMenu?.(),
      'race-again': () => this.onRaceAgain?.(),
      'save-dev-ghost': () => this.onSaveDevGhost?.(),
    };
    for (const btn of scope.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      if (btn.dataset.bound) continue;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        btn.blur();
        handlers[btn.dataset.action ?? '']?.();
      });
    }
  }
}
