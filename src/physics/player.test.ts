import { describe, expect, it } from 'vitest';
import { BufferGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BvhWorld, EMPTY_WORLD, type CollisionWorld } from './collision.js';
import { DEFAULT_PHYSICS, PLAYER_RADIUS, TICK_DT, type PhysicsParams } from './constants.js';
import { createPlayer, stepPlayer, type MoveCmd, type PlayerState } from './player.js';
import { feetOnLeftFace, floorWorld, rampGeometry, rampWorld, sphereDistanceToLeftFace } from './testWorlds.js';

const P: PhysicsParams = { ...DEFAULT_PHYSICS };
const idle = (yaw = 0): MoveCmd => ({ forward: 0, side: 0, jump: false, yaw });
const horizSpeed = (v: Vector3): number => Math.hypot(v.x, v.z);
/** Yaw that faces along a velocity (inverse of view.ts flatForward). */
const yawOf = (v: Vector3): number => Math.atan2(-v.x, -v.z);

function run(
  state: PlayerState,
  world: CollisionWorld,
  ticks: number,
  cmdFor: (tick: number, s: PlayerState) => MoveCmd,
  onTick?: (s: PlayerState, tick: number) => void,
): void {
  for (let i = 0; i < ticks; i++) {
    stepPlayer(state, cmdFor(i, state), P, world, TICK_DT);
    onTick?.(state, i);
  }
}

function airborne(vel: Vector3): PlayerState {
  const s = createPlayer(new Vector3(0, 50_000, 0));
  s.vel.copy(vel);
  return s;
}

function grounded(world: CollisionWorld, vel = new Vector3()): PlayerState {
  const s = createPlayer(new Vector3(0, 0, 0));
  run(s, world, 2, () => idle()); // settle and categorise
  s.vel.copy(vel);
  return s;
}

describe('(a) air strafing', () => {
  it('gains horizontal speed when strafing right while turning in sync with velocity', () => {
    const s = airborne(new Vector3(0, 0, -400));
    run(s, EMPTY_WORLD, 100, (_, st) => ({ forward: 0, side: 1, jump: false, yaw: yawOf(st.vel) }));
    expect(horizSpeed(s.vel)).toBeGreaterThan(480);
  });

  it('gains speed holding D while turning the mouse right at a steady rate', () => {
    const s = airborne(new Vector3(0, 0, -400));
    const turnRate = (300 * Math.PI) / 180; // 300°/s to the right
    run(s, EMPTY_WORLD, 100, (i) => ({ forward: 0, side: 1, jump: false, yaw: -turnRate * i * TICK_DT }));
    expect(horizSpeed(s.vel)).toBeGreaterThan(430);
  });

  it('works mirrored: holding A while turning left', () => {
    const s = airborne(new Vector3(0, 0, -400));
    run(s, EMPTY_WORLD, 100, (_, st) => ({ forward: 0, side: -1, jump: false, yaw: yawOf(st.vel) }));
    expect(horizSpeed(s.vel)).toBeGreaterThan(480);
  });
});

describe('(b) no free speed', () => {
  it('holding W alone in the air does not gain speed', () => {
    const s = airborne(new Vector3(0, 0, -400));
    run(s, EMPTY_WORLD, 200, () => ({ forward: 1, side: 0, jump: false, yaw: 0 }));
    expect(horizSpeed(s.vel)).toBeLessThanOrEqual(400 + 1e-6);
  });

  it('holding W in the air from a standstill tops out at the air wish-speed cap', () => {
    const s = airborne(new Vector3());
    run(s, EMPTY_WORLD, 200, () => ({ forward: 1, side: 0, jump: false, yaw: 0 }));
    expect(horizSpeed(s.vel)).toBeLessThanOrEqual(P.airWishSpeedCap + 1e-6);
  });
});

describe('(c) surfing a 60° ramp', () => {
  const spec = { length: 20_000, height: 1200, angleDeg: 60 };
  const world = rampWorld(spec);

  function onRamp(): PlayerState {
    const s = createPlayer(feetOnLeftFace(spec, 1000, -500));
    s.vel.set(0, 0, -1000);
    return s;
  }

  it('slides along the ramp without stopping or sticking', () => {
    const s = onRamp();
    let surfTicks = 0;
    let everGrounded = false;
    let minDistance = Infinity;
    run(s, world, 50, () => idle(), (st) => {
      if (st.surfing) surfTicks++;
      if (st.onGround) everGrounded = true;
      minDistance = Math.min(minDistance, sphereDistanceToLeftFace(spec, st.pos));
    });
    expect(everGrounded).toBe(false);
    expect(surfTicks).toBeGreaterThanOrEqual(45);
    // Kept its forward speed (no friction, no snagging)...
    expect(s.vel.z).toBeLessThanOrEqual(-999);
    expect(s.pos.z).toBeLessThan(-500 - 490);
    // ...and gravity slid it down and out along the face rather than pinning it.
    expect(s.pos.y).toBeLessThan(1000 - 20);
    expect(s.vel.length()).toBeGreaterThan(1000);
    // Never sank into the ramp.
    expect(minDistance).toBeGreaterThan(PLAYER_RADIUS - 0.5);
  });

  it('stays on longer when strafing into the ramp (holding D)', () => {
    const free = onRamp();
    run(free, world, 100, () => idle());
    const held = onRamp();
    run(held, world, 100, () => ({ forward: 0, side: 1, jump: false, yaw: 0 }));
    expect(held.pos.y).toBeGreaterThan(free.pos.y + 50);
    expect(held.surfing).toBe(true);
    expect(held.vel.z).toBeLessThanOrEqual(-999);
  });

  it('gains speed steadily down a descending ramp, with no dips at triangle seams', () => {
    const pitched = { ...spec, pitchDeg: 10 };
    const w = rampWorld(pitched);
    const s = createPlayer(feetOnLeftFace(pitched, 1000, -200));
    s.vel.set(0, 0, -800).applyAxisAngle(new Vector3(1, 0, 0), -Math.PI / 18); // along the ramp
    let worstDrop = 0;
    let prev = s.vel.length();
    run(s, w, 300, () => ({ forward: 0, side: 1, jump: false, yaw: 0 }), (st) => {
      const speed = st.vel.length();
      worstDrop = Math.max(worstDrop, prev - speed);
      prev = speed;
    });
    expect(s.surfing).toBe(true);
    // g·sin(10°) ≈ 139 u/s² along the ramp → roughly +400 u/s over 3 s.
    expect(s.vel.length()).toBeGreaterThan(1100);
    expect(worstDrop).toBeLessThan(0.5);
  });
});

