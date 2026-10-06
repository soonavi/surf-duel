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

  /** The point `s` units along the path (clamped to its ends), written into `out`. Returns the heading there. */
  pointAt(s: number, out: Vector3): number {
    const n = this.samples.length;
    if (n === 0) throw new Error('TrackPath is empty');
    if (s <= 0 || n === 1) {
      out.copy(this.samples[0]!.pos);
      return this.samples[0]!.heading;
    }
    if (s >= this.length) {
      out.copy(this.samples[n - 1]!.pos);
      return this.samples[n - 1]!.heading;
    }
    // Last sample at or before s.
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.samples[mid]!.s <= s) lo = mid;
      else hi = mid;
    }
    const a = this.samples[lo]!;
    const b = this.samples[hi]!;
    const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    out.lerpVectors(a.pos, b.pos, t);
    return a.heading;
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

  /**
   * Nearest sample to `pos` (horizontally), searching around `hint` first.
   * Lost, it searches the whole path by true distance: a spiral passes over
   * itself, and only height tells its turns apart.
   */
  locate(pos: Vector3, hint: number): PathHit {
    const n = this.samples.length;
    const from = Math.max(0, hint - WINDOW_BEHIND);
    const to = Math.min(n - 1, hint + WINDOW_AHEAD);
    const best = this.nearestIn(pos, from, to);
    return this.hit(pos, best.distSq > RESYNC_DISTANCE * RESYNC_DISTANCE ? this.nearestIn(pos, 0, n - 1, true).index : best.index);
  }

  /** Where `pos` is with no idea where it was before (a respawn): the nearest sample by true distance. */
  relocate(pos: Vector3): PathHit {
    return this.hit(pos, this.nearestIn(pos, 0, this.samples.length - 1, true).index);
  }

  private hit(pos: Vector3, index: number): PathHit {
    const sample = this.sample(index);
    const lateral = (pos.x - sample.pos.x) * Math.cos(sample.heading) - (pos.z - sample.pos.z) * Math.sin(sample.heading);
    return { index, s: sample.s, lateral, sample };
  }

  private nearestIn(pos: Vector3, from: number, to: number, withHeight = false): { index: number; distSq: number } {
    let index = from;
    let distSq = Infinity;
    for (let i = from; i <= to; i++) {
      const p = this.samples[i]!.pos;
      const d = (pos.x - p.x) ** 2 + (pos.z - p.z) ** 2 + (withHeight ? (pos.y - p.y) ** 2 : 0);
      if (d < distSq) {
        distSq = d;
        index = i;
      }
    }
    return { index, distSq };
  }
}
