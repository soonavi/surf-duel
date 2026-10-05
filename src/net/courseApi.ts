/**
 * Client side of AI courses: ask /api/generate-course for a new one, or load
 * a shared one by code from Supabase. Every reply is checked with zod and
 * every course goes back through validateCourse. Failures come back as
 * values with a friendly message; the UI then offers a random course, so the
 * game never dead-ends.
 */
import { z } from 'zod';
import { PROMPT_MAX_CHARS, preparePrompt } from '../course/aiSchema';
import type { Course } from '../course/schema';
import { normalizeShareCode } from '../course/shareCode';
import { validateCourse } from '../course/validator';
import { cleanText, containsBlocked, containsLink } from '../util/text';

export interface GeneratedCourse {
  course: Course;
  /** null when the server couldn't save it (the course is still playable). */
  code: string | null;
  /** The description it was made from, ready to show; null if there's nothing suitable to show. */
  prompt: string | null;
}

export type GenerateFailure = 'bad-request' | 'rejected' | 'rate-limited' | 'budget' | 'timeout' | 'ai-failed' | 'unavailable' | 'network';

export type GenerateOutcome = { ok: true; value: GeneratedCourse } | { ok: false; reason: GenerateFailure; message: string };

export type SharedOutcome = { ok: true; value: GeneratedCourse } | { ok: false; reason: 'invalid-code' | 'not-found' | 'network' };

/** The server stops the AI at 15 s; allow for a cold start and the database on top. */
export const CLIENT_TIMEOUT_MS = 25_000;

const CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const Success = z.object({ ok: z.literal(true), code: z.string().regex(CODE).nullable(), course: z.unknown(), prompt: z.string().max(400) });
const Failure = z.object({ ok: z.literal(false), reason: z.string().max(40), error: z.string().max(300) });

const KNOWN: readonly GenerateFailure[] = ['bad-request', 'rejected', 'rate-limited', 'budget', 'timeout', 'ai-failed', 'unavailable', 'network'];

const DEFAULT_MESSAGE: Record<GenerateFailure, string> = {
  'bad-request': 'Try describing the course a different way.',
  rejected: "Let's keep it friendly: describe a course instead.",
  'rate-limited': "You're generating courses fast! Give it a few minutes.",
  budget: "Today's AI course budget is used up. Race a random course instead!",
  timeout: 'The course designer took too long.',
  'ai-failed': "The course designer couldn't make that one.",
  unavailable: "AI course generation isn't available right now.",
  network: "Couldn't reach the course designer. Check your connection.",
};

const failure = (reason: GenerateFailure, message = DEFAULT_MESSAGE[reason]): GenerateOutcome => ({ ok: false, reason, message });

/**
 * A saved prompt, ready to show other players: cleaned, and hidden entirely
 * if it holds a link or a blocked word. The server already refuses those;
 * this is defence in depth for anything read back from the database.
 */
export function displayPrompt(raw: string): string | null {
  const text = cleanText(raw, PROMPT_MAX_CHARS);
  return text.length > 0 && !containsLink(text) && !containsBlocked(text) ? text : null;
}

export async function requestCourse(rawPrompt: string, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<GenerateOutcome> {
  // Same check the server makes, for instant feedback (the server's is the one that counts).
  const checked = preparePrompt(rawPrompt);
  if (!checked.ok) return failure(checked.reason === 'link' || checked.reason === 'blocked' ? 'rejected' : 'bad-request', checked.message);
  const prompt = checked.prompt;
  const doFetch = opts.fetch ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? CLIENT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch('/api/generate-course', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });
  } catch {
    return timedOut ? failure('timeout') : failure('network');
  } finally {
    clearTimeout(timer);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return failure(response.status === 404 ? 'unavailable' : 'ai-failed');
  }
  const ok = Success.safeParse(body);
  if (ok.success) {
    return { ok: true, value: { course: validateCourse(ok.data.course).course, code: ok.data.code, prompt: displayPrompt(ok.data.prompt) } };
  }
  const bad = Failure.safeParse(body);
  if (bad.success) {
    const reason = (KNOWN as readonly string[]).includes(bad.data.reason) ? (bad.data.reason as GenerateFailure) : 'ai-failed';
    return failure(reason, bad.data.error || DEFAULT_MESSAGE[reason]);
  }
  return failure('ai-failed');
}

/** One row lookup by code; returns Supabase's `{ data, error }` shape. Injectable for tests. */
export type CourseQuery = (code: string) => Promise<{ data: unknown; error: { message: string } | null }>;

const Row = z.object({ code: z.string(), prompt: z.string(), spec: z.unknown() });

const supabaseQuery: CourseQuery = async (code) => {
  const { supabaseClient } = await import('./supabase'); // keeps supabase-js out of the main bundle
  const { data, error } = await supabaseClient().from('courses').select('code, prompt, spec').eq('code', code).maybeSingle();
  return { data, error };
};

/** Load a shared course by code (or share link). */
export async function fetchSharedCourse(input: string, query: CourseQuery = supabaseQuery): Promise<SharedOutcome> {
  const code = normalizeShareCode(input);
  if (!code) return { ok: false, reason: 'invalid-code' };
  let result: Awaited<ReturnType<CourseQuery>>;
  try {
    result = await query(code);
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (result.error) return { ok: false, reason: 'network' };
  if (result.data === null) return { ok: false, reason: 'not-found' };
  const row = Row.safeParse(result.data);
  if (!row.success) return { ok: false, reason: 'not-found' };
  return { ok: true, value: { course: validateCourse(row.data.spec).course, code, prompt: displayPrompt(row.data.prompt) } };
}
