/**
 * Layout constants and the speed model shared by the validator and builder.
 *
 * Planning always uses DEFAULT_PHYSICS, never the live tuning values, so a
 * course spec builds the same geometry for everyone.
 */
import { DEFAULT_PHYSICS } from '../physics/constants';
import type { Difficulty } from './schema';

export const PLAN_GRAVITY = DEFAULT_PHYSICS.gravity;

export interface DifficultyParams {
  /** Nose-down slope of every ramp along its length — where the speed comes from. */
  pitchDeg: number;
  /** Horizontal width of each ramp face (peak to base edge). Wider is more forgiving. */
  faceWidth: number;
}

export const DIFFICULTY: Readonly<Record<Difficulty, DifficultyParams>> = {
  easy: { pitchDeg: 6, faceWidth: 850 },
  medium: { pitchDeg: 8, faceWidth: 750 },
  hard: { pitchDeg: 10, faceWidth: 650 },
};

/**
 * Riders are modelled as a speed range: `lo` is a cautious rider who stalls on
 * every checkpoint pad and never strafes; `hi` is a strong rider who bunny-hops
 * through pads and strafes for extra speed. Every transition is laid out so
 * both make it.
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

export function afterPad(speed: SpeedRange): SpeedRange {
  return { lo: WALK_SPEED, hi: speed.hi };
}

/** Longest gap a cautious rider can cross without falling more than MAX_GAP_FALL. */
export function maxGapLength(speed: SpeedRange): number {
  return speed.lo * Math.sqrt((2 * MAX_GAP_FALL) / PLAN_GRAVITY);
}
