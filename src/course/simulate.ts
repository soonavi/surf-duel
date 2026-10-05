/**
 * Run a bot through a course in the real physics, headless. Used by the
 * playability tests, and handy for tuning layouts from the console.
 */
import { BvhWorld } from '../physics/collision.js';
import { DEFAULT_PHYSICS, TICK_DT, TICK_RATE } from '../physics/constants.js';
import { createPlayer, stepPlayer, type MoveCmd, type PlayerState } from '../physics/player.js';
import type { BuiltCourse } from './builder.js';
import { SurfBot, type BotStyle } from './bot.js';
import { CourseRuntime, placeAtSpawn, type CourseEvent } from './runtime.js';

export interface RunResult {
  finished: boolean;
  /** Seconds from the start of the run (the go signal) to the finish, or until giving up. */
  time: number;
  deaths: number;
  /** Checkpoint number where each death happened (0 = before the first). */
  deathsAt: number[];
  maxSpeed: number;
  checkpoints: number;
}

export interface RunHooks {
  /** After each tick's movement; `tick` counts from 1 (ticks raced so far). */
  onTick?(player: PlayerState, tick: number, cmd: MoveCmd): void;
  onEvent?(event: CourseEvent, tick: number): void;
}

/**
 * Run `built` with a bot. `fromCheckpoint` starts the run from that
 * checkpoint's respawn (0 = the start line), exactly as pressing R would.
 */
export function simulateRun(
  built: BuiltCourse,
  style: BotStyle,
  maxSeconds = 180,
  fromCheckpoint = 0,
  hooks: RunHooks = {},
): RunResult {
  const world = new BvhWorld(built.collision);
  const runtime = new CourseRuntime(built);
  const bot = new SurfBot(built, style);
  const player = createPlayer();
  runtime.startFrom(fromCheckpoint);
  placeAtSpawn(player, runtime.respawnPoint());
  bot.resync(player);
  runtime.afterRespawn(player);

  let maxSpeed = 0;
  const deathsAt: number[] = [];
  const maxTicks = maxSeconds * TICK_RATE;

  for (let i = 0; i < maxTicks; i++) {
    const tick = i + 1;
    const cmd = bot.command(player);
    stepPlayer(player, cmd, DEFAULT_PHYSICS, world, TICK_DT);
    maxSpeed = Math.max(maxSpeed, Math.hypot(player.vel.x, player.vel.z));
    hooks.onTick?.(player, tick, cmd);
    for (const e of runtime.update(player)) {
      hooks.onEvent?.(e, tick);
      if (e.type === 'finish') {
        return {
          finished: true,
          time: tick / TICK_RATE,
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
