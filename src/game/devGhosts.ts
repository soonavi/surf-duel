/**
 * "Someone to race" for a solo player. Each shipped course can have a dev
 * ghost recorded by a human (src/course/ghosts/<id>.json, saved from the
 * results screen in dev builds). Until one exists — or if it was recorded on
 * an older layout of the course — a ghost is recorded live by the cautious
 * bot, so it always matches the current geometry.
 */
import type { BuiltCourse } from '../course/builder';
import { simulateRun } from '../course/simulate';
import { GhostRecorder, decodeGhost, type GhostData } from './ghost';
import { DevGhostFile } from './devGhostFile';

export interface GhostRun {
  /** Short tag shown over the ghost and on the progress bar. */
  label: string;
  timeMs: number;
  splits: (number | null)[];
  ghost: GhostData;
}

/** Validate a dev ghost file and check it was recorded on this exact course. */
export function parseDevGhostFile(raw: unknown, key: string): GhostRun | null {
  const parsed = DevGhostFile.safeParse(raw);
  if (!parsed.success || parsed.data.courseKey !== key) return null;
  const ghost = decodeGhost(parsed.data.ghost);
  if (!ghost || ghost.samples.length === 0) return null;
  return { label: 'DEV', timeMs: parsed.data.timeMs, splits: parsed.data.splits, ghost };
}

/** Recorded human dev ghosts shipped with the game, keyed by course id. */
const SHIPPED_FILES = import.meta.glob<unknown>('../course/ghosts/*.json', { eager: true, import: 'default' });

export function shippedDevGhost(courseId: string, key: string): GhostRun | null {
  const file = SHIPPED_FILES[`../course/ghosts/${courseId}.json`];
  return file === undefined ? null : parseDevGhostFile(file, key);
}

/** Record the cautious bot riding the course (≈0.1–0.3 s of simulation). */
export function recordBotGhost(built: BuiltCourse): GhostRun | null {
  const recorder = new GhostRecorder();
  recorder.tick(0, built.spawn.pos, built.spawn.heading);
  const splits: (number | null)[] = Array.from({ length: built.checkpoints.length - 1 }, () => null);
  const result = simulateRun(built, { hop: false }, 300, 0, {
    onTick: (player, tick, cmd) => recorder.tick(tick, player.pos, cmd.yaw),
    onEvent: (event, tick) => {
      if (event.type === 'checkpoint' && splits[event.index - 1] === null) splits[event.index - 1] = tick * 10;
    },
  });
  if (!result.finished) return null;
  return { label: 'BOT', timeMs: Math.round(result.time * 1000), splits, ghost: recorder.data() };
}
