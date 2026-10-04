/**
 * Estimates the offset between our clock and the host's from ping/pong
 * exchanges (NTP-style). The race start is announced in host time, and this
 * converts it to local time so everyone's GO lands together.
 */
interface Sample {
  offset: number;
  rtt: number;
}

const MAX_SAMPLES = 16;

export class ClockSync {
  private samples: Sample[] = [];

  /** host − local, from the lowest-latency exchange; null until one has completed. */
  get offset(): number | null {
    const best = this.best();
    return best ? best.offset : null;
  }

  /** Round trip of the exchange the offset came from. */
  get rtt(): number {
    return this.best()?.rtt ?? Infinity;
  }

  /**
   * @param t0 local time the ping was sent
   * @param tHost host time when it answered
   * @param t3 local time the pong arrived
   */
  addSample(t0: number, tHost: number, t3: number): void {
    const rtt = t3 - t0;
    if (!(rtt >= 0) || !Number.isFinite(tHost)) return;
    this.samples.push({ offset: tHost - (t0 + t3) / 2, rtt });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  /** Convert a host timestamp to our clock (identity until synced). */
  hostToLocal(t: number): number {
    return t - (this.offset ?? 0);
  }

  reset(): void {
    this.samples = [];
  }

  private best(): Sample | null {
    let best: Sample | null = null;
    for (const s of this.samples) if (!best || s.rtt < best.rtt) best = s;
    return best;
  }
}
