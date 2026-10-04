/** Race clock text, m:ss.cc. Truncates so a displayed time is never later than the real one. */
export function formatTime(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 10) : 0; // centiseconds
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Split difference with an explicit sign (+ slower, − faster, ± equal), so it
 * reads correctly for colour-blind players without relying on red/green.
 */
export function formatDelta(ms: number): string {
  const abs = Math.abs(ms);
  const sign = ms > 0 ? '+' : ms < 0 ? '−' : '±';
  const total = Math.floor(abs / 10);
  const cs = String(total % 100).padStart(2, '0');
  const secs = Math.floor(total / 100);
  if (secs < 60) return `${sign}${secs}.${cs}`;
  return `${sign}${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}.${cs}`;
}
