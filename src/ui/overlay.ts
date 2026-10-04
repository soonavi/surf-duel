export type OverlayScreen = 'start' | 'pause' | 'unsupported' | 'none';

export interface CourseCard {
  id: string;
  name: string;
  difficulty: string;
  blurb: string;
  swatch: [string, string];
}

/**
 * Full-screen HTML overlays (start, pause), toasts, the speedometer and the
 * debug readout. Interim screens; the full menu flow arrives in Phase 3.
 */
export class Overlay {
  onEngage: (() => void) | null = null;
  onSelectCourse: ((id: string) => void) | null = null;
  onRestart: (() => void) | null = null;
  onCourseSelect: (() => void) | null = null;

  private readonly root: HTMLElement;
  private readonly screens: Record<Exclude<OverlayScreen, 'none'>, HTMLElement>;
  private readonly messages: HTMLElement[];
  private readonly debugHud: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly speedo: HTMLElement;
  private readonly speedValue: HTMLElement;
  private readonly courseList: HTMLElement;
  private readonly toastEl: HTMLElement;
  private toastTimer = 0;
  private lastSpeed = -1;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'ui-root';
    this.root.innerHTML = `
      <div class="crosshair" hidden></div>
      <pre class="debug-hud" aria-hidden="true"></pre>
      <div class="speedo" aria-hidden="true"><span class="speedo__value">0</span><span class="speedo__unit">u/s</span></div>
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
          <p class="phase-tag">Phase 2 · courses &amp; themes</p>
        </div>
      </section>

      <section class="overlay overlay--pause" data-screen="pause" hidden>
        <div class="card">
          <h2>Paused</h2>
          <div class="btn-row">
            <button class="btn btn--primary" data-action="engage" type="button">Resume</button>
            <button class="btn btn--ghost" data-action="restart" type="button">Restart course</button>
            <button class="btn btn--ghost" data-action="courses" type="button">Courses</button>
          </div>
          <p class="message" role="status" aria-live="polite"></p>
          <p class="hint">Press <kbd>\`</kbd> to toggle the tuning panel</p>
        </div>
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
      const el = this.root.querySelector<T>(sel);
      if (!el) throw new Error(`Overlay: missing ${sel}`);
      return el;
    };
    this.screens = {
      start: q('[data-screen="start"]'),
      pause: q('[data-screen="pause"]'),
      unsupported: q('[data-screen="unsupported"]'),
    };
    this.messages = [...this.root.querySelectorAll<HTMLElement>('.message')];
    this.debugHud = q('.debug-hud');
    this.crosshair = q('.crosshair');
    this.speedo = q('.speedo');
    this.speedo.hidden = true;
    this.speedValue = q('.speedo__value');
    this.courseList = q('.course-list');
    this.toastEl = q('.toast');

    const on = (action: string, fn: () => void): void => {
      for (const btn of this.root.querySelectorAll<HTMLButtonElement>(`[data-action="${action}"]`)) {
        btn.addEventListener('click', () => {
          btn.blur();
          fn();
        });
      }
    };
    on('engage', () => this.onEngage?.());
    on('restart', () => this.onRestart?.());
    on('courses', () => this.onCourseSelect?.());
  }

  show(screen: OverlayScreen): void {
    for (const [name, el] of Object.entries(this.screens)) el.hidden = name !== screen;
    this.crosshair.hidden = screen !== 'none';
    this.speedo.hidden = screen !== 'none';
    if (screen !== 'none') this.setMessage('');
  }

  setMessage(text: string): void {
    for (const el of this.messages) el.textContent = text;
  }

  setCourses(cards: readonly CourseCard[], selected: string): void {
    this.courseList.replaceChildren(
      ...cards.map((c) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'course-card';
        btn.dataset.id = c.id;
        btn.setAttribute('aria-pressed', String(c.id === selected));
        btn.style.setProperty('--swatch-a', c.swatch[0]);
        btn.style.setProperty('--swatch-b', c.swatch[1]);
        const name = document.createElement('span');
        name.className = 'course-card__name';
        name.textContent = c.name;
        const meta = document.createElement('span');
        meta.className = 'course-card__meta';
        meta.textContent = c.difficulty;
        const blurb = document.createElement('span');
        blurb.className = 'course-card__blurb';
        blurb.textContent = c.blurb;
        btn.append(name, meta, blurb);
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

  /** Horizontal speed readout. Only touches the DOM when the rounded value changes. */
  setSpeed(unitsPerSecond: number): void {
    const rounded = Math.round(unitsPerSecond);
    if (rounded === this.lastSpeed) return;
    this.lastSpeed = rounded;
    this.speedValue.textContent = String(rounded);
  }

  setDebugVisible(visible: boolean): void {
    this.debugHud.hidden = !visible;
  }

  setDebugText(text: string): void {
    if (this.debugHud.textContent !== text) this.debugHud.textContent = text;
  }
}
