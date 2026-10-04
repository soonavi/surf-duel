import { formatDelta, formatTime } from '../game/time';

export interface HudMarker {
  label: string;
  color: string;
  /** 0..1 along the course. */
  progress: number;
}

export interface HudSplit {
  label: string;
  timeMs: number;
  deltaMs: number | null;
}

/**
 * In-race heads-up display: run timer, checkpoint count, course progress bar
 * (with ghost markers), split pop-ups, countdown and speedometer. Splits show
 * an explicit +/− sign as well as colour, so they read for colour-blind players.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly cps: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly you: HTMLElement;
  private readonly ticks: HTMLElement;
  private readonly markers: HTMLElement;
  private readonly split: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly speedValue: HTMLElement;
  private readonly markerEls: HTMLElement[] = [];
  private splitTimer = 0;
  private lastTimerText = '';
  private lastSpeed = -1;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="hud__top">
        <div class="hud__timer" aria-label="Run time">0:00.00</div>
        <div class="hud__cps"></div>
        <div class="hud__bar" aria-hidden="true">
          <div class="hud__fill"></div>
          <div class="hud__ticks"></div>
          <div class="hud__markers"></div>
          <div class="hud__you"></div>
        </div>
        <div class="hud__split" role="status" aria-live="polite" hidden></div>
      </div>
      <div class="hud__countdown" aria-live="assertive" hidden></div>
      <div class="hud__speedo" aria-hidden="true"><span class="hud__speed">0</span><span class="hud__unit">u/s</span></div>
    `;
    parent.appendChild(this.root);
    const q = (sel: string): HTMLElement => {
      const el = this.root.querySelector<HTMLElement>(sel);
      if (!el) throw new Error(`Hud: missing ${sel}`);
      return el;
    };
    this.timer = q('.hud__timer');
    this.cps = q('.hud__cps');
    this.bar = q('.hud__bar');
    this.fill = q('.hud__fill');
    this.you = q('.hud__you');
    this.ticks = q('.hud__ticks');
    this.markers = q('.hud__markers');
    this.split = q('.hud__split');
    this.countdown = q('.hud__countdown');
    this.speedValue = q('.hud__speed');
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /** Where the checkpoints sit along the bar (0..1 each). */
  setCheckpointTicks(fractions: number[]): void {
    this.ticks.replaceChildren(
      ...fractions.map((f) => {
        const t = document.createElement('span');
        t.className = 'hud__tick';
        t.style.left = `${(f * 100).toFixed(2)}%`;
        return t;
      }),
    );
  }

  setTimer(ms: number): void {
    const text = formatTime(ms);
    if (text !== this.lastTimerText) {
      this.timer.textContent = text;
      this.lastTimerText = text;
    }
  }

  setCheckpoints(reached: number, total: number): void {
    const text = total > 0 ? `Checkpoint ${reached}/${total}` : '';
    if (this.cps.textContent !== text) this.cps.textContent = text;
  }

  setProgress(you: number, markers: readonly HudMarker[]): void {
    const pct = (f: number): string => `${(Math.min(1, Math.max(0, f)) * 100).toFixed(2)}%`;
    this.fill.style.width = pct(you);
    this.you.style.left = pct(you);
    while (this.markerEls.length < markers.length) {
      const el = document.createElement('span');
      el.className = 'hud__marker';
      this.markers.appendChild(el);
      this.markerEls.push(el);
    }
    this.markerEls.forEach((el, i) => {
      const m = markers[i];
      el.hidden = !m;
      if (!m) return;
      el.style.left = pct(m.progress);
      el.style.setProperty('--marker', m.color);
      if (el.textContent !== m.label) el.textContent = m.label;
      // Drop a marker to a second row when it would sit on top of an earlier one.
      const crowded = markers.slice(0, i).some((other) => Math.abs(other.progress - m.progress) < 0.06);
      el.classList.toggle('hud__marker--low', crowded);
    });
    this.bar.classList.toggle('hud__bar--ghosts', markers.length > 0);
  }

  showSplit(split: HudSplit, ms = 2800): void {
    const span = (text: string, className = ''): HTMLSpanElement => {
      const el = document.createElement('span');
      el.className = className;
      el.textContent = text;
      return el;
    };
    const parts = [span(split.label, 'hud__split-label'), span(formatTime(split.timeMs))];
    let tone = '';
    if (split.deltaMs !== null) {
      tone = split.deltaMs < 0 ? 'ahead' : split.deltaMs > 0 ? 'behind' : 'even';
      parts.push(span(formatDelta(split.deltaMs), 'hud__delta'));
    }
    this.split.replaceChildren(...parts);
    this.split.dataset.tone = tone;
    this.split.hidden = false;
    window.clearTimeout(this.splitTimer);
    if (ms > 0) this.splitTimer = window.setTimeout(() => (this.split.hidden = true), ms);
  }

  hideSplit(): void {
    window.clearTimeout(this.splitTimer);
    this.split.hidden = true;
  }

  /** 3, 2, 1, then 'GO'; null hides it. */
  setCountdown(value: number | 'GO' | null): void {
    if (value === null) {
      this.countdown.hidden = true;
      return;
    }
    const text = String(value);
    if (this.countdown.textContent === text && !this.countdown.hidden) return;
    this.countdown.textContent = text;
    this.countdown.dataset.go = String(value === 'GO');
    this.countdown.hidden = false;
    this.countdown.classList.remove('hud__countdown--pop');
    void this.countdown.offsetWidth; // restart the animation
    this.countdown.classList.add('hud__countdown--pop');
  }

  setSpeed(unitsPerSecond: number): void {
    const rounded = Math.round(unitsPerSecond);
    if (rounded === this.lastSpeed) return;
    this.lastSpeed = rounded;
    this.speedValue.textContent = String(rounded);
  }
}
