/**
 * Is a submitted leaderboard run believable? Pure checks of the claimed
 * time, checkpoint splits and ghost (the 20 Hz recording of the rider's
 * position) against the built course and the physics limits. Shared by the
 * server (which decides) and the tests (which ride real bot runs through it).
 *
 * They can't prove a run was played by hand, but a run only gets on the
 * board if its ghost actually travels the course: it starts on the start
 * pad, never moves faster than the physics allows (each velocity axis is
 * clamped to maxVelocity), only teleports back to checkpoints it has already
 * reached (pressing R, or falling), crosses every checkpoint gate at the
 * moment its split says, and ends at the finish, all in the time claimed.
 * The ghost is public, so anything odd that slips through is visible too.
 */
import { Vector3 } from 'three';
import type { BuiltCourse, Trigger } from './builder';
import { GHOST_RATE, type GhostData, type GhostSample } from '../game/ghost';
import { DEFAULT_PHYSICS, PLAYER_HEIGHT } from '../physics/constants';

export interface RunClaim {
  timeMs: number;
  /** Time at each checkpoint gate, ms; a leaderboard run must pass every one. */
  splits: readonly (number | null)[];
  ghost: GhostData;
}

export type RunProblem =
  | 'splits' // wrong count, missing, out of order, or after the finish
  | 'too-fast' // under the course minimum
  | 'ghost-time' // the recording doesn't last as long as the time claimed
  | 'ghost-start' // doesn't start on the start pad
  | 'ghost-speed' // moves faster than the physics allows, or teleports somewhere it may not
  | 'ghost-checkpoint' // isn't at a gate when its split says it was
  | 'ghost-finish'; // doesn't end at the finish

/** Fastest a rider can move, in u/s: velocity is clamped per axis before each move. */
export const MAX_SPEED = Math.sqrt(3) * DEFAULT_PHYSICS.maxVelocity;
/** Allowance for positions rounded to whole units, collision push-out and the like. */
const SLACK = 40;
/** Furthest a rider can get from a point between two samples. */
const MAX_STEP = MAX_SPEED / GHOST_RATE + SLACK;
/** The first sample is recorded on the spawn point itself. */
const START_RADIUS = 48;
/** How far the claimed time may differ from the recording's length (sampling, rounding). */
const TIME_TOLERANCE_MS = 120;
/** Gate checks look this many samples either side of the claimed split. */
const SPLIT_WINDOW = 1;

const a = new Vector3();
const b = new Vector3();

/** Sample position as the trigger sees it: the rider's centre, not their feet. */
function center(s: GhostSample, out: Vector3): Vector3 {
  return out.set(s.x, s.y + PLAYER_HEIGHT / 2, s.z);
}

/** Point in the trigger's own frame: x lateral, y vertical, z along the track. */
function toLocal(t: Trigger, p: Vector3, out: Vector3): Vector3 {
  const dx = p.x - t.center.x;
  const dz = p.z - t.center.z;
  const s = Math.sin(t.heading);
  const c = Math.cos(t.heading);
  return out.set(dx * c - dz * s, p.y - t.center.y, -dx * s - dz * c);
}

/** Does the segment p→q pass through trigger `t`'s box grown by `margin`? (Slab test.) */
export function segmentHitsTrigger(t: Trigger, p: Vector3, q: Vector3, margin: number): boolean {
  const lp = toLocal(t, p, new Vector3());
  const lq = toLocal(t, q, new Vector3());
  let t0 = 0;
  let t1 = 1;
  const half = [t.half.x + margin, t.half.y + margin, t.half.z + margin];
  const from = [lp.x, lp.y, lp.z];
  const to = [lq.x, lq.y, lq.z];
  for (let axis = 0; axis < 3; axis++) {
    const d = to[axis]! - from[axis]!;
    const h = half[axis]!;
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(from[axis]!) > h) return false;
      continue;
    }
    let enter = (-h - from[axis]!) / d;
    let exit = (h - from[axis]!) / d;
    if (enter > exit) [enter, exit] = [exit, enter];
    t0 = Math.max(t0, enter);
    t1 = Math.min(t1, exit);
    if (t0 > t1) return false;
  }
  return true;
}

