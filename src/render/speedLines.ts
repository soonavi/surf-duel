/**
 * Speed lines: thin streaks rushing out toward the screen edges at high
 * speed, drawn on a 2D canvas over the 3D view (cheap, and nothing in the
 * scene to collide with). Strength 0 hides the canvas entirely.
 */
const STREAKS = 48;

interface Streak {
  angle: number;
  /** 0 (inner edge) to 1 (off screen). */
  t: number;
  speed: number;
  width: number;
}

export class SpeedLines {
  readonly canvas: HTMLCanvasElement;
  private readonly streaks: Streak[] = [];
  private shown = false;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'speed-lines';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    parent.appendChild(this.canvas);
    for (let i = 0; i < STREAKS; i++) this.streaks.push(this.fresh(Math.random()));
  }

  private fresh(t = 0): Streak {
    return { angle: Math.random() * Math.PI * 2, t, speed: 1.2 + Math.random() * 1.4, width: 1 + Math.random() * 1.5 };
  }

  /** Draw one frame at `strength` (0–1). */
  draw(strength: number, dt: number): void {
    if (strength <= 0.001) {
      if (this.shown) {
        this.canvas.hidden = true;
        this.shown = false;
      }
      return;
    }
    if (!this.shown) {
      this.canvas.hidden = false;
      this.shown = true;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const g = this.canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const reach = Math.hypot(cx, cy);
    const inner = Math.min(w, h) * 0.32; // keep the middle of the view clear
    g.strokeStyle = `rgba(255, 255, 255, ${0.28 * strength})`;
    g.lineCap = 'round';
    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i]!;
      s.t += dt * s.speed * (0.6 + strength);
      if (s.t > 1) this.streaks[i] = this.fresh();
      const r0 = inner + (reach - inner) * s.t;
      const r1 = r0 + (reach - inner) * 0.18 * strength;
      const c = Math.cos(s.angle);
      const sn = Math.sin(s.angle);
      g.lineWidth = s.width;
      g.beginPath();
      g.moveTo(cx + c * r0, cy + sn * r0);
      g.lineTo(cx + c * r1, cy + sn * r1);
      g.stroke();
    }
  }
}
