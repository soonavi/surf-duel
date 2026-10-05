/**
 * POST /api/generate-course, minus the HTTP plumbing: validate the prompt,
 * claim a slot under the rate limits and spending caps, ask the AI for a
 * course (with a hard timeout), repair it with the same validator the game
 * uses, and save it under a share code.
 *
 * Everything with side effects (the AI, the database) is passed in, so every
 * failure path is unit-tested. The game never dead-ends on a failure here:
 * the client offers a random course instead.
 */
import { z } from 'zod';
import { PROMPT_MAX_CHARS } from '../src/course/aiSchema';
import { generateShareCode } from '../src/course/shareCode';
import type { Course } from '../src/course/schema';
import { validateCourse } from '../src/course/validator';
import { cleanText } from '../src/util/text';

export const GENERATE_TIMEOUT_MS = 15_000;

/** Generations per IP: a burst limit and a daily cap. Failed attempts count too (they still cost an AI call). */
export const RATE_LIMIT = { perWindow: 6, windowMs: 10 * 60_000, perDay: 40 } as const;

/**
 * Spending caps for everyone together, so the game can never spend more than
 * the owner's $5 of prepaid OpenAI credit:
 *  - each call is capped at `maxOutputTokens` (the reply is ~400–800 tokens;
 *    input is the fixed prompt + schema + a ≤200-char description, under
 *    `maxInputTokens`), so one call costs at most ~$0.0024 at gpt-5.4-nano
 *    prices ($0.20 / $1.25 per million tokens in / out, Oct 2026);
 *  - `perDay` generations a day across all players;
 *  - `lifetime` generations ever: 1,800 × $0.0024 ≈ $4.30 worst case.
 * The database enforces all of these in one locked step (claim_generation),
 * and if it can't be reached we don't call the AI at all.
 * The caps assume a nano-priced model: re-check them before switching models.
 */
export const BUDGET = { perDay: 150, lifetime: 1800, maxOutputTokens: 1500, maxInputTokens: 2500 } as const;

export interface CourseRow {
  code: string;
  prompt: string;
  spec: Course;
}

export interface ClaimLimits {
  windowMs: number;
  perIpPerWindow: number;
  perIpPerDay: number;
  globalPerDay: number;
  lifetime: number;
}

/** 'ok' means a generation was counted and may go ahead. */
export type ClaimResult = 'ok' | 'ip-window' | 'ip-day' | 'global-day' | 'lifetime';

export interface CourseStore {
  /** Check every limit and, if all pass, count this generation: one atomic step. */
  claim(ipHash: string, limits: ClaimLimits): Promise<ClaimResult>;
  insertCourse(row: CourseRow): Promise<'ok' | 'duplicate'>;
}

/** Asks the AI for a course; returns its raw (unvalidated) JSON. Must stop when `signal` aborts. */
export type CourseDesigner = (prompt: string, signal: AbortSignal) => Promise<unknown>;

export interface GenerateDeps {
  design: CourseDesigner;
  /** Without a database the caps can't be checked, so generation is refused. */
  store: CourseStore | null;
  hashIp: (ip: string) => string;
  random: () => number;
  timeoutMs?: number;
}

export type FailureReason = 'bad-request' | 'rate-limited' | 'budget' | 'unavailable' | 'timeout' | 'ai-failed';

export type GenerateResult =
  | { status: 200; body: { ok: true; code: string | null; course: Course; prompt: string; repairs: number } }
  | { status: 400 | 429 | 502 | 503 | 504; body: { ok: false; reason: FailureReason; error: string } };

const Request = z.object({ prompt: z.string() });
const CODE_ATTEMPTS = 5;

const LIMITS: ClaimLimits = {
  windowMs: RATE_LIMIT.windowMs,
  perIpPerWindow: RATE_LIMIT.perWindow,
  perIpPerDay: RATE_LIMIT.perDay,
  globalPerDay: BUDGET.perDay,
  lifetime: BUDGET.lifetime,
};

const fail = (status: 400 | 429 | 502 | 503 | 504, reason: FailureReason, error: string): GenerateResult => ({
  status,
  body: { ok: false, reason, error },
});

const UNAVAILABLE = 'AI course generation is resting right now. Race a random course instead!';

const REFUSED: Record<Exclude<ClaimResult, 'ok'>, GenerateResult> = {
  'ip-window': fail(429, 'rate-limited', "You're generating courses fast! Give it a few minutes, or race a random course meanwhile."),
  'ip-day': fail(429, 'rate-limited', "That's a lot of courses for one day! Race some of them, or try a random course."),
  'global-day': fail(429, 'budget', "Today's AI course budget is used up. Race a random course, or come back tomorrow!"),
  lifetime: fail(429, 'budget', "This game's AI course budget is used up. Race a random course instead!"),
};

export async function handleGenerate(body: unknown, ip: string, deps: GenerateDeps): Promise<GenerateResult> {
  const parsed = Request.safeParse(body);
  if (!parsed.success) return fail(400, 'bad-request', 'Type a description of the course you want.');
  const raw = parsed.data.prompt.trim();
  if (raw.length === 0) return fail(400, 'bad-request', 'Type a description of the course you want.');
  if (Array.from(raw).length > PROMPT_MAX_CHARS) return fail(400, 'bad-request', `Keep it under ${PROMPT_MAX_CHARS} characters.`);
  const prompt = cleanText(raw, PROMPT_MAX_CHARS);

  // Claim a slot before spending anything. If the caps can't be checked, don't spend at all.
  if (!deps.store) return fail(503, 'unavailable', UNAVAILABLE);
  let claim: ClaimResult;
  try {
    claim = await deps.store.claim(deps.hashIp(ip), LIMITS);
  } catch {
    return fail(503, 'unavailable', UNAVAILABLE);
  }
  if (claim !== 'ok') return REFUSED[claim];

  // Ask the AI, giving up at the timeout.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deps.timeoutMs ?? GENERATE_TIMEOUT_MS);
  let output: unknown;
  try {
    output = await deps.design(prompt, controller.signal);
  } catch {
    return timedOut
      ? fail(504, 'timeout', 'The course designer took too long.')
      : fail(502, 'ai-failed', "The course designer couldn't make that one.");
  } finally {
    clearTimeout(timer);
  }
  if (timedOut) return fail(504, 'timeout', 'The course designer took too long.');
  if (typeof output !== 'object' || output === null || !Array.isArray((output as { segments?: unknown }).segments)) {
    return fail(502, 'ai-failed', "The course designer couldn't make that one.");
  }

  const { course, repairs } = validateCourse(output);

  // Save it under a fresh share code. If saving fails, the player still gets to race it.
  let code: string | null = null;
  try {
    for (let i = 0; i < CODE_ATTEMPTS && code === null; i++) {
      const candidate = generateShareCode(deps.random);
      if ((await deps.store.insertCourse({ code: candidate, prompt, spec: course })) === 'ok') code = candidate;
    }
  } catch {
    code = null;
  }

  return { status: 200, body: { ok: true, code, course, prompt, repairs: repairs.length } };
}
