/**
 * Course preview camera: glides along the riding line, high above it, looking
 * ahead, and loops. Pure (path in, pose out), so it's tested headless.
 */
import { Vector3 } from 'three';
import type { TrackPath } from '../course/path';
import { rightOf } from '../course/layout';

/** Height above the riding line. */
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

/** Seconds for one pass over the whole course. */
export function flyoverDuration(path: TrackPath): number {
  const speed = Math.max(MIN_SPEED, path.length / MAX_DURATION_S);
  return Math.max(1, path.length / speed);
}

const side = new Vector3();

/** Camera position and look-at target at `t` seconds into the (looping) flyover. */
export function flyoverPose(path: TrackPath, t: number, pos: Vector3, target: Vector3): void {
  const duration = flyoverDuration(path);
  const loopT = ((t % duration) + duration) % duration;
  const s = (loopT / duration) * path.length;
  const heading = path.pointAt(s, pos);
  pos.y += HEIGHT;
  pos.addScaledVector(rightOf(heading, side), Math.sin((loopT / SWAY_PERIOD_S) * Math.PI * 2) * SWAY);
  path.pointAt(s + LOOK_AHEAD, target);
  target.y += 60;
  // Near the end the look-ahead clamps to the finish; keep looking forward, not down at our feet.
  if (target.distanceToSquared(pos) < 600 * 600) target.addScaledVector(pos.clone().sub(target).setY(0).normalize(), -900);
}
