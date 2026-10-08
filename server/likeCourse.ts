/**
 * POST /api/like-course, minus the HTTP plumbing: a thumbs up (or taking it
 * back) on a shared course.
 *
 * One like per player (Profile.boardId) per course. Player ids are made by
 * the browser, so they're cheap to fake: the database also lets only a few
 * players on one network (hashed IP) like the same course, and rate-limits
 * each network. Counting happens in one locked step (like_course), which
 * keeps courses.likes, the number the Popular list sorts by, exact.
 */
import { z } from 'zod';
import { normalizeShareCode } from '../src/course/shareCode.js';

/** Likes per network in a short window, how many players on one network may like one course, and everyone per day. */
export const LIKE_LIMITS = { perIpWindow: 40, windowMs: 10 * 60_000, perIpCourse: 3, globalPerDay: 20_000 } as const;

export interface LikeLimits {
  windowMs: number;
  perIpWindow: number;
  perIpCourse: number;
  globalPerDay: number;
}

export type LikeOutcome =
  | { status: 'ok'; liked: boolean; likes: number }
  | { status: 'not-found' }
  | { status: 'ip-window' }
  | { status: 'global-day' }
  | { status: 'ip-course'; likes: number };

export interface LikeStore {
  /** Check the limits and set this player's like: one atomic step. */
  like(code: string, playerId: string, like: boolean, ipHash: string, limits: LikeLimits): Promise<LikeOutcome>;
}

export interface LikeDeps {
  store: LikeStore | null;
  hashIp: (ip: string) => string;
}

export type LikeFailure = 'bad-request' | 'not-found' | 'rate-limited' | 'unavailable';

export type LikeResult =
  | { status: 200; body: { ok: true; liked: boolean; likes: number } }
  | { status: 400 | 404 | 429 | 503; body: { ok: false; reason: LikeFailure; error: string } };

const Body = z.object({ code: z.string().min(1).max(12), playerId: z.uuid(), like: z.boolean() });

const LIMITS: LikeLimits = { ...LIKE_LIMITS };

const fail = (status: 400 | 404 | 429 | 503, reason: LikeFailure, error: string): LikeResult => ({ status, body: { ok: false, reason, error } });

export async function handleLike(body: unknown, ip: string, deps: LikeDeps): Promise<LikeResult> {
  const parsed = Body.safeParse(body);
  const code = parsed.success ? normalizeShareCode(parsed.data.code) : null;
  if (!parsed.success || !code) return fail(400, 'bad-request', 'That like could not be read.');
  if (!deps.store) return fail(503, 'unavailable', "Likes can't be reached right now.");

  let outcome: LikeOutcome;
  try {
    outcome = await deps.store.like(code, parsed.data.playerId, parsed.data.like, deps.hashIp(ip), LIMITS);
  } catch {
    return fail(503, 'unavailable', "Likes can't be reached right now.");
  }
  switch (outcome.status) {
    case 'ok':
      return { status: 200, body: { ok: true, liked: outcome.liked, likes: outcome.likes } };
    case 'not-found':
      return fail(404, 'not-found', 'No course has that code.');
    case 'ip-course':
      return fail(429, 'rate-limited', 'A few people on your network already liked this course.');
    case 'ip-window':
      return fail(429, 'rate-limited', "You're liking courses very fast! Give it a few minutes.");
    case 'global-day':
      return fail(429, 'rate-limited', 'Likes are very busy today. Try again tomorrow!');
  }
}
