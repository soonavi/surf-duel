/**
 * Run a bot through a course in the real physics, headless. Used by the
 * playability tests, and handy for tuning layouts from the console.
 */
import { BvhWorld } from '../physics/collision';
import { DEFAULT_PHYSICS, TICK_DT, TICK_RATE } from '../physics/constants';
import { createPlayer, stepPlayer } from '../physics/player';
import type { BuiltCourse } from './builder';
import { SurfBot, type BotStyle } from './bot';
import { CourseRuntime } from './runtime';

export interface RunResult {
  finished: boolean;
  /** Seconds from leaving the start zone to the finish (or until giving up). */
  time: number;
  deaths: number;
  /** Checkpoint number where each death happened (0 = before the first). */
  deathsAt: number[];
  maxSpeed: number;
  checkpoints: number;
}

export function simulateRun(built: BuiltCourse, style: BotStyle, maxSeconds = 180): RunResult {
  const world = new BvhWorld(built.collision);
  const runtime = new CourseRuntime(built);
  const bot = new SurfBot(built, style);
  const player = createPlayer(built.spawn.pos);
  bot.resync(player);
  runtime.afterRespawn(player);

  let startTick = -1;
  let maxSpeed = 0;
  const deathsAt: number[] = [];
  const maxTicks = maxSeconds * TICK_RATE;

  for (let tick = 0; tick < maxTicks; tick++) {
    stepPlayer(player, bot.command(player), DEFAULT_PHYSICS, world, TICK_DT);
    maxSpeed = Math.max(maxSpeed, Math.hypot(player.vel.x, player.vel.z));
    for (const e of runtime.update(player)) {
      if (e.type === 'start' && startTick < 0) startTick = tick;
      if (e.type === 'finish') {
        return {
          finished: true,
          time: (tick - Math.max(0, startTick)) / TICK_RATE,
          deaths: deathsAt.length,
          deathsAt,
          maxSpeed,
          checkpoints: runtime.lastCheckpoint,
        };
      }
      if (e.type === 'kill') {
        deathsAt.push(runtime.lastCheckpoint);
        const spawn = runtime.respawnPoint();
        player.pos.copy(spawn.pos);
        player.vel.set(0, 0, 0);
        player.onGround = false;
        runtime.afterRespawn(player);
        bot.resync(player);
      }
    }
  }
  return {
    finished: false,
    time: maxSeconds,
    deaths: deathsAt.length,
    deathsAt,
    maxSpeed,
    checkpoints: runtime.lastCheckpoint,
  };
}