function gates(built: BuiltCourse): { checkpoints: Trigger[]; finish: Trigger | null } {
  const checkpoints = built.triggers.filter((t) => t.kind === 'checkpoint').sort((x, y) => x.index - y.index);
  return { checkpoints, finish: built.triggers.find((t) => t.kind === 'finish') ?? null };
}

/**
 * The fastest any run could be: straight lines from the spawn through every
 * gate to the finish (less the gates' own depth), at the top speed.
 */
export function minRunTimeMs(built: BuiltCourse): number {
  const { checkpoints, finish } = gates(built);
  const stops = [...checkpoints, ...(finish ? [finish] : [])];
  let distance = 0;
  let from = built.spawn.pos;
  for (const gate of stops) {
    const horizontal = Math.hypot(gate.center.x - from.x, gate.center.z - from.z);
    distance += Math.max(0, horizontal - Math.max(gate.half.x, gate.half.z));
    from = gate.center;
  }
  return (distance / MAX_SPEED) * 1000;
}

export function checkRun(built: BuiltCourse, run: RunClaim): RunProblem | null {
  const { checkpoints, finish } = gates(built);
  const { timeMs, splits, ghost } = run;

  // Splits: one per gate, all there, increasing, all before the finish.
  if (splits.length !== checkpoints.length) return 'splits';
  let previous = 0;
  for (const s of splits) {
    if (s === null || s <= previous || s >= timeMs) return 'splits';
    previous = s;
  }

  if (timeMs < minRunTimeMs(built)) return 'too-fast';

  // The recording must last as long as the run.
  const samples = ghost.samples;
  if (ghost.rate !== GHOST_RATE || samples.length < 2) return 'ghost-time';
  const recordedMs = ((samples.length - 1) / ghost.rate) * 1000;
  if (Math.abs(timeMs - recordedMs) > TIME_TOLERANCE_MS) return 'ghost-time';

  const first = samples[0]!;
  if (Math.hypot(first.x - built.spawn.pos.x, first.y - built.spawn.pos.y, first.z - built.spawn.pos.z) > START_RADIUS) return 'ghost-start';

  // Walk the recording: every step within reach, or a respawn at a checkpoint already reached.
  let reached = 0;
  const teleports = new Set<number>();
  for (let i = 0; i + 1 < samples.length; i++) {
    const p = samples[i]!;
    const q = samples[i + 1]!;
    const step = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
    if (step > MAX_STEP) {
      const respawn = built.checkpoints.slice(0, reached + 1).some((c) => Math.hypot(q.x - c.pos.x, q.y - c.pos.y, q.z - c.pos.z) <= MAX_STEP);
      if (!respawn) return 'ghost-speed';
      teleports.add(i);
      continue;
    }
    center(p, a);
    center(q, b);
    for (const gate of checkpoints) {
      if (gate.index > reached && segmentHitsTrigger(gate, a, b, SLACK)) reached = gate.index;
    }
  }

  // Each split must be when the ghost was going through that gate.
  for (let k = 0; k < checkpoints.length; k++) {
    const gate = checkpoints[k]!;
    const at = Math.floor((splits[k]! / 1000) * ghost.rate);
    let hit = false;
    for (let i = Math.max(0, at - SPLIT_WINDOW); i <= Math.min(samples.length - 2, at + SPLIT_WINDOW) && !hit; i++) {
      if (teleports.has(i)) continue;
      hit = segmentHitsTrigger(gate, center(samples[i]!, a), center(samples[i + 1]!, b), SLACK);
    }
    if (!hit) return 'ghost-checkpoint';
  }

  // The last sample is taken at most one sample interval before crossing the finish line.
  if (!finish) return 'ghost-finish';
  const last = center(samples[samples.length - 1]!, a);
  if (!segmentHitsTrigger(finish, last, last, MAX_STEP)) return 'ghost-finish';
  return null;
}
