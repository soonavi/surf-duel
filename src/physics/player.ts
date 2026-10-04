/**
 * One simulation tick of player movement, modelled on Source's
 * CGameMovement::FullWalkMove. Deterministic: the only thing it mutates is
 * the `PlayerState` it's handed.
 */
import { Vector3 } from 'three';
import { FLOOR_NORMAL_Y, PLAYER_RADIUS, type PhysicsParams } from './constants';
import { ContactList, type CollisionWorld } from './collision';
import { accelerate, applyFriction, clipVelocity, clipVelocityToPlanes, wishFromInput } from './movement';

export interface PlayerState {
  /** Bottom of the capsule. */
  pos: Vector3;
  vel: Vector3;
  onGround: boolean;
  /** Valid while `onGround`. */
  groundNormal: Vector3;
  /** Touched a surfable (steep) surface during the last tick. */
  surfing: boolean;
}

export interface MoveCmd {
  /** -1..1 (W/S) */
  forward: number;
  /** -1..1 (D/A) */
  side: number;
  /** Held jump; auto-hops while held. */
  jump: boolean;
  /** View yaw in radians (see game/view.ts). */
  yaw: number;
}

/** Moving up faster than this means we're airborne, even right above a floor (Source: 140). */
const NON_JUMP_VELOCITY = 140;
/** How far below the feet we look for ground when we were airborne... */
const GROUND_PROBE = 2;
/** ...and when we were grounded, so walking down slopes and small steps stays glued. */
const GROUND_SNAP = 18;
/** Never move more than this per collision substep, so the capsule can't skip through a face. */
const MAX_SUBSTEP_TRAVEL = PLAYER_RADIUS / 2;
const MAX_SUBSTEPS = 16;
/** Penetration-resolution passes per substep (corners need more than one). */
const RESOLVE_ITERATIONS = 4;
/** Contacts flatter than this count as walls rather than surf (walls aren't surfable). */
const MIN_SURF_NORMAL_Y = 0.05;

export function createPlayer(pos = new Vector3()): PlayerState {
  return { pos: pos.clone(), vel: new Vector3(), onGround: false, groundNormal: new Vector3(0, 1, 0), surfing: false };
}

// Scratch state, reused every tick.
const wishDir = new Vector3();
const primal = new Vector3();
const probe = new Vector3();
const probeStart = new Vector3();
const contacts = new ContactList();
const planes = new ContactList(8);

export function stepPlayer(state: PlayerState, cmd: MoveCmd, params: PhysicsParams, world: CollisionWorld, dt: number): void {
  const { vel } = state;
  const wishSpeed = wishFromInput(cmd.yaw, cmd.forward, cmd.side, params.maxSpeed, wishDir);

  // Half the gravity before moving and half after keeps the arc accurate (Source's Start/FinishGravity).
  if (!state.onGround) vel.y -= params.gravity * dt * 0.5;

  // Jump is checked before friction, so hopping on the landing tick keeps all your speed.
  if (cmd.jump && state.onGround) {
    vel.y = params.jumpImpulse;
    state.onGround = false;
  }

  if (state.onGround) {
    applyFriction(vel, params, dt);
    accelerate(vel, wishDir, wishSpeed, params.accelerate, dt);
    clipVelocity(vel, state.groundNormal);
  } else {
    accelerate(vel, wishDir, wishSpeed, params.airAccelerate, dt, params.airWishSpeedCap);
  }
  clampVelocity(vel, params.maxVelocity);

  const wasOnGround = state.onGround;
  moveAndSlide(state, world, dt);
  categorizePosition(state, world, wasOnGround);

  if (!state.onGround) vel.y -= params.gravity * dt * 0.5;
}

function clampVelocity(vel: Vector3, max: number): void {
  vel.set(
    Math.min(max, Math.max(-max, vel.x)),
    Math.min(max, Math.max(-max, vel.y)),
    Math.min(max, Math.max(-max, vel.z)),
  );
}

function addPlane(n: Vector3): void {
  for (let i = 0; i < planes.count; i++) {
    if (planes.normals[i]!.dot(n) > 0.999) return;
  }
  planes.add(n);
}

/**
 * Move by vel × dt in substeps short enough not to tunnel. After each
 * substep, push out of geometry and clip velocity against every surface
 * we're moving into. Sliding along a steep plane with no friction is surfing.
 */
function moveAndSlide(state: PlayerState, world: CollisionWorld, dt: number): void {
  const { pos, vel } = state;
  primal.copy(vel);
  planes.clear();
  state.surfing = false;

  const travel = vel.length() * dt;
  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(travel / MAX_SUBSTEP_TRAVEL)));
  const subDt = dt / steps;

  for (let s = 0; s < steps; s++) {
    pos.addScaledVector(vel, subDt);
    for (let iter = 0; iter < RESOLVE_ITERATIONS; iter++) {
      contacts.clear();
      if (world.resolveCapsule(pos, contacts) === 0) break;
      for (let i = 0; i < contacts.count; i++) {
        const n = contacts.normals[i]!;
        if (n.y < FLOOR_NORMAL_Y && n.y > MIN_SURF_NORMAL_Y) state.surfing = true;
        if (vel.dot(n) < 0) addPlane(n);
      }
      clipVelocityToPlanes(vel, planes.normals, planes.count);
      // Turned back against where we started this tick: stop rather than jitter in a corner.
      if (vel.dot(primal) <= 0) {
        vel.set(0, 0, 0);
        return;
      }
    }
  }
}

/**
 * Decide whether we're standing on something. Only surfaces with
 * normal.y ≥ FLOOR_NORMAL_Y count — steeper ones are surf ramps. When we
 * find ground, snap straight down onto it (vertical snap, so standing on a
 * slope doesn't creep sideways) and drop any velocity into it.
 */
function categorizePosition(state: PlayerState, world: CollisionWorld, wasOnGround: boolean): void {
  const { pos, vel } = state;
  if (vel.y > NON_JUMP_VELOCITY) {
    state.onGround = false;
    return;
  }

  // Sweep down in short steps: a single deep probe could sink the capsule's
  // core segment through a floor face, and then push-out goes the wrong way.
  let remaining = wasOnGround ? GROUND_SNAP : GROUND_PROBE;
  probe.copy(pos);
  contacts.clear();
  while (remaining > 0 && contacts.count === 0) {
    const step = Math.min(remaining, MAX_SUBSTEP_TRAVEL);
    remaining -= step;
    probe.y -= step;
    probeStart.copy(probe);
    world.resolveCapsule(probe, contacts);
  }

  let best: Vector3 | null = null;
  for (let i = 0; i < contacts.count; i++) {
    const n = contacts.normals[i]!;
    if (n.y >= FLOOR_NORMAL_Y && (!best || n.y > best.y)) best = n;
  }
  if (!best) {
    state.onGround = false;
    return;
  }

  // Convert the push-out along the floor normal into a purely vertical lift.
  const push = probe.sub(probeStart);
  const snappedY = probeStart.y + push.dot(best) / best.y;
  if (snappedY <= pos.y + 1e-3) pos.y = snappedY;
  state.onGround = true;
  state.groundNormal.copy(best);
  clipVelocity(vel, best);
}
