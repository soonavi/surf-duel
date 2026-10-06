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
  /** Nose-down slope of every ramp along its length — where the speed comes from. */
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
}

export const DIFFICULTY: Readonly<Record<Difficulty, DifficultyParams>> = {
  easy: { pitchDeg: 6, faceWidth: 850, transferReach: 0, transferAirTime: 0, rampsPerCheckpoint: 3 },
  medium: { pitchDeg: 8, faceWidth: 750, transferReach: 0, transferAirTime: 0, rampsPerCheckpoint: 3 },
  hard: { pitchDeg: 10, faceWidth: 600, transferReach: 0.45, transferAirTime: 1.3, rampsPerCheckpoint: 4 },
  expert: { pitchDeg: 11, faceWidth: 480, transferReach: 0.6, transferAirTime: 1.2, rampsPerCheckpoint: 5 },
};

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

export function afterRamp(speed: SpeedRange, length: number, difficulty: Difficulty): SpeedRange {
  const drop = length * Math.sin((DIFFICULTY[difficulty].pitchDeg * Math.PI) / 180);
  const lo = Math.sqrt(speed.lo * speed.lo + 2 * PLAN_GRAVITY * drop * 0.75);
  // Strafing adds speed on top of gravity; ~5% of ramp length is a modest estimate.
  const hi = Math.sqrt(speed.hi * speed.hi + 2 * PLAN_GRAVITY * drop) + 0.05 * length;
  return { lo: Math.min(lo, DEFAULT_PHYSICS.maxVelocity), hi: Math.min(hi, DEFAULT_PHYSICS.maxVelocity) };
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
