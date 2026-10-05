/**
 * Quake/Source-style movement primitives. Each function mutates and returns
 * the vector it's given and touches nothing else, so they're deterministic
 * and trivially testable.
 */
import { Vector3 } from 'three';
import type { PhysicsParams } from './constants.js';

/**
 * Source's PM_Accelerate / PM_AirAccelerate in one function.
 *
 * `speedCap` limits how fast we try to go *along wishDir* (the addSpeed
 * check) while the acceleration itself still scales with the full
 * `wishSpeed`. In the air the cap is ~30, which is why turning while
 * strafing keeps adding speed: velocity stays nearly perpendicular to
 * wishDir, so there is always room under the cap.
 */
export function accelerate(
  vel: Vector3,
  wishDir: Vector3,
  wishSpeed: number,
  accel: number,
  dt: number,
  speedCap = wishSpeed,
): Vector3 {
  const currentSpeed = vel.dot(wishDir);
  const addSpeed = Math.min(wishSpeed, speedCap) - currentSpeed;
  if (addSpeed <= 0) return vel;
  const accelSpeed = Math.min(accel * dt * wishSpeed, addSpeed);
  return vel.addScaledVector(wishDir, accelSpeed);
}

/** Ground friction. Callers apply it only while grounded. */
export function applyFriction(vel: Vector3, params: PhysicsParams, dt: number): Vector3 {
  const speed = vel.length();
  if (speed < 0.1) return vel.set(0, 0, 0);
  const control = Math.max(speed, params.stopSpeed);
  const newSpeed = Math.max(speed - control * params.friction * dt, 0);
  return vel.multiplyScalar(newSpeed / speed);
}

/** Remove the part of `vel` heading into a plane (overbounce 1 = pure slide). */
export function clipVelocity(vel: Vector3, normal: Vector3, overbounce = 1): Vector3 {
  const backoff = vel.dot(normal) * overbounce;
  return vel.addScaledVector(normal, -backoff);
}

/** Velocity counts as heading into a plane only beyond this, to absorb float noise. */
const INTO_PLANE_EPSILON = -1e-4;

const original = new Vector3();
const crease = new Vector3();

/**
 * Clip against several touching planes at once (Source's TryPlayerMove logic):
 * find one plane whose clip doesn't push into any other; failing that, slide
 * along the crease of two planes; with three or more, stop.
 */
export function clipVelocityToPlanes(vel: Vector3, planes: readonly Vector3[], count: number): Vector3 {
  if (count === 0) return vel;
  original.copy(vel);

  for (let i = 0; i < count; i++) {
    vel.copy(original);
    clipVelocity(vel, planes[i]!);
    let ok = true;
    for (let j = 0; j < count; j++) {
      if (j !== i && vel.dot(planes[j]!) < INTO_PLANE_EPSILON) {
        ok = false;
        break;
      }
    }
    if (ok) return vel;
  }

  if (count === 2) {
    crease.crossVectors(planes[0]!, planes[1]!);
    if (crease.lengthSq() > 1e-12) {
      crease.normalize();
      return vel.copy(crease).multiplyScalar(crease.dot(original));
    }
  }
  return vel.set(0, 0, 0);
}

/**
 * Horizontal wish direction and speed from WASD input and view yaw.
 * Writes the unit direction into `dir` and returns the wish speed.
 */
export function wishFromInput(yaw: number, forward: number, side: number, maxSpeed: number, dir: Vector3): number {
  // forward = (-sin yaw, 0, -cos yaw), right = (cos yaw, 0, -sin yaw); see game/view.ts.
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  dir.set(-s * forward + c * side, 0, -c * forward - s * side);
  const len = dir.length();
  if (len < 1e-9) {
    dir.set(0, 0, 0);
    return 0;
  }
  dir.divideScalar(len);
  return maxSpeed * Math.min(len, 1);
}
