/**
 * The riding line through a course: where a good rider's feet go, including
 * the flights between pieces. Used for progress (HUD, live ranking), the
 * kill floor, and the bot's steering.
 */
import { Vector3 } from 'three';

export interface PathSample {
  pos: Vector3;
  heading: number;
  /** Horizontal distance along the path from the start. */
  s: number;
  /** Index of the layout piece this sample belongs to (or is flying toward). */
  piece: number;
  /** Lowest course geometry at this point. */
  floorY: number;
  /** Falling below this means you've missed; respawn. */
  killY: number;
}

export interface PathHit {
  index: number;
  s: number;
  /** Signed horizontal offset from the line; positive is to the rider's right. */
  lateral: number;
  sample: PathSample;
}

/** Beyond this horizontal distance from the windowed best match, search the whole path. */
const RESYNC_DISTANCE = 2000;
const WINDOW_BEHIND = 30;
const WINDOW_AHEAD = 60;

export class TrackPath {
  private readonly samples: PathSample[] = [];

  get count(): number {
    return this.samples.length;
  }

  get length(): number {
    return this.samples.length ? this.samples[this.samples.length - 1]!.s : 0;
  }

  sample(i: number): PathSample {
    const clamped = Math.max(0, Math.min(this.samples.length - 1, i));
    const s = this.samples[clamped];
    if (!s) throw new Error('TrackPath is empty');
    return s;
  }

  add(pos: Vector3, heading: number, piece: number, floorY: number): void {
    const prev = this.samples[this.samples.length - 1];
    const s = prev ? prev.s + Math.hypot(pos.x - prev.pos.x, pos.z - prev.pos.z) : 0;
    this.samples.push({ pos: pos.clone(), heading, s, piece, floorY, killY: floorY });
  }

  /** Compute kill heights: lowest floor within `window` units of path distance, minus `margin`. */
  finish(window: number, margin: number): void {
    const n = this.samples.length;
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < n; i++) {
      const si = this.samples[i]!.s;
      while (this.samples[lo]!.s < si - window) lo++;
      while (hi + 1 < n && this.samples[hi + 1]!.s <= si + window) hi++;
      let min = Infinity;
      for (let j = lo; j <= hi; j++) min = Math.min(min, this.samples[j]!.floorY);
      this.samples[i]!.killY = min - margin;
    }
  }

  /** Nearest sample to `pos` (horizontally), searching around `hint` first. */
  locate(pos: Vector3, hint: number): PathHit {
    const n = this.samples.length;
    const from = Math.max(0, hint - WINDOW_BEHIND);
    const to = Math.min(n - 1, hint + WINDOW_AHEAD);
    let best = this.nearestIn(pos, from, to);
    if (best.distSq > RESYNC_DISTANCE * RESYNC_DISTANCE) best = this.nearestIn(pos, 0, n - 1);
    const sample = this.sample(best.index);
    const lateral = (pos.x - sample.pos.x) * Math.cos(sample.heading) - (pos.z - sample.pos.z) * Math.sin(sample.heading);
    return { index: best.index, s: sample.s, lateral, sample };
  }

  private nearestIn(pos: Vector3, from: number, to: number): { index: number; distSq: number } {
    let index = from;
    let distSq = Infinity;
    for (let i = from; i <= to; i++) {
      const p = this.samples[i]!.pos;
      const d = (pos.x - p.x) ** 2 + (pos.z - p.z) ** 2;
      if (d < distSq) {
        distSq = d;
        index = i;
      }
    }
    return { index, distSq };
  }
}
