/**
 * Layout constants and the speed model shared by the validator and builder.
 *
 * Planning always uses DEFAULT_PHYSICS, never the live tuning values, so a
 * course spec builds the same geometry for everyone.
 */
import { DEFAULT_PHYSICS, TICK_RATE } from '../physics/constants.js';
import type { Difficulty } from './schema.js';

export const PLAN_GRAVITY = DEFAULT_PHYSICS.gravity;

export interface DifficultyParams {
  /** Usual nose-down slope of a ramp along its length (where free speed comes from); a ramp's own `pitch` overrides it. */
  pitchDeg: number;
  /** Horizontal width of each ramp face (peak to base edge). Wider is more forgiving. */
  faceWidth: number;
  /**
   * Sideways transfers: each ramp sits off to the side of the last one's
   * line, by this fraction of the most a perfect air-strafe could cover in
   * the air (landing parallel again; see AIR_STRAFE_REACH). 0 = straight on.
   */
  transferReach: number;
  /** Least time in the air on a sideways transfer (s): drops are deepened to give it. */
  transferAirTime: number;
  /** A checkpoint at least every this many ramps. Fewer checkpoints punish mistakes. */
  rampsPerCheckpoint: number;
  /** Half-width of a wall's window, across the face either side of its centre (set off the riding line). */
  windowSlack: number;
}

/**
 * Expert ramps barely descend (user, Oct 6 2026: expert "isn't very hard because
 * of how fast you can get, and because it is downhill"): its speed comes from
 * boosters, and keeping it is the skill.
 */
export const DIFFICULTY: Readonly<Record<Difficulty, DifficultyParams>> = {
  easy: { pitchDeg: 6, faceWidth: 850, transferReach: 0, transferAirTime: 0, rampsPerCheckpoint: 3, windowSlack: 190 },
  medium: { pitchDeg: 8, faceWidth: 750, transferReach: 0, transferAirTime: 0, rampsPerCheckpoint: 3, windowSlack: 160 },
  hard: { pitchDeg: 10, faceWidth: 600, transferReach: 0.45, transferAirTime: 1.3, rampsPerCheckpoint: 4, windowSlack: 95 },
  expert: { pitchDeg: 6, faceWidth: 480, transferReach: 0.6, transferAirTime: 1.2, rampsPerCheckpoint: 5, windowSlack: 70 },
};

/** A ramp's slope along its length (degrees downhill; negative climbs). */
export function rampPitchDeg(ramp: { pitch?: number | null | undefined }, difficulty: Difficulty): number {
  return ramp.pitch ?? DIFFICULTY[difficulty].pitchDeg;
}

/**
 * A spiral: one turn of ramps round a tower, its riding line on a circle of
 * this radius (wide enough for the flyover camera to follow), with a transfer
 * spanning SPIRAL_GAP_DEG of the circle between ramps.
 */
export const SPIRAL_RADIUS = 5600;
export const SPIRAL_GAP_DEG = 12;
/** A spiral's ramps run nearly level: its descent comes from the drops between them, not free speed. */
export const SPIRAL_PITCH_DEG = 2;

/** Length of each ramp in a spiral of `ramps` ramps (the last one also closes the gap back to the start). */
export function spiralArcLength(ramps: number, last = false): number {
  const span = (2 * Math.PI) / ramps - (last ? 0 : (SPIRAL_GAP_DEG * Math.PI) / 180);
  return SPIRAL_RADIUS * span;
}

/** Riders must still be doing at least this at the top of a climb (a cautious one, and on respawning there). */
export const MIN_CLIMB_SPEED = 600;
/** Slower than this, a ramp flatter than MIN_CRUISE_PITCH only crawls you along: it gets its usual downhill slope back. */
export const MIN_CRUISE_SPEED = 500;
export const MIN_CRUISE_PITCH = 3;

/**
 * Air-strafing (looking along your velocity, holding A or D) pushes you
 * sideways at airWishSpeedCap per tick: 3000 u/s² whatever your speed. Push
 * one way for half the flight and back for the other half and you land
 * parallel, AIR_STRAFE_REACH·t² to the side after t seconds in the air.
 * Holding a key without turning only reaches airWishSpeedCap (30 u/s) sideways.
 */
export const AIR_STRAFE_REACH = (DEFAULT_PHYSICS.airWishSpeedCap * TICK_RATE) / 4;

/** Courses whose transfers take air-strafing: a rider who only holds into the ramp can't finish them. */
export function needsAirStrafe(difficulty: Difficulty): boolean {
  return DIFFICULTY[difficulty].transferReach > 0;
}

/**
 * Riders are modelled as a speed range: `lo` is a cautious rider who never
 * strafes and converts gravity poorly; `hi` is a strong rider who strafes for
 * extra speed. Every transition is laid out so both make it. Respawning at a
 * checkpoint puts you back at `lo`, so every checkpoint is a fair restart.
 */
export interface SpeedRange {
  lo: number;
  hi: number;
}

export const WALK_SPEED = DEFAULT_PHYSICS.maxSpeed;
export const START_SPEED: Readonly<SpeedRange> = { lo: WALK_SPEED, hi: 450 };

/** Most a cautious rider is allowed to fall while crossing a gap. */
export const MAX_GAP_FALL = 900;

/** Speeds at the end of a ramp `length` long running `pitchDeg` downhill (negative: climbing). */
export function afterRamp(speed: SpeedRange, length: number, pitchDeg: number): SpeedRange {
  const drop = length * Math.sin((pitchDeg * Math.PI) / 180);
  // Downhill a cautious rider keeps ~75% of what gravity gives; uphill everyone pays in full.
  const lo = Math.sqrt(Math.max(0, speed.lo * speed.lo + 2 * PLAN_GRAVITY * drop * (drop > 0 ? 0.75 : 1)));
  // Strafing adds speed on top of gravity; ~5% of ramp length is a modest estimate.
  const hi = Math.sqrt(Math.max(0, speed.hi * speed.hi + 2 * PLAN_GRAVITY * drop)) + 0.05 * length;
  return { lo: Math.min(lo, DEFAULT_PHYSICS.maxVelocity), hi: Math.min(Math.max(hi, lo), DEFAULT_PHYSICS.maxVelocity) };
}

export function afterFall(speed: SpeedRange, height: number): SpeedRange {
  // Landing on a steep face turns fall speed mostly sideways; only strong riders
  // redirect much of it forward.
  const hi = Math.sqrt(speed.hi * speed.hi + 2 * PLAN_GRAVITY * height * 0.5);
  return { lo: speed.lo, hi: Math.min(hi, DEFAULT_PHYSICS.maxVelocity) };
}

export function afterBooster(speed: SpeedRange, strength: number): SpeedRange {
  const max = DEFAULT_PHYSICS.maxVelocity;
  return { lo: Math.min(speed.lo + strength * 0.8, max), hi: Math.min(speed.hi + strength, max) };
}

/** Longest gap a cautious rider can cross without falling more than MAX_GAP_FALL. */
export function maxGapLength(speed: SpeedRange): number {
  return speed.lo * Math.sqrt((2 * MAX_GAP_FALL) / PLAN_GRAVITY);
}
