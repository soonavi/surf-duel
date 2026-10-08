/**
 * POST /api/generate-course, minus the HTTP plumbing: check and clean the
 * prompt, claim a slot under the rate limits and spending caps, run the
 * (free) moderation check on it, ask the AI for a course (with a hard
 * timeout), repair it with the same validator the game uses, check its name,
 * and save it under a share code.
 *
 * Defences against malicious prompts, in order:
 *  1. preparePrompt: hidden/invisible text stripped, markup characters
 *     dropped, links and blocked words refused (before anything is spent);
 *  2. the moderation check refuses hateful, sexual, self-harm, graphic or
 *     illicit descriptions before the course model sees them (fails closed);
 *  3. the prompt goes to the model as a JSON string, labelled as a
 *     description and never instructions, and the reply is forced into the
 *     course schema (Structured Outputs), so the worst a prompt injection
 *     can do is shape a course;
 *  4. every number is clamped by validateCourse, and the one free-text field
 *     (the name) is cleaned, link/word-checked and moderated too.
 *
 * Then the course is ridden by the game's bots before it's saved
 * (ensureBeatable), and simplified until they can finish it: the model can
 * combine walls, spirals and extreme values in ways the layout alone can't
 * guarantee.
 *
 * Everything with side effects (the AI, the database) is passed in, so every
 * failure path is unit-tested. The game never dead-ends on a failure here:
 * the client offers a random course instead.
 */
import { z } from 'zod';
import { preparePrompt } from '../src/course/aiSchema.js';
import { generateShareCode } from '../src/course/shareCode.js';
import { DIFFICULTIES, type Course, type Difficulty } from '../src/course/schema.js';
import { DEFAULT_NAME, validateCourse } from '../src/course/validator.js';
import type { Moderator } from './openaiModerator.js';

export const GENERATE_TIMEOUT_MS = 15_000;
/** Each moderation check usually takes well under a second. */
export const MODERATION_TIMEOUT_MS = 5_000;

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

/** Asks the AI for a course at a difficulty; returns its raw (unvalidated) JSON. Must stop when `signal` aborts. */
export type CourseDesigner = (prompt: string, difficulty: Difficulty, signal: AbortSignal) => Promise<unknown>;

export interface GenerateDeps {
  design: CourseDesigner;
  /** Flags texts other players shouldn't see. Required: without it we don't generate. */
  moderate: Moderator;
  /** Without a database the caps can't be checked, so generation is refused. */
  store: CourseStore | null;
  hashIp: (ip: string) => string;
  random: () => number;
  /** Rides the course and simplifies it until its bots can finish (src/course/verify.ts); injected so tests stay fast. */
  ensure: (course: Course) => { course: Course; changes: string[]; beatable: boolean };
  timeoutMs?: number;
  moderationTimeoutMs?: number;
}

export type FailureReason = 'bad-request' | 'rejected' | 'rate-limited' | 'budget' | 'unavailable' | 'timeout' | 'ai-failed';

type FailureStatus = 400 | 422 | 429 | 502 | 503 | 504;

export type GenerateResult =
  | { status: 200; body: { ok: true; code: string | null; course: Course; prompt: string; repairs: number } }
  | { status: FailureStatus; body: { ok: false; reason: FailureReason; error: string } };

/** The player picks the difficulty; clients from before the picker send none and get medium. */
const Request = z.object({ prompt: z.string(), difficulty: z.enum(DIFFICULTIES).default('medium') });
const CODE_ATTEMPTS = 5;

const LIMITS: ClaimLimits = {
  windowMs: RATE_LIMIT.windowMs,
  perIpPerWindow: RATE_LIMIT.perWindow,
  perIpPerDay: RATE_LIMIT.perDay,
  globalPerDay: BUDGET.perDay,
  lifetime: BUDGET.lifetime,
};

const fail = (status: FailureStatus, reason: FailureReason, error: string): GenerateResult => ({
  status,
  body: { ok: false, reason, error },
});

const UNAVAILABLE = 'AI course generation is resting right now. Race a random course instead!';
const REJECTED = "Let's keep it friendly: describe a course instead.";

/** Run `fn` with an abort signal that fires after `ms`; rejects at the deadline even if `fn` ignores it. */
async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timed out'));
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const REFUSED: Record<Exclude<ClaimResult, 'ok'>, GenerateResult> = {
  'ip-window': fail(429, 'rate-limited', "You're generating courses fast! Give it a few minutes, or race a random course meanwhile."),
  'ip-day': fail(429, 'rate-limited', "That's a lot of courses for one day! Race some of them, or try a random course."),
  'global-day': fail(429, 'budget', "Today's AI course budget is used up. Race a random course, or come back tomorrow!"),
  lifetime: fail(429, 'budget', "This game's AI course budget is used up. Race a random course instead!"),
};

export async function handleGenerate(body: unknown, ip: string, deps: GenerateDeps): Promise<GenerateResult> {
  const parsed = Request.safeParse(body);
  if (!parsed.success) return fail(400, 'bad-request', 'Type a description of the course you want.');
  // Clean it and refuse links and blocked words before anything is spent.
  const checked = preparePrompt(parsed.data.prompt);
  if (!checked.ok) {
    return checked.reason === 'link' || checked.reason === 'blocked' ? fail(422, 'rejected', checked.message) : fail(400, 'bad-request', checked.message);
  }
  const prompt = checked.prompt;
  const difficulty = parsed.data.difficulty;

  // Claim a slot before spending anything. If the caps can't be checked, don't spend at all.
  if (!deps.store) return fail(503, 'unavailable', UNAVAILABLE);
  let claim: ClaimResult;
  try {
    claim = await deps.store.claim(deps.hashIp(ip), LIMITS);
  } catch {
    return fail(503, 'unavailable', UNAVAILABLE);
  }
  if (claim !== 'ok') return REFUSED[claim];

  // The moderation check sees the prompt before the course designer does. If it can't run, don't go on.
  const moderationMs = deps.moderationTimeoutMs ?? MODERATION_TIMEOUT_MS;
  let flagged: boolean[];
  try {
    flagged = await withTimeout((signal) => deps.moderate([prompt], signal), moderationMs);
  } catch {
    return fail(503, 'unavailable', UNAVAILABLE);
  }
  if (flagged[0] !== false) return fail(422, 'rejected', REJECTED);

  // Ask the AI, giving up at the timeout.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deps.timeoutMs ?? GENERATE_TIMEOUT_MS);
  let output: unknown;
  try {
    output = await deps.design(prompt, difficulty, controller.signal);
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

  // The player's pick, whatever the model wrote: the layout's sideways transfers and checkpoint spacing come from it.
  const validated = validateCourse({ ...output, difficulty });
  const repairs = validated.repairs;
  let course = validated.course;

  // The name is the one free-text field in the reply: check it like the prompt (the validator already
  // replaced links and blocked words). Flagged, or the check failed: use the default name.
  if (course.name !== DEFAULT_NAME) {
    let nameOk = false;
    try {
      nameOk = (await withTimeout((signal) => deps.moderate([course.name], signal), moderationMs))[0] === false;
    } catch {
      nameOk = false;
    }
    if (!nameOk) course = { ...course, name: DEFAULT_NAME };
  }

  // Ride it before anyone else does. If even its simplest version can't be finished, don't serve it.
  const ridden = deps.ensure(course);
  if (!ridden.beatable) return fail(502, 'ai-failed', "The course designer couldn't make that one.");
  if (ridden.changes.length > 0) console.info(`[generate-course] simplified: ${ridden.changes.join('; ')}`);
  course = ridden.course;

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
