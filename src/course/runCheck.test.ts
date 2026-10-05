import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildCourse, type BuiltCourse } from './builder.js';
import { SHIPPED_COURSES } from './courses/index.js';
import { randomCourse } from './random.js';
import { checkRun, minRunTimeMs, type RunClaim } from './runCheck.js';
import { SurfBot } from './bot.js';
import { CourseRuntime, placeAtSpawn } from './runtime.js';
import { simulateRun } from './simulate.js';
import { BvhWorld } from '../physics/collision.js';
import { DEFAULT_PHYSICS, TICK_DT, TICK_RATE } from '../physics/constants.js';
import { createPlayer, stepPlayer } from '../physics/player.js';
import { GhostRecorder, decodeGhost, encodeGhost, type GhostData, type GhostSample } from '../game/ghost.js';

/**
 * Ride `built` with the bot the way the game records a run: a sample at the
 * go tick, then every 5 ticks; splits at each checkpoint. Optionally press R
 * (back to the last checkpoint) once, `respawnAfterCheckpoint` ticks after
 * reaching checkpoint 1.
 */
function recordRun(built: BuiltCourse, opts: { respawnTicksAfterCheckpoint1?: number } = {}): RunClaim {
  const world = new BvhWorld(built.collision);
  const runtime = new CourseRuntime(built);
  const bot = new SurfBot(built, { hop: true });
  const player = createPlayer();
  runtime.reset();
  placeAtSpawn(player, built.spawn);
  runtime.afterRespawn(player);
  bot.resync(player);
  const recorder = new GhostRecorder();
  recorder.tick(0, player.pos, built.spawn.heading);
  const splits: (number | null)[] = Array.from({ length: built.checkpoints.length - 1 }, () => null);
  let respawnAt = -1;
  for (let tick = 1; tick < 240 * TICK_RATE; tick++) {
    if (tick === respawnAt) {
      placeAtSpawn(player, runtime.respawnPoint());
      runtime.afterRespawn(player);
      bot.resync(player);
    } else {
      stepPlayer(player, bot.command(player), DEFAULT_PHYSICS, world, TICK_DT);
    }
    for (const e of runtime.update(player)) {
      if (e.type === 'checkpoint') {
        splits[e.index - 1] = tick * 10;
        if (e.index === 1 && opts.respawnTicksAfterCheckpoint1 !== undefined) respawnAt = tick + opts.respawnTicksAfterCheckpoint1;
      }
      if (e.type === 'kill') {
        placeAtSpawn(player, runtime.respawnPoint());
        runtime.afterRespawn(player);
        bot.resync(player);
      }
      if (e.type === 'finish') return { timeMs: tick * 10, splits, ghost: recorder.data() };
    }
    recorder.tick(tick, player.pos, 0);
  }
  throw new Error('bot did not finish');
}

const roundTrip = (g: GhostData): GhostData => decodeGhost(encodeGhost(g))!;
const shipped = (id: string): BuiltCourse => buildCourse(SHIPPED_COURSES.find((c) => c.id === id)!.spec);
const cache = new Map<string, RunClaim>();
function botRun(id: string): { built: BuiltCourse; run: RunClaim } {
  const built = shipped(id);
  if (!cache.has(id)) cache.set(id, recordRun(built));
  const run = cache.get(id)!;
  return { built, run: { ...run, splits: [...run.splits], ghost: roundTrip(run.ghost) } };
}

const moved = (samples: GhostSample[], dx: number): GhostSample[] => samples.map((s) => ({ ...s, x: s.x + dx }));

describe('checkRun: real runs pass', () => {
  for (const c of SHIPPED_COURSES) {
    it(`accepts the bot's run on ${c.id}`, () => {
      const { built, run } = botRun(c.id);
      expect(run.splits.every((s) => s !== null)).toBe(true);
      expect(checkRun(built, run)).toBeNull();
    });
  }

  for (const seed of [11, 42]) {
    it(`accepts the bot's run on random course ${seed}`, () => {
      const built = buildCourse(randomCourse(seed));
      const run = recordRun(built);
      expect(checkRun(built, { ...run, ghost: roundTrip(run.ghost) })).toBeNull();
    });
  }

  it('accepts a run with a respawn (R) back to a reached checkpoint', () => {
    const built = shipped('easy-cruise');
    const run = recordRun(built, { respawnTicksAfterCheckpoint1: 150 });
    expect(checkRun(built, { ...run, ghost: roundTrip(run.ghost) })).toBeNull();
  });

  it('agrees with the playability simulation about who finishes how fast', () => {
    const built = shipped('speed-demon');
    const sim = simulateRun(built, { hop: true });
    expect(sim.finished).toBe(true);
    expect(minRunTimeMs(built)).toBeLessThan(sim.time * 1000 * 0.75);
    expect(minRunTimeMs(built)).toBeGreaterThan(1000);
  });
});

