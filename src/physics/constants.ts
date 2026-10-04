/**
 * Physics constants, in Source-like units (1 unit ≈ 2 cm, Y is up).
 *
 * Gameplay code reads the live `physics` object so the dev tuning panel can
 * change values at runtime. Pure movement functions take a `PhysicsParams`
 * argument instead of reading globals, so tests can pin exact values.
 */

/** Simulation tick rate (Hz). Fixed; rendering interpolates between ticks. */
export const TICK_RATE = 100;
export const TICK_DT = 1 / TICK_RATE;

/** Player capsule, in game units. */
export const PLAYER_RADIUS = 16;
export const PLAYER_HEIGHT = 72;
export const EYE_HEIGHT = 64;

/** Surfaces with normal.y below this are surfable ramps; at or above it they are floors. */
export const FLOOR_NORMAL_Y = 0.7;

export interface PhysicsParams {
  gravity: number;
  /** Max ground speed (and the wish speed for full input). */
  maxSpeed: number;
  accelerate: number;
  airAccelerate: number;
  /** Cap on wish speed for the air `addSpeed` check — this is what makes air-strafing gain speed. */
  airWishSpeedCap: number;
  friction: number;
  /** Below this speed, friction acts as if moving at stopSpeed (Source's sv_stopspeed). */
  stopSpeed: number;
  jumpImpulse: number;
  /** Hard clamp on each velocity component. */
  maxVelocity: number;
}

export const DEFAULT_PHYSICS: Readonly<PhysicsParams> = Object.freeze({
  gravity: 800,
  maxSpeed: 260,
  accelerate: 10,
  airAccelerate: 150,
  airWishSpeedCap: 30,
  friction: 4,
  stopSpeed: 100,
  jumpImpulse: 290,
  maxVelocity: 3500,
});

/** Slider ranges for the dev tuning panel. */
export const PHYSICS_LIMITS: Readonly<Record<keyof PhysicsParams, { min: number; max: number; step: number }>> = {
  gravity: { min: 0, max: 2000, step: 10 },
  maxSpeed: { min: 50, max: 1000, step: 5 },
  accelerate: { min: 0, max: 50, step: 0.5 },
  airAccelerate: { min: 0, max: 1000, step: 5 },
  airWishSpeedCap: { min: 0, max: 200, step: 1 },
  friction: { min: 0, max: 20, step: 0.1 },
  stopSpeed: { min: 0, max: 300, step: 5 },
  jumpImpulse: { min: 0, max: 800, step: 5 },
  maxVelocity: { min: 500, max: 10000, step: 50 },
};

/** Live, mutable copy edited by the dev panel. */
export const physics: PhysicsParams = { ...DEFAULT_PHYSICS };
