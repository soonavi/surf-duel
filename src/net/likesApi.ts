/**
 * Client side of likes: post a thumbs up (or take it back) to
 * /api/like-course, read the Popular list straight from Supabase (public,
 * read-only), and remember on this device which courses you liked.
 * Everything read is checked with zod, every course goes back through
 * validateCourse, prompts go through displayPrompt, and failures come back
 * as values: the game works without likes.
 */
import { z } from 'zod';
import type { Course } from '../course/schema.js';
import { validateCourse } from '../course/validator.js';
import { browserStorage, type KeyValueStorage } from '../game/records.js';
import { displayPrompt } from './courseApi.js';

export type LikeOutcome = { ok: true; liked: boolean; likes: number } | { ok: false; message: string };

export const LIKE_TIMEOUT_MS = 8_000;

const Liked = z.object({ ok: z.literal(true), liked: z.boolean(), likes: z.number().int().min(0) });
const Refused = z.object({ ok: z.literal(false), error: z.string().max(300) });

export async function sendLike(
  code: string,
  playerId: string,
  like: boolean,
  opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<LikeOutcome> {
  const doFetch = opts.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? LIKE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch('/api/like-course', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, playerId, like }),
      signal: controller.signal,
    });
  } catch {
    return { ok: false, message: "Couldn't reach the server. Check your connection." };
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const liked = Liked.safeParse(body);
  if (liked.success) return { ok: true, liked: liked.data.liked, likes: liked.data.likes };
  const refused = Refused.safeParse(body);
  return { ok: false, message: refused.success ? refused.data.error : "Likes aren't available right now." };
}

// --- the Popular list ---------------------------------------------------------

export interface PopularCourse {
  code: string;
  course: Course;
  /** The description it was made from, ready to show; null if there's nothing suitable to show. */
  prompt: string | null;
  likes: number;
}

export type PopularOutcome = { ok: true; courses: PopularCourse[] } | { ok: false };

/** The most liked courses (newest first among equals); returns Supabase's `{ data, error }` shape. Injectable for tests. */
export type PopularQuery = (limit: number) => Promise<{ data: unknown; error: { message: string } | null }>;

export const POPULAR_SIZE = 6;

const supabasePopularQuery: PopularQuery = async (limit) => {
  const { supabaseClient } = await import('./supabase.js'); // keeps supabase-js out of the main bundle
  const { data, error } = await supabaseClient()
    .from('courses')
    .select('code, prompt, likes, spec')
    .order('likes', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  return { data, error };
};

const Row = z.object({ code: z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/), prompt: z.string(), likes: z.number().int().min(0), spec: z.unknown() });

export async function fetchPopular(limit = POPULAR_SIZE, query: PopularQuery = supabasePopularQuery): Promise<PopularOutcome> {
  let result: Awaited<ReturnType<PopularQuery>>;
  try {
    result = await query(limit);
  } catch {
    return { ok: false };
  }
  if (result.error || !Array.isArray(result.data)) return { ok: false };
  const courses: PopularCourse[] = [];
  for (const raw of result.data) {
    const row = Row.safeParse(raw);
    if (!row.success) continue;
    courses.push({ code: row.data.code, course: validateCourse(row.data.spec).course, prompt: displayPrompt(row.data.prompt), likes: row.data.likes });
  }
  return { ok: true, courses };
}

// --- what you liked, on this device -------------------------------------------

const LIKES_KEY = 'surfduel.likes.v1';
const MAX_REMEMBERED = 500;
const Stored = z.array(z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/)).max(MAX_REMEMBERED * 2);

/**
 * Share codes you've liked, so the button shows it next visit. Only a
 * convenience: the server keeps the real count and ignores a second like.
 */
export class LikedCourses {
  private readonly codes: Set<string>;

  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {
    let stored: string[] = [];
    try {
      const parsed = Stored.safeParse(JSON.parse(storage?.getItem(LIKES_KEY) ?? '[]'));
      if (parsed.success) stored = parsed.data;
    } catch {
      // Unreadable storage: start empty.
    }
    this.codes = new Set(stored);
  }

  has(code: string): boolean {
    return this.codes.has(code);
  }

  set(code: string, liked: boolean): void {
    if (liked) this.codes.add(code);
    else this.codes.delete(code);
    const list = [...this.codes].slice(-MAX_REMEMBERED);
    try {
      this.storage?.setItem(LIKES_KEY, JSON.stringify(list));
    } catch {
      // Not persisted; it still holds for this visit.
    }
  }
}
