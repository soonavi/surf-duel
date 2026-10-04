/**
 * Run a bot through a course in the real physics, headless. Used by the
 * playability tests, and handy for tuning layouts from the console.
 */
import { BvhWorld } from '../physics/collision';
import { DEFAULT_PHYSICS, TICK_DT, TICK_RATE } from '../physics/constants';
import { createPlayer, stepPlayer } from '../physics/player';
import type { BuiltCourse } from './builder';
import { SurfBot, type BotStyle } from './bot';
import { CourseRuntime, placeAtSpawn } from './runtime';

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

/**
 * Run `built` with a bot. `fromCheckpoint` starts the run from that
 * checkpoint's respawn (0 = the start line), exactly as pressing R would.
 */
export function simulateRun(built: BuiltCourse, style: BotStyle, maxSeconds = 180, fromCheckpoint = 0): RunResult {
  const world = new BvhWorld(built.collision);
  const runtime = new CourseRuntime(built);
  const bot = new SurfBot(built, style);
  const player = createPlayer();
  runtime.startFrom(fromCheckpoint);
  placeAtSpawn(player, runtime.respawnPoint());
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
        placeAtSpawn(player, runtime.respawnPoint());
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
