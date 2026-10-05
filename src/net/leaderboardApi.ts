/**
 * Client side of the leaderboards: read the top runs for a course straight
 * from Supabase (public, read-only), fetch one run's ghost to race it, and
 * post a finished run to /api/submit-run (the server checks it and decides).
 * Everything read is checked with zod, names are cleaned again before they're
 * shown, and failures come back as values: the game works without a board.
 */
import { z } from 'zod';
import { decodeGhost, type GhostData } from '../game/ghost';
import { sanitizeName } from './roomLogic';

/** How the server finds a course: shipped courses by id, AI/shared ones by share code. Random courses have no board. */
export type BoardRef = { kind: 'shipped'; id: string } | { kind: 'code'; code: string };

export interface BoardEntry {
  id: string;
  name: string;
  timeMs: number;
}

export type BoardOutcome = { ok: true; entries: BoardEntry[] } | { ok: false };

/** Rows of the board in order; returns Supabase's `{ data, error }` shape. Injectable for tests. */
export type BoardQuery = (courseKey: string, limit: number) => Promise<{ data: unknown; error: { message: string } | null }>;
/** One run's ghost and splits. */
export type GhostQuery = (runId: string) => Promise<{ data: unknown; error: { message: string } | null }>;

export const BOARD_SIZE = 10;
/** Shown when a stored name isn't suitable (the server cleans names too). */
const FALLBACK_NAME = 'Surfer';

async function client() {
  const { supabaseClient } = await import('./supabase'); // keeps supabase-js out of the main bundle
  return supabaseClient();
}

const supabaseBoardQuery: BoardQuery = async (courseKey, limit) => {
  const { data, error } = await (await client())
    .from('runs')
    .select('id, player_name, time_ms')
    .eq('course_key', courseKey)
    .order('time_ms', { ascending: true })
    .order('updated_at', { ascending: true })
    .limit(limit);
  return { data, error };
};

const supabaseGhostQuery: GhostQuery = async (runId) => {
  const { data, error } = await (await client()).from('runs').select('ghost, checkpoint_splits').eq('id', runId).maybeSingle();
  return { data, error };
};

const Entry = z.object({ id: z.string().min(1).max(64), player_name: z.string(), time_ms: z.number().int().positive() });

export async function fetchLeaderboard(courseKey: string, limit = BOARD_SIZE, query: BoardQuery = supabaseBoardQuery): Promise<BoardOutcome> {
  let result: Awaited<ReturnType<BoardQuery>>;
  try {
    result = await query(courseKey, limit);
  } catch {
    return { ok: false };
  }
  if (result.error || !Array.isArray(result.data)) return { ok: false };
  const entries: BoardEntry[] = [];
  for (const raw of result.data) {
    const row = Entry.safeParse(raw);
    if (row.success) entries.push({ id: row.data.id, name: sanitizeName(row.data.player_name, FALLBACK_NAME), timeMs: row.data.time_ms });
  }
  return { ok: true, entries };
}

const GhostRow = z.object({ ghost: z.string().max(200_000), checkpoint_splits: z.array(z.number().int()).max(64) });

/** A leaderboard run's ghost, or null if it can't be had. */
export async function fetchRunGhost(runId: string, query: GhostQuery = supabaseGhostQuery): Promise<{ ghost: GhostData; splits: number[] } | null> {
  let result: Awaited<ReturnType<GhostQuery>>;
  try {
    result = await query(runId);
  } catch {
    return null;
  }
  if (result.error) return null;
  const row = GhostRow.safeParse(result.data);
  if (!row.success) return null;
  const ghost = decodeGhost(row.data.ghost);
  return ghost && ghost.samples.length > 1 ? { ghost, splits: row.data.checkpoint_splits } : null;
}

// --- posting runs ------------------------------------------------------------------

export interface SubmitPayload {
  course: BoardRef;
  /** This browser's leaderboard id (Profile.boardId). */
  playerId: string;
  name: string;
  timeMs: number;
  splits: (number | null)[];
  /** Encoded ghost (ghost.ts). */
  ghost: string;
}

export type SubmitOutcome =
  | { ok: true; improved: boolean; runId: string; place: number; total: number; bestMs: number; name: string }
  | { ok: false; reason: string; message: string };

export const SUBMIT_TIMEOUT_MS = 12_000;

const Accepted = z.object({
  ok: z.literal(true),
  improved: z.boolean(),
  runId: z.string().max(64),
  place: z.number().int().positive(),
  total: z.number().int().positive(),
  bestMs: z.number().int().positive(),
  name: z.string().max(64),
});
const Refused = z.object({ ok: z.literal(false), reason: z.string().max(40), error: z.string().max(300) });

export async function submitRun(payload: SubmitPayload, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<SubmitOutcome> {
  const doFetch = opts.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? SUBMIT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch('/api/submit-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    return { ok: false, reason: 'network', message: "Couldn't reach the leaderboard. Your time is saved on this device." };
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const accepted = Accepted.safeParse(body);
  if (accepted.success) {
    const { ok: _ok, ...rest } = accepted.data;
    return { ok: true, ...rest, name: sanitizeName(rest.name, FALLBACK_NAME) };
  }
  const refused = Refused.safeParse(body);
  if (refused.success) return { ok: false, reason: refused.data.reason, message: refused.data.error };
  return { ok: false, reason: 'unavailable', message: "The leaderboard isn't available right now. Your time is saved on this device." };
}
