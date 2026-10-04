export type OverlayScreen = 'start' | 'pause' | 'unsupported' | 'none';

/**
 * Full-screen HTML overlays (start, pause) and the debug readout. Phase 0
 * placeholder screens; the real menus arrive with the race loop and polish passes.
 */
export class Overlay {
  onEngage: (() => void) | null = null;

  private readonly root: HTMLElement;
  private readonly screens: Record<Exclude<OverlayScreen, 'none'>, HTMLElement>;
  private readonly messages: HTMLElement[];
  private readonly debugHud: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly speedValue: HTMLElement;
  private lastSpeed = -1;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'ui-root';
    this.root.innerHTML = `
      <div class="crosshair" hidden></div>
      <pre class="debug-hud" aria-hidden="true"></pre>
      <div class="speedo" aria-hidden="true"><span class="speedo__value">0</span><span class="speedo__unit">u/s</span></div>

      <section class="overlay overlay--start" data-screen="start">
        <div class="card card--hero">
          <h1 class="title">SURF DUEL</h1>
          <p class="pitch">Slide the ramps. Race your friends. Build courses with AI.</p>
          <button class="btn btn--primary" data-action="engage" type="button">Click to start</button>
          <p class="message" role="status" aria-live="polite"></p>
          <p class="hint">
            <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move &nbsp;·&nbsp; mouse look &nbsp;·&nbsp;
            <kbd>Space</kbd> jump (hold to auto-hop) &nbsp;·&nbsp; <kbd>R</kbd> respawn</span>
            <span><kbd>Esc</kbd> pause &nbsp;·&nbsp; <kbd>\`</kbd> tuning panel &nbsp;·&nbsp; <kbd>N</kbd> noclip (dev)</span>
          </p>
          <p class="hint hint--howto">
            Walk off the platform onto the ramp. On a ramp, hold the key that points <em>into</em> it
            (<kbd>D</kbd> if the ramp is on your right) and steer with the mouse. Don't press <kbd>W</kbd>.
          </p>
          <p class="phase-tag">Phase 1 · movement playtest</p>
        </div>
      </section>

      <section class="overlay overlay--pause" data-screen="pause" hidden>
        <div class="card">
          <h2>Paused</h2>
          <button class="btn btn--primary" data-action="engage" type="button">Resume</button>
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

    const screen = (name: string): HTMLElement => {
      const el = this.root.querySelector<HTMLElement>(`[data-screen="${name}"]`);
      if (!el) throw new Error(`Missing overlay screen: ${name}`);
      return el;
    };
    this.screens = { start: screen('start'), pause: screen('pause'), unsupported: screen('unsupported') };
    this.messages = [...this.root.querySelectorAll<HTMLElement>('.message')];
    this.debugHud = this.root.querySelector<HTMLElement>('.debug-hud')!;
    this.crosshair = this.root.querySelector<HTMLElement>('.crosshair')!;
    this.speedValue = this.root.querySelector<HTMLElement>('.speedo__value')!;

    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('[data-action="engage"]')) {
      btn.addEventListener('click', () => {
        btn.blur();
        this.onEngage?.();
      });
    }
  }

  show(screen: OverlayScreen): void {
    for (const [name, el] of Object.entries(this.screens)) el.hidden = name !== screen;
    this.crosshair.hidden = screen !== 'none';
    if (screen !== 'none') this.setMessage('');
  }

  setMessage(text: string): void {
    for (const el of this.messages) el.textContent = text;
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
