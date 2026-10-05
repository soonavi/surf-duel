/**
 * Draws equalizer bars (0–1 each) on a canvas: the start screen's backdrop
 * and the small one under the speedometer. Sizes the canvas to its CSS box.
 */
export function drawEqualizer(canvas: HTMLCanvasElement, bars: readonly number[], colors: readonly [string, string]): void {
  const w = Math.max(1, Math.round(canvas.clientWidth));
  const h = Math.max(1, Math.round(canvas.clientHeight));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, w, h);
  if (bars.length === 0) return;
  const gradient = g.createLinearGradient(0, 0, w, 0);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(1, colors[1]);
  g.fillStyle = gradient;
  const slot = w / bars.length;
  const gap = Math.max(1, slot * 0.25);
  for (let i = 0; i < bars.length; i++) {
    const bh = Math.max(1, bars[i]! * h);
    g.fillRect(i * slot + gap / 2, h - bh, slot - gap, bh);
  }
}