describe('checkRun: forged runs fail', () => {
  it('needs one increasing split per checkpoint, all before the finish', () => {
    const { built, run } = botRun('easy-cruise');
    expect(checkRun(built, { ...run, splits: run.splits.slice(1) })).toBe('splits');
    expect(checkRun(built, { ...run, splits: run.splits.map((s, i) => (i === 0 ? null : s)) })).toBe('splits');
    expect(checkRun(built, { ...run, splits: [...run.splits].reverse() })).toBe(run.splits.length > 1 ? 'splits' : null);
    expect(checkRun(built, { ...run, splits: run.splits.map(() => run.timeMs + 10) })).toBe('splits');
  });

  it('refuses a time under the course minimum', () => {
    const { built, run } = botRun('easy-cruise');
    const t = Math.floor(minRunTimeMs(built)) - 10;
    expect(checkRun(built, { ...run, timeMs: t, splits: run.splits.map((_, i) => i + 1) })).toBe('too-fast');
  });

  it('refuses a time shorter (or longer) than its own ghost', () => {
    const { built, run } = botRun('easy-cruise');
    const last = run.splits[run.splits.length - 1]!;
    expect(checkRun(built, { ...run, timeMs: last + 20 })).toBe('ghost-time');
    expect(checkRun(built, { ...run, timeMs: run.timeMs + 5000 })).toBe('ghost-time');
  });

  it('refuses a ghost that does not start at the start', () => {
    const { built, run } = botRun('easy-cruise');
    expect(checkRun(built, { ...run, ghost: { ...run.ghost, samples: moved(run.ghost.samples, 3000) } })).toBe('ghost-start');
  });

  it('refuses a ghost that stops short of the finish', () => {
    const { built, run } = botRun('easy-cruise');
    // Cut the recording one second after the last checkpoint.
    const lastSplit = run.splits[run.splits.length - 1]!;
    const samples = run.ghost.samples.slice(0, Math.round(((lastSplit + 1000) / 1000) * run.ghost.rate) + 1);
    const timeMs = ((samples.length - 1) / run.ghost.rate) * 1000 + 30;
    expect(timeMs).toBeLessThan(run.timeMs - 500);
    expect(checkRun(built, { timeMs, splits: run.splits, ghost: { ...run.ghost, samples } })).toBe('ghost-finish');
  });

  it('refuses a ghost that jumps further than the physics allows', () => {
    const { built, run } = botRun('easy-cruise');
    const samples = run.ghost.samples.map((s, i) => (i === 40 ? { ...s, x: s.x + 1500 } : s));
    expect(checkRun(built, { ...run, ghost: { ...run.ghost, samples } })).toBe('ghost-speed');
  });

  it('refuses a sped-up recording (too fast for the course, or for the physics)', () => {
    const { built, run } = botRun('speed-demon');
    const samples = run.ghost.samples.filter((_, i) => i % 3 === 0);
    const timeMs = ((samples.length - 1) / run.ghost.rate) * 1000 + 30;
    const splits = run.splits.map((s) => (s === null ? null : Math.round(s / 3)));
    expect(['too-fast', 'ghost-speed']).toContain(checkRun(built, { timeMs, splits, ghost: { ...run.ghost, samples } }));
  });

  it('refuses a teleport to a checkpoint the ghost has not reached', () => {
    const { built, run } = botRun('speed-demon');
    const last = built.checkpoints.length - 1;
    // Wait at the start for a believable while, "respawn" at the last checkpoint, then ride on from there.
    const wait = Array.from({ length: 30 * run.ghost.rate }, () => run.ghost.samples[0]!);
    const samples = [...wait, ...simulateFrom(built, last)];
    const timeMs = ((samples.length - 1) / run.ghost.rate) * 1000 + 30;
    const splits = run.splits.map((_, i) => 31_000 + i * 100);
    expect(checkRun(built, { timeMs, splits, ghost: { ...run.ghost, samples } })).toBe('ghost-speed');
  });

  it('refuses splits that do not match where the ghost was at the time', () => {
    const { built, run } = botRun('easy-cruise');
    const shifted = run.splits.map((s) => s! - 1500);
    if (shifted[0]! <= 0) return;
    expect(checkRun(built, { ...run, splits: shifted })).toBe('ghost-checkpoint');
  });

  it('refuses an empty or wrong-rate ghost', () => {
    const { built, run } = botRun('easy-cruise');
    expect(checkRun(built, { ...run, ghost: { rate: 20, samples: [] } })).toBe('ghost-time');
    expect(checkRun(built, { ...run, ghost: { ...run.ghost, rate: 10 } })).toBe('ghost-time');
  });
});

/** Ghost samples of the bot riding on from checkpoint `index`'s respawn. */
function simulateFrom(built: BuiltCourse, index: number): GhostSample[] {
  const recorder = new GhostRecorder();
  const p = built.checkpoints[index]!.pos;
  recorder.tick(0, new Vector3(p.x, p.y, p.z), 0);
  simulateRun(built, { hop: true }, 60, index, { onTick: (player, tick) => recorder.tick(tick, player.pos, 0) });
  return roundTrip(recorder.data()).samples;
}
