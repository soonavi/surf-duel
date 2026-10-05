/**
 * Game-feel numbers, kept pure so they're tested: how much the view widens
 * with speed, how far the camera leans when strafing, and when speed lines
 * show. The renderer applies them; physics never sees them.
 */

/** The most the field of view widens at top speed (degrees). */
export const SPEED_FOV_EXTRA = 10;
/** The camera leans this far (radians, about 1.4°) toward the strafe key. */
export const MAX_ROLL = 0.025;

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Field of view at a horizontal speed (u/s): the base until 600, up to +SPEED_FOV_EXTRA at 3200. */
export function speedFov(baseFov: number, speed: number): number {
  return baseFov + SPEED_FOV_EXTRA * smooth((speed - 600) / 2600);
}

/**
 * Ease the camera roll toward the strafe direction (`side`: −1 A, 0, +1 D).
 * Holding D tips the view right (negative roll), A left.
 */
export function approachRoll(roll: number, side: number, dt: number): number {
  const target = -Math.sign(side) * MAX_ROLL;
  return target + (roll - target) * Math.exp(-dt * 6);
}

/** How strong the speed lines are (0–1): none below 2200 u/s, full at 3600. */
export function speedLines(speed: number): number {
  return smooth((speed - 2200) / 1400);
}
