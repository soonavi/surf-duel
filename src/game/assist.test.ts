import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { ASSIST_AIR_ACCEL_SCALE, assistCommand, assistedPhysics } from './assist';
import { buildCourse, type BuiltCourse } from '../course/builder';
import { findCourse } from '../course/courses';
import { SurfBot } from '../course/bot';
import { CourseRuntime, placeAtSpawn } from '../course/runtime';
import { rightOf } from '../course/layout';
import { BvhWorld } from '../physics/collision';
import { DEFAULT_PHYSICS, TICK_DT, TICK_RATE } from '../physics/constants';
import { createPlayer, stepPlayer, type MoveCmd } from '../physics/player';

const cmd = (over: Partial<MoveCmd> = {}): MoveCmd => ({ forward: 0, side: 0, jump: false, yaw: 0, ...over });

describe('assistCommand', () => {
  it('holds the key toward the ramp while surfing, and lets go of W/S', () => {
    const p = createPlayer();
    p.surfing = true;
    const yaw = 0.4;
    // A ramp on your right faces left: its normal points to your left.
    p.surfNormal.copy(rightOf(yaw, new Vector3()).multiplyScalar(-0.8)).setY(0.6);
    expect(assistCommand(cmd({ yaw, forward: 1 }), p)).toEqual(cmd({ yaw, side: 1, forward: 0 }));
    // Even if the wrong key is held.
    expect(assistCommand(cmd({ yaw, side: -1 }), p).side).toBe(1);
    // Ramp on your left.
    p.surfNormal.copy(rightOf(yaw, new Vector3()).multiplyScalar(0.8)).setY(0.6);
    expect(assistCommand(cmd({ yaw }), p).side).toBe(-1);
  });

  it('leaves your keys alone when not surfing', () => {
    const p = createPlayer();
    const c = cmd({ forward: 1, side: -1, jump: true, yaw: 2 });
    expect(assistCommand(c, p)).toEqual(c);
  });
});

describe('assistedPhysics', () => {
  it('only raises air acceleration, and leaves the speed cap alone (so leaderboard checks hold)', () => {
    const p = assistedPhysics(DEFAULT_PHYSICS);
    expect(p.airAccelerate).toBeCloseTo(DEFAULT_PHYSICS.airAccelerate * ASSIST_AIR_ACCEL_SCALE);
    expect(p.maxVelocity).toBe(DEFAULT_PHYSICS.maxVelocity);
    expect({ ...p, airAccelerate: 0 }).toEqual({ ...DEFAULT_PHYSICS, airAccelerate: 0 });
  });
});

/** A rider who only steers with the mouse (the bot's view) and never presses A or D. */
function steerOnly(built: BuiltCourse, assist: boolean): { finished: boolean; deaths: number } {
  const world = new BvhWorld(built.collision);
  const runtime = new CourseRuntime(built);
  const bot = new SurfBot(built, { hop: false });
  const player = createPlayer();
  runtime.reset();
  placeAtSpawn(player, built.spawn);
  runtime.afterRespawn(player);
  bot.resync(player);
  const params = assist ? assistedPhysics(DEFAULT_PHYSICS) : DEFAULT_PHYSICS;
  let deaths = 0;
  for (let tick = 0; tick < 120 * TICK_RATE; tick++) {
    const lazy = { ...bot.command(player), side: 0 };
    stepPlayer(player, assist ? assistCommand(lazy, player) : lazy, params, world, TICK_DT);
    for (const e of runtime.update(player)) {
      if (e.type === 'finish') return { finished: true, deaths };
      if (e.type === 'kill') {
        deaths++;
        if (deaths > 20) return { finished: false, deaths };
        placeAtSpawn(player, runtime.respawnPoint());
        runtime.afterRespawn(player);
        bot.resync(player);
      }
    }
  }
  return { finished: false, deaths };
}

describe('assist mode in the real physics', () => {
  const built = buildCourse(findCourse('easy-cruise')!.spec);

  it('falls off without assist when you never press A or D', () => {
    expect(steerOnly(built, false).deaths).toBeGreaterThan(0);
  });

  it('gets the same rider to the finish with assist on', () => {
    const run = steerOnly(built, true);
    expect(run.finished).toBe(true);
    expect(run.deaths).toBe(0);
  });
});
