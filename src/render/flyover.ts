/**
 * Course preview camera: glides along the riding line, high above it, looking
 * ahead, and loops. Pure (path in, pose out), so it's tested headless.
 *
 * The riding line itself is harsh to follow: it falls almost vertically at
 * drops and zigzags between left and right ramp faces. So the camera follows
 * a smoothed copy of it, built once per course:
 *  - heights take a running maximum first (the "upper envelope"), then a
 *    wide blur, so the camera stays up until a drop is behind it and then
 *    glides down, and never dips below the line before a drop;
 *  - the horizontal line gets a narrower blur, enough to iron out the
 *    zigzag while still following the course's bends;
 *  - beyond both ends the line carries straight on, so the view doesn't
 *    swing at the start or the finish.
 * The loop seam (finish back to start) fades through dark: see flyoverFade.
 */
import { Vector3 } from 'three';
import type { TrackPath } from '../course/path.js';
import { forwardOf, rightOf } from '../course/layout.js';

/** Height above the (smoothed) riding line. */
const HEIGHT = 520;
/** How far ahead along the path the camera looks. */
const LOOK_AHEAD = 2200;
/** A slow sideways sway, so ramps are seen from a bit of an angle. */
const SWAY = 380;
const SWAY_PERIOD_S = 9;
/** Fly no slower than this (units/s)... */
const MIN_SPEED = 2600;
/** ...and cover any course in at most this long. */
const MAX_DURATION_S = 14;
/** The fade at the loop seam, each side of it (seconds). */
export const FADE_SECONDS = 0.45;

/** Spacing of the smoothed line's points (units of path distance). */
const STEP = 50;
/** Blur widths (one standard deviation, units of path distance). */
const SIGMA_XZ = 1600;
const SIGMA_Y = 2600;
/** The height envelope's reach each side: the blur's full reach, so the camera can't sink below the line. */
const ENVELOPE = 3 * SIGMA_Y;

/** Seconds for one pass over the whole course. */
export function flyoverDuration(path: TrackPath): number {
  const speed = Math.max(MIN_SPEED, path.length / MAX_DURATION_S);
  return Math.max(1, path.length / speed);
}

interface SmoothLine {
  /** Path distance of points[0] (negative: the line starts before the course does). */
  start: number;
  points: Vector3[];
}

const lines = new WeakMap<TrackPath, SmoothLine>();

/** The riding line at distance `s`, carried straight on beyond either end. */
function rawAt(path: TrackPath, s: number, out: Vector3): Vector3 {
  const end = path.length;
  if (s >= 0 && s <= end) {
    path.pointAt(s, out);
    return out;
  }
  const edge = s < 0 ? 0 : end;
  const heading = path.pointAt(edge, out);
  return out.addScaledVector(forwardOf(heading, new Vector3()), s - edge);
}

function gaussian(sigma: number): number[] {
  const reach = Math.ceil((3 * sigma) / STEP);
  const w = Array.from({ length: 2 * reach + 1 }, (_, i) => Math.exp(-0.5 * (((i - reach) * STEP) / sigma) ** 2));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

/** Running maximum of `values` over ±`reach` neighbours. */
function runningMax(values: number[], reach: number): number[] {
  return values.map((_, i) => {
    let m = -Infinity;
    for (let j = Math.max(0, i - reach); j <= Math.min(values.length - 1, i + reach); j++) m = Math.max(m, values[j]!);
    return m;
  });
}

function blur(values: number[], kernel: number[]): number[] {
  const reach = (kernel.length - 1) / 2;
  return values.map((_, i) => {
    let v = 0;
    for (let k = 0; k < kernel.length; k++) v += kernel[k]! * values[Math.max(0, Math.min(values.length - 1, i + k - reach))]!;
    return v;
  });
}

function smoothLine(path: TrackPath): SmoothLine {
  const cached = lines.get(path);
  if (cached) return cached;
  // Cover the course, the look-ahead past the finish, and the blur's reach at both ends.
  const margin = 3 * Math.max(SIGMA_XZ, SIGMA_Y) + ENVELOPE;
  const start = -margin;
  const count = Math.ceil((path.length + LOOK_AHEAD + 2 * margin) / STEP) + 1;
  const p = new Vector3();
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < count; i++) {
    rawAt(path, start + i * STEP, p);
    xs.push(p.x);
    ys.push(p.y);
    zs.push(p.z);
  }
  const kXz = gaussian(SIGMA_XZ);
  const kY = gaussian(SIGMA_Y);
  const sx = blur(xs, kXz);
  const sz = blur(zs, kXz);
  const sy = blur(runningMax(ys, Math.round(ENVELOPE / STEP)), kY);
  const line: SmoothLine = { start, points: sx.map((x, i) => new Vector3(x, sy[i]!, sz[i]!)) };
  lines.set(path, line);
  return line;
}

/** The smoothed line at path distance `s`. */
function smoothAt(line: SmoothLine, s: number, out: Vector3): Vector3 {
  const f = Math.max(0, Math.min(line.points.length - 1.000001, (s - line.start) / STEP));
  const i = Math.floor(f);
  return out.lerpVectors(line.points[i]!, line.points[i + 1]!, f - i);
}

const ahead = new Vector3();
const behind = new Vector3();
const side = new Vector3();

/** Camera position and look-at target at `t` seconds into the (looping) flyover. */
export function flyoverPose(path: TrackPath, t: number, pos: Vector3, target: Vector3): void {
  const line = smoothLine(path);
  const duration = flyoverDuration(path);
  const loopT = ((t % duration) + duration) % duration;
  const s = (loopT / duration) * path.length;

  smoothAt(line, s, pos);
  // Sway across the smoothed direction of travel.
  smoothAt(line, s + 300, ahead);
  smoothAt(line, s - 300, behind);
  const heading = Math.atan2(-(ahead.x - behind.x), -(ahead.z - behind.z));
  pos.y += HEIGHT;
  pos.addScaledVector(rightOf(heading, side), Math.sin((loopT / SWAY_PERIOD_S) * Math.PI * 2) * SWAY);

  smoothAt(line, s + LOOK_AHEAD, target);
  target.y += 60;
}

/**
 * How dark the view should be at `t` (0 clear, 1 black): it fades out into
 * the end of each loop and back in after the cut to the start, so the jump
 * from the finish back to the start isn't a hard cut.
 */
export function flyoverFade(path: TrackPath, t: number): number {
  const duration = flyoverDuration(path);
  const loopT = ((t % duration) + duration) % duration;
  const fromSeam = Math.min(loopT, duration - loopT);
  if (fromSeam >= FADE_SECONDS) return 0;
  const x = 1 - fromSeam / FADE_SECONDS;
  return x * x * (3 - 2 * x); // smoothstep
}
