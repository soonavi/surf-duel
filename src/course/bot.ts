/**
 * A simple surf bot: look down the track, hold the key that points into the
 * ramp whenever you've slid below the riding line, let go when you're above
 * it. Used to prove courses are beatable (playability tests), to record the
 * BOT ghost, and to drive the cover shot.
 *
 * A skilled bot (`airStrafe`) also steers in the air like a player: it holds
 * A or D while turning to follow its velocity, which swings the velocity
 * round toward the riding line ahead. That's what hard courses' sideways
 * transfers take.
 */
import { Vector3 } from 'three';
import type { BuiltCourse } from './builder.js';
import { RIDGE_RIDE, WALL_GATE_AFTER, forwardOf, type WallPiece } from './layout.js';
import { needsAirStrafe } from './tuning.js';
import type { MoveCmd, PlayerState } from '../physics/player.js';

export interface BotStyle {
  /** Bunny-hop across pads (keeps speed) instead of walking (cautious). */
  hop: boolean;
  /**
   * Air-strafe toward the riding line between ramps (a skilled rider).
   * Defaults to whether the course needs it (hard and expert courses).
   */
  airStrafe?: boolean;
}

/** Air-strafing aims at the riding line this far ahead: speed × time, at least the minimum. */
const AIR_LOOKAHEAD_TIME = 0.4;
const AIR_LOOKAHEAD_MIN = 400;
/** Close enough in heading: stop turning (rad). */
const AIR_DEADBAND = 0.01;
const target = new Vector3();

function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Slack around the riding line before the bot corrects. */
const RIDE_TOLERANCE = 25;
/** On a two-sided ramp the riding line is the ridge; ride this far below it. */
const BOTH_RIDE_OFFSET = RIDGE_RIDE;
/** Past a wall's plane by this much, it's behind us. */
const WALL_PASSED = 60;
/** Only bunny-hop when already moving faster than this (hopping can't build speed from rest). */
const HOP_MIN_SPEED = 400;

export class SurfBot {
  private hint = 0;
  private readonly airStrafes: boolean;
  /** Ramps with a wall past their end (ride at its window's height on the face to fly through it). */
  private readonly walls = new Map<number, WallPiece>();
  /** The ramp we last surfed. */
  private lastRamp = -1;

  constructor(
    private readonly built: BuiltCourse,
    private readonly style: BotStyle = { hop: false },
  ) {
    this.airStrafes = style.airStrafe ?? needsAirStrafe(built.course.difficulty);
    for (const p of built.pieces) if (p.kind === 'wall') this.walls.set(p.ramp, p);
  }

  /** Call after teleporting the player (respawn). */
  resync(state: PlayerState): void {
    this.hint = this.built.path.relocate(state.pos).index;
  }

  command(state: PlayerState): MoveCmd {
    const path = this.built.path;
    const hit = path.locate(state.pos, this.hint);
    this.hint = hit.index;

    // Face along the track *here*: the strafe key then pushes square to the
    // track, cancelling any outward slide without braking forward speed.
    // (Looking ahead on a curve tilts that push backwards and bleeds speed.)
    const yaw = hit.sample.heading;

    const piece = this.built.pieces[hit.sample.piece];
    if (state.onGround) {
      // Standing on a ramp means balancing on its ridge: step off sideways.
      if (piece?.kind === 'ramp' && this.onRampRidge(state)) {
        return { forward: 0, side: hit.lateral >= 0 ? 1 : -1, jump: false, yaw };
      }
      // Hopping only keeps speed you already have; from a standstill, walk.
      const fast = Math.hypot(state.vel.x, state.vel.z) > HOP_MIN_SPEED;
      return { forward: 1, side: 0, jump: this.style.hop && fast, yaw };
    }

    if (state.surfing && piece?.kind === 'ramp') this.lastRamp = hit.sample.piece;
    // Once down on a walled ramp, keep lining up for its window even when skimming off the face
    // (strafing in the air would pull us back to the usual line).
    const liningUp = this.walls.has(hit.sample.piece) && this.lastRamp === hit.sample.piece;
    if (this.airStrafes && !state.surfing && !liningUp) {
      // Off the end of a walled ramp: fly straight through the window first, like a player would,
      // then strafe for the next ramp. (Before the end we're only hopping along the face.)
      const wall = this.walls.get(this.lastRamp);
      const along = wall ? state.pos.clone().sub(wall.pos).dot(forwardOf(wall.heading)) : Infinity;
      if (along > -WALL_GATE_AFTER && along < WALL_PASSED) {
        return { forward: 0, side: 0, jump: false, yaw: Math.atan2(-state.vel.x, -state.vel.z) };
      }
      return this.airStrafe(state, hit.s);
    }
    if (piece?.kind !== 'ramp') return { forward: 0, side: 0, jump: false, yaw };

    // Surf whichever face we're actually on — like a person who lands just
    // past the ridge. `fromRidge` < 0 means the ridge is to our right.
    const fromRidge = hit.lateral - piece.centerOffset;
    const ridgeDir = fromRidge < 0 ? 1 : -1;
    const targetRide = piece.side === 'both' ? BOTH_RIDE_OFFSET : (this.walls.get(hit.sample.piece)?.target ?? piece.ride);
    // How much further from the ridge we are than we want to be.
    const outward = Math.abs(fromRidge) - targetRide;
    const side = outward > -RIDE_TOLERANCE ? ridgeDir : 0;
    return { forward: 0, side, jump: false, yaw };
  }

  /**
   * In the air: swing the velocity toward the riding line ahead. Looking
   * along the velocity and holding A (or D) pushes square to it, so it turns
   * left (right) without braking: up to ~30 u/s of sideways velocity a tick.
   */
  private airStrafe(state: PlayerState, s: number): MoveCmd {
    const speed = Math.hypot(state.vel.x, state.vel.z);
    this.built.path.pointAt(s + Math.max(AIR_LOOKAHEAD_MIN, speed * AIR_LOOKAHEAD_TIME), target);
    const want = Math.atan2(-(target.x - state.pos.x), -(target.z - state.pos.z));
    const have = speed > 1 ? Math.atan2(-state.vel.x, -state.vel.z) : want;
    const turn = wrapPi(want - have);
    const side = Math.abs(turn) < AIR_DEADBAND ? 0 : turn > 0 ? -1 : 1;
    return { forward: 0, side, jump: false, yaw: have };
  }

  /** Grounded and not on any pad: the only floor-like spot on a ramp is its ridge. */
  private onRampRidge(state: PlayerState): boolean {
    for (const p of this.built.pieces) {
      if (p.kind !== 'pad') continue;
      const dx = state.pos.x - p.center.x;
      const dz = state.pos.z - p.center.z;
      const along = -dx * Math.sin(p.heading) - dz * Math.cos(p.heading);
      const lateral = dx * Math.cos(p.heading) - dz * Math.sin(p.heading);
      if (Math.abs(along) <= p.length / 2 + 40 && Math.abs(lateral) <= p.width / 2 + 40 && Math.abs(state.pos.y - p.center.y) < 40) {
        return false;
      }
    }
    return true;
  }
}