describe('(d) friction', () => {
  it('slows a grounded player with no input', () => {
    const world = floorWorld(0);
    const s = grounded(world, new Vector3(200, 0, 0));
    expect(s.onGround).toBe(true);
    run(s, world, 10, () => idle());
    expect(horizSpeed(s.vel)).toBeLessThan(200 * 0.8);
  });

  it('does not slow an airborne player', () => {
    const s = airborne(new Vector3(200, 0, 0));
    run(s, EMPTY_WORLD, 100, () => idle());
    expect(horizSpeed(s.vel)).toBeCloseTo(200, 9);
  });
});

describe('ground movement', () => {
  it('caps running speed at maxSpeed', () => {
    const world = floorWorld(0);
    const s = grounded(world);
    run(s, world, 200, () => ({ forward: 1, side: 0, jump: false, yaw: 0.3 }));
    expect(horizSpeed(s.vel)).toBeLessThanOrEqual(P.maxSpeed + 1e-6);
    expect(horizSpeed(s.vel)).toBeGreaterThan(P.maxSpeed - 1);
    expect(s.pos.y).toBeCloseTo(0, 3);
  });

  it('jumps off the ground when jump is held', () => {
    const world = floorWorld(0);
    const s = grounded(world);
    stepPlayer(s, { forward: 0, side: 0, jump: true, yaw: 0 }, P, world, TICK_DT);
    expect(s.onGround).toBe(false);
    expect(s.vel.y).toBeGreaterThan(P.jumpImpulse - P.gravity * TICK_DT - 1e-6);
    expect(s.pos.y).toBeGreaterThan(0);
  });

  it('auto-hops while jump is held and loses no speed to friction on landing', () => {
    const world = floorWorld(0);
    const s = grounded(world, new Vector3(0, 0, -400));
    let landings = 0;
    let wasGrounded = true;
    run(s, world, 300, () => ({ forward: 0, side: 0, jump: true, yaw: 0 }), (st) => {
      if (st.onGround && !wasGrounded) landings++;
      wasGrounded = st.onGround;
    });
    expect(landings).toBeGreaterThanOrEqual(3);
    expect(horizSpeed(s.vel)).toBeCloseTo(400, 6);
  });

  it('lands from a fall and comes to rest on the floor', () => {
    const world = floorWorld(0);
    const s = createPlayer(new Vector3(0, 300, 0));
    run(s, world, 200, () => idle());
    expect(s.onGround).toBe(true);
    expect(s.vel.y).toBe(0);
    expect(s.pos.y).toBeCloseTo(0, 3);
  });

  it('does not slide down a walkable 30° slope while standing still', () => {
    const slope = rampGeometry({ length: 4000, height: 400, angleDeg: 30 });
    const world = new BvhWorld(slope);
    const spec = { length: 4000, height: 400, angleDeg: 30 };
    const s = createPlayer(feetOnLeftFace(spec, 200, -2000).add(new Vector3(0, 1, 0)));
    run(s, world, 100, () => idle());
    const settled = s.pos.clone();
    run(s, world, 200, () => idle());
    expect(s.onGround).toBe(true);
    expect(s.pos.distanceTo(settled)).toBeLessThan(0.5);
  });
});

describe('collision robustness', () => {
  it('does not tunnel through a ramp at max velocity', () => {
    const spec = { length: 4000, height: 1200, angleDeg: 60 };
    const world = rampWorld(spec);
    const start = feetOnLeftFace(spec, 600, -2000).add(new Vector3(-200, 0, 0));
    const s = createPlayer(start);
    s.vel.set(P.maxVelocity, 0, 0);
    run(s, world, 10, () => idle());
    expect(sphereDistanceToLeftFace(spec, s.pos)).toBeGreaterThan(PLAYER_RADIUS - 1);
  });

  it('slides along the crease of a V-shaped trough instead of getting stuck', () => {
    const spec = { length: 6000, height: 600, angleDeg: 60 };
    const halfWidth = spec.height / Math.tan(Math.PI / 3);
    const geo: BufferGeometry = mergeGeometries([
      rampGeometry({ ...spec, x: -halfWidth }),
      rampGeometry({ ...spec, x: halfWidth }),
    ]);
    const world = new BvhWorld(geo);
    const s = createPlayer(new Vector3(0, 200, -300));
    s.vel.set(0, 0, -600);
    run(s, world, 100, () => idle());
    expect(s.vel.z).toBeLessThan(-590);
    expect(s.pos.z).toBeLessThan(-300 - 550);
    expect(s.pos.y).toBeGreaterThan(-1);
  });
});
