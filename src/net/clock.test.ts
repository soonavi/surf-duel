import { describe, expect, it } from 'vitest';
import { ClockSync } from './clock.js';

/** One ping: host clock = local + skew; one-way latencies out/back. */
function ping(clock: ClockSync, t0: number, skew: number, out: number, back: number): void {
  clock.addSample(t0, t0 + out + skew, t0 + out + back);
}

describe('ClockSync', () => {
  it('has no estimate until it hears back, and then maps host time to local time', () => {
    const c = new ClockSync();
    expect(c.offset).toBeNull();
    expect(c.hostToLocal(5000)).toBe(5000);
    ping(c, 1000, 5000, 40, 40);
    expect(c.offset).toBe(5000);
    expect(c.hostToLocal(9000)).toBe(4000);
  });

  it('trusts the fastest round trip, ignoring laggy samples', () => {
    const c = new ClockSync();
    ping(c, 1000, -300, 400, 20); // asymmetric spike: misleading
    ping(c, 2000, -300, 25, 25);
    ping(c, 3000, -300, 200, 30);
    expect(c.offset).toBeCloseTo(-300, 6);
    expect(c.rtt).toBe(50);
  });

  it('forgets everything on reset (e.g. a new host)', () => {
    const c = new ClockSync();
    ping(c, 1000, 10, 5, 5);
    c.reset();
    expect(c.offset).toBeNull();
  });
});
