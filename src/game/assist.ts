/**
 * Assist mode, for trackpads and first runs (the player turns it on in
 * Settings; runs set with it get a badge on the leaderboard):
 *  - while surfing, it holds the key toward the ramp for you (even over the
 *    wrong one) and ignores W/S, which only ever slow you down on a ramp;
 *  - in the air you steer a little more strongly.
 * Both are pure: the command filter takes the physics state, the physics
 * takes the adjusted params. The speed cap is untouched, so the leaderboard's
 * run checks hold for assisted runs too.
 */
import { Vector3 } from 'three';
import { rightOf } from '../course/layout.js';
import type { PhysicsParams } from '../physics/constants.js';
import type { MoveCmd, PlayerState } from '../physics/player.js';

export const ASSIST_AIR_ACCEL_SCALE = 1.3;

export function assistedPhysics(base: Readonly<PhysicsParams>): PhysicsParams {
  return { ...base, airAccelerate: base.airAccelerate * ASSIST_AIR_ACCEL_SCALE };
}

const right = new Vector3();

export function assistCommand(cmd: MoveCmd, state: PlayerState): MoveCmd {
  if (!state.surfing) return cmd;
  // The face's normal points away from the ramp: if it points to your left, the ramp is on your right (hold D).
  const n = state.surfNormal;
  const facing = n.x * rightOf(cmd.yaw, right).x + n.z * right.z;
  return { ...cmd, forward: 0, side: facing < 0 ? 1 : -1 };
}
