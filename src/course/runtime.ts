/**
 * Per-tick course rules: trigger volumes (start, checkpoints, boosters,
 * finish), the kill floor and respawn points. Shared by the game and the
 * headless playability tests, so both see exactly the same course.
 */
import { Vector3 } from 'three';
import type { BuiltCourse, SpawnPoint, Trigger } from './builder.js';
import { forwardOf } from './layout.js';
import { PLAYER_HEIGHT } from '../physics/constants.js';
import type { PlayerState } from '../physics/player.js';

export type CourseEvent =
  | { type: 'start' }
  | { type: 'checkpoint'; index: number }
  | { type: 'booster'; index: number }
  | { type: 'finish' }
  | { type: 'kill' }
  /** A checkpoint or the finish reached without passing checkpoint `index`: it doesn't count. */
  | { type: 'missed'; index: number };

/** Is point `p` inside the trigger's heading-aligned box? */
export function triggerContains(t: Trigger, p: Vector3): boolean {
  const dx = p.x - t.center.x;
  const dz = p.z - t.center.z;
  const s = Math.sin(t.heading);
  const c = Math.cos(t.heading);
  const lateral = dx * c - dz * s;
  const along = -dx * s - dz * c;
  return Math.abs(lateral) <= t.half.x && Math.abs(p.y - t.center.y) <= t.half.y && Math.abs(along) <= t.half.z;
}

/** Put a player at a spawn point, moving at its speed along its heading. */
export function placeAtSpawn(state: PlayerState, spawn: SpawnPoint): void {
  state.pos.copy(spawn.pos);
  forwardOf(spawn.heading, state.vel).multiplyScalar(spawn.speed);
  state.onGround = false;
  state.surfing = false;
}

const boostDir = new Vector3();

/**
 * Add `strength` u/s of horizontal speed. Pushes along the rider's current
 * direction (so a boost never yanks you sideways off your line), or along the
 * track if they're nearly stopped.
 */
export function applyBoost(vel: Vector3, heading: number, strength: number): Vector3 {
  const h = Math.hypot(vel.x, vel.z);
  if (h > 100) boostDir.set(vel.x / h, 0, vel.z / h);
  else forwardOf(heading, boostDir);
  vel.x += boostDir.x * strength;
  vel.z += boostDir.z * strength;
  return vel;
}

export class CourseRuntime {
  /** Highest checkpoint reached; 0 is the start. */
  lastCheckpoint = 0;
  finished = false;
  started = false;
  /** Distance along the course of the rider's nearest path point. */
  progress = 0;
  /** Layout piece the rider is on, or flying toward. */
  piece = 0;
  /** Rider's offset from the riding line; positive is to their right. */
  lateral = 0;

  private hint = 0;
  private readonly inside = new Set<Trigger>();
  private readonly probe = new Vector3();

  constructor(readonly built: BuiltCourse) {}

  /** Back to the start line with nothing reached. */
  reset(): void {
    this.startFrom(0);
  }

  /** Begin a run as if checkpoint `index` had just been reached (0 = the start). */
  startFrom(index: number): void {
    this.lastCheckpoint = Math.max(0, Math.min(index, this.built.checkpoints.length - 1));
    this.finished = false;
    this.started = this.lastCheckpoint > 0;
    this.progress = 0;
    this.piece = 0;
    this.lateral = 0;
    this.hint = 0;
    this.inside.clear();
  }

  respawnPoint(): SpawnPoint {
    return this.built.checkpoints[this.lastCheckpoint] ?? this.built.spawn;
  }

  /** After a respawn, forget which triggers we were in and resync progress. */
  afterRespawn(state: PlayerState): void {
    this.inside.clear();
    const hit = this.built.path.relocate(state.pos);
    this.hint = hit.index;
    this.piece = hit.sample.piece;
    this.lateral = hit.lateral;
    for (const t of this.built.triggers) {
      if (triggerContains(t, this.centerOf(state))) this.inside.add(t);
    }
  }

  /** Call once per tick after moving the player. May modify `state.vel` (boosters). */
  update(state: PlayerState): CourseEvent[] {
    const hit = this.built.path.locate(state.pos, this.hint);
    this.hint = hit.index;
    this.progress = hit.s;
    this.piece = hit.sample.piece;
    this.lateral = hit.lateral;
    if (state.pos.y < hit.sample.killY) return [{ type: 'kill' }];

    const events: CourseEvent[] = [];
    const center = this.centerOf(state);
    for (const t of this.built.triggers) {
      const now = triggerContains(t, center);
      const was = this.inside.has(t);
      if (now === was) continue;
      if (now) {
        this.inside.add(t);
        this.enter(t, state, events);
      } else {
        this.inside.delete(t);
      }
    }
    // The run starts the first time we're outside the start zone.
    if (!this.started && !this.isInsideStart()) {
      this.started = true;
      events.unshift({ type: 'start' });
    }
    return events;
  }

  private enter(t: Trigger, state: PlayerState, events: CourseEvent[]): void {
    switch (t.kind) {
      case 'booster':
        applyBoost(state.vel, t.heading, t.strength);
        events.push({ type: 'booster', index: t.index });
        break;
      // Checkpoints count only in order, and the finish only after all of them (user, Oct 8 2026:
      // you could drop straight from Spire's spiral entry to its exit). Skipping one is reported.
      case 'checkpoint':
        if (t.index === this.lastCheckpoint + 1) {
          this.lastCheckpoint = t.index;
          events.push({ type: 'checkpoint', index: t.index });
        } else if (t.index > this.lastCheckpoint + 1) {
          events.push({ type: 'missed', index: this.lastCheckpoint + 1 });
        }
        break;
      case 'finish':
        if (this.finished) break;
        if (this.lastCheckpoint < this.built.checkpoints.length - 1) {
          events.push({ type: 'missed', index: this.lastCheckpoint + 1 });
          break;
        }
        this.finished = true;
        events.push({ type: 'finish' });
        break;
      case 'start':
        break;
    }
  }

  private isInsideStart(): boolean {
    for (const t of this.inside) if (t.kind === 'start') return true;
    return false;
  }

  private centerOf(state: PlayerState): Vector3 {
    return this.probe.copy(state.pos).setY(state.pos.y + PLAYER_HEIGHT / 2);
  }
}
