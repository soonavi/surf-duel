/**
 * POST /api/submit-run, minus the HTTP plumbing: check a finished run and
 * put it on the course's leaderboard.
 *
 * The server never trusts the client's idea of the course: it loads the spec
 * itself (shipped id, or share code from the database), builds it, and works
 * out the course key. Then the run must pass checkRun (time, splits and
 * ghost against the course and the physics), the name is cleaned like every
 * player-visible name, and the database keeps the player's best under its
 * rate limits, in one locked step (submit_run).
 */
import { z } from 'zod';
import { buildCourse, type BuiltCourse } from '../src/course/builder';
import { courseKey } from '../src/course/courseKey';
import { findCourse } from '../src/course/courses';
import { checkRun, type RunProblem } from '../src/course/runCheck';
import { normalizeShareCode } from '../src/course/shareCode';
import { decodeGhost } from '../src/game/ghost';
import { sanitizeName } from '../src/net/roomLogic';

/** Submissions per IP (every finished run can post, so this is generous), and for everyone per day. */
export const SUBMIT_LIMITS = { perIpWindow: 30, windowMs: 10 * 60_000, globalPerDay: 20_000 } as const;
/** About an hour of ghost; the database allows the same. */
export const MAX_GHOST_CHARS = 200_000;
/** Shown when a name is empty or not suitable. */
export const DEFAULT_PLAYER_NAME = 'Surfer';

export interface SubmitLimits {
  windowMs: number;
  perIpWindow: number;
  globalPerDay: number;
}

export interface RunRow {
  courseKey: string;
  courseRef: string;
  playerId: string;
  playerName: string;
  timeMs: number;
  splits: number[];
  ghost: string;
  /** Set with assist mode on: shown as a badge on the leaderboard. */
  assist: boolean;
}

export type StoreOutcome =
  | { status: 'ok' | 'kept'; runId: string; place: number; total: number; bestMs: number }
  | { status: 'ip-window' }
  | { status: 'global-day' };

export interface RunStore {
  /** A shared course's spec by share code, or null if there's none. */
  courseSpec(code: string): Promise<unknown | null>;
  /** Check the rate limits and keep the player's best: one atomic step. */
  submit(row: RunRow, ipHash: string, limits: SubmitLimits): Promise<StoreOutcome>;
}

export interface SubmitDeps {
  store: RunStore | null;
  hashIp: (ip: string) => string;
}

export type SubmitFailure = 'bad-request' | 'not-found' | 'implausible' | 'rate-limited' | 'unavailable';

export type SubmitResult =
  | { status: 200; body: { ok: true; improved: boolean; runId: string; place: number; total: number; bestMs: number; name: string } }
  | { status: 400 | 404 | 422 | 429 | 503; body: { ok: false; reason: SubmitFailure; error: string; problem?: RunProblem | 'ghost' } };

const Body = z.object({
  course: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('shipped'), id: z.string().min(1).max(40) }),
    z.object({ kind: z.literal('code'), code: z.string().min(1).max(12) }),
  ]),
  playerId: z.uuid(),
  name: z.string().max(64),
  timeMs: z.number().int().min(1).max(3_600_000),
  splits: z.array(z.number().int().min(0).nullable()).max(64),
  ghost: z.string().min(1).max(MAX_GHOST_CHARS),
  assist: z.boolean().default(false),
});

const LIMITS: SubmitLimits = { windowMs: SUBMIT_LIMITS.windowMs, perIpWindow: SUBMIT_LIMITS.perIpWindow, globalPerDay: SUBMIT_LIMITS.globalPerDay };

type Failure = Extract<SubmitResult, { body: { ok: false } }>;
const fail = (status: Failure['status'], reason: SubmitFailure, error: string, problem?: RunProblem | 'ghost'): SubmitResult => ({
  status,
  body: problem ? { ok: false, reason, error, problem } : { ok: false, reason, error },
});

const UNAVAILABLE = "The leaderboard can't be reached right now. Your time is still saved on this device.";

/** Built courses, kept between requests on a warm server (building takes a few ms). */
const builtCache = new Map<string, BuiltCourse>();
function buildCached(ref: string, spec: unknown): BuiltCourse {
  let built = builtCache.get(ref);
  if (!built) {
    built = buildCourse(spec);
    if (builtCache.size >= 32) builtCache.delete(builtCache.keys().next().value!);
    builtCache.set(ref, built);
  }
  return built;
}

export async function handleSubmitRun(body: unknown, ip: string, deps: SubmitDeps): Promise<SubmitResult> {
  const parsed = Body.safeParse(body);
  if (!parsed.success) return fail(400, 'bad-request', 'That run could not be read.');
  const run = parsed.data;

  let ref: string;
  let spec: unknown;
  if (run.course.kind === 'shipped') {
    ref = `shipped:${run.course.id}`;
    spec = findCourse(run.course.id)?.spec ?? null;
    if (spec === null) return fail(404, 'not-found', 'No such course.');
  } else {
    const code = normalizeShareCode(run.course.code);
    if (!code) return fail(400, 'bad-request', 'That run could not be read.');
    ref = `code:${code}`;
  }

  if (!deps.store) return fail(503, 'unavailable', UNAVAILABLE);
  if (run.course.kind === 'code') {
    try {
      spec = await deps.store.courseSpec(ref.slice('code:'.length));
    } catch {
      return fail(503, 'unavailable', UNAVAILABLE);
    }
    if (spec === null) return fail(404, 'not-found', 'No such course.');
  }

  const built = buildCached(ref, spec);
  const ghost = decodeGhost(run.ghost);
  if (!ghost) return fail(422, 'implausible', "That run didn't check out, so it wasn't posted.", 'ghost');
  const problem = checkRun(built, { timeMs: run.timeMs, splits: run.splits, ghost });
  if (problem) return fail(422, 'implausible', "That run didn't check out, so it wasn't posted.", problem);

  const name = sanitizeName(run.name, DEFAULT_PLAYER_NAME); // at most NAME_MAX characters, like the database
  let outcome: StoreOutcome;
  try {
    outcome = await deps.store.submit(
      {
        courseKey: courseKey(built.course),
        courseRef: ref,
        playerId: run.playerId,
        playerName: name,
        timeMs: run.timeMs,
        splits: run.splits as number[], // checkRun refuses missing splits
        ghost: run.ghost,
        assist: run.assist,
      },
      deps.hashIp(ip),
      LIMITS,
    );
  } catch {
    return fail(503, 'unavailable', UNAVAILABLE);
  }
  if (outcome.status === 'ip-window') return fail(429, 'rate-limited', "You're posting runs very fast! Your time is saved on this device.");
  if (outcome.status === 'global-day') return fail(429, 'rate-limited', 'The leaderboard is very busy today. Your time is saved on this device.');
  return {
    status: 200,
    body: { ok: true, improved: outcome.status === 'ok', runId: outcome.runId, place: outcome.place, total: outcome.total, bestMs: outcome.bestMs, name },
  };
}
