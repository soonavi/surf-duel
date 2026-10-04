/**
 * A simple surf bot: look down the track, hold the key that points into the
 * ramp whenever you've slid below the riding line, let go when you're above
 * it. Used to prove courses are beatable (playability tests) and, later, to
 * drive the menu's attract-mode camera.
 */
import type { BuiltCourse } from './builder';
import type { MoveCmd, PlayerState } from '../physics/player';

export interface BotStyle {
  /** Bunny-hop across pads (keeps speed) instead of walking (cautious). */
  hop: boolean;
}

/** Slack around the riding line before the bot corrects. */
const RIDE_TOLERANCE = 25;
/** On a two-sided ramp the riding line is the ridge; ride this far below it. */
const BOTH_RIDE_OFFSET = 120;
/** Only bunny-hop when already moving faster than this (hopping can't build speed from rest). */
const HOP_MIN_SPEED = 400;

export class SurfBot {
  private hint = 0;

  constructor(
    private readonly built: BuiltCourse,
    private readonly style: BotStyle = { hop: false },
  ) {}

  /** Call after teleporting the player (respawn). */
  resync(state: PlayerState): void {
    this.hint = this.built.path.locate(state.pos, 0).index;
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

    if (piece?.kind !== 'ramp') return { forward: 0, side: 0, jump: false, yaw };

    // +1 when the ridge is to our right.
    const ridgeDir = piece.side === 'right' ? 1 : piece.side === 'left' ? -1 : hit.lateral < 0 ? 1 : -1;
    // How much further from the ridge we are than we want to be.
    const outward = piece.side === 'both' ? Math.abs(hit.lateral) - BOTH_RIDE_OFFSET : -hit.lateral * ridgeDir;
    const side = outward > -RIDE_TOLERANCE ? ridgeDir : 0;
    return { forward: 0, side, jump: false, yaw };
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
