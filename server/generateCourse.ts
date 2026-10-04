/**
 * POST /api/generate-course, minus the HTTP plumbing: validate the prompt,
 * rate-limit by IP, ask the AI for a course (with a hard timeout), repair it
 * with the same validator the game uses, and save it under a share code.
 *
 * Everything with side effects (the AI, the database, the clock) is passed
 * in, so every failure path is unit-tested. The game never dead-ends on a
 * failure here: the client offers a random course instead.
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
const DAY_MS = 24 * 60 * 60_000;
const CODE_ATTEMPTS = 5;

export interface CourseRow {
  code: string;
  prompt: string;
  spec: Course;
}

export interface CourseStore {
  /** Generation attempts from this IP hash since `sinceMs` (epoch ms). */
  countRecent(ipHash: string, sinceMs: number): Promise<number>;
  logRequest(ipHash: string): Promise<void>;
  insertCourse(row: CourseRow): Promise<'ok' | 'duplicate'>;
}

/** Asks the AI for a course; returns its raw (unvalidated) JSON. Must stop when `signal` aborts. */
export type CourseDesigner = (prompt: string, signal: AbortSignal) => Promise<unknown>;

export interface GenerateDeps {
  design: CourseDesigner;
  /** null when the database isn't configured: courses still generate, just without share codes. */
  store: CourseStore | null;
  hashIp: (ip: string) => string;
  now: () => number;
  random: () => number;
  timeoutMs?: number;
}

export type FailureReason = 'bad-request' | 'rate-limited' | 'timeout' | 'ai-failed';

export type GenerateResult =
  | { status: 200; body: { ok: true; code: string | null; course: Course; prompt: string; repairs: number } }
  | { status: 400 | 429 | 502 | 504; body: { ok: false; reason: FailureReason; error: string } };

const Request = z.object({ prompt: z.string() });

const fail = (status: 400 | 429 | 502 | 504, reason: FailureReason, error: string): GenerateResult => ({
  status,
  body: { ok: false, reason, error },
});

/**
 * Per-instance fallback for when the database can't be reached. Serverless
 * instances come and go, so this is a backstop, not the real limit.
 */
const memoryLog = new Map<string, number[]>();

function memoryCount(ipHash: string, sinceMs: number): number {
  return (memoryLog.get(ipHash) ?? []).filter((t) => t >= sinceMs).length;
}

function memoryLogRequest(ipHash: string, now: number): void {
  const recent = (memoryLog.get(ipHash) ?? []).filter((t) => t >= now - DAY_MS);
  recent.push(now);
  memoryLog.set(ipHash, recent);
}

export async function handleGenerate(body: unknown, ip: string, deps: GenerateDeps): Promise<GenerateResult> {
  const parsed = Request.safeParse(body);
  if (!parsed.success) return fail(400, 'bad-request', 'Type a description of the course you want.');
  const raw = parsed.data.prompt.trim();
  if (raw.length === 0) return fail(400, 'bad-request', 'Type a description of the course you want.');
  if (Array.from(raw).length > PROMPT_MAX_CHARS) return fail(400, 'bad-request', `Keep it under ${PROMPT_MAX_CHARS} characters.`);
  const prompt = cleanText(raw, PROMPT_MAX_CHARS);

  // Rate limit before spending anything on the AI.
  const ipHash = deps.hashIp(ip);
  const now = deps.now();
  let inWindow: number;
  let inDay: number;
  let useDb = deps.store !== null;
  try {
    if (!deps.store) throw new Error('no store');
    [inWindow, inDay] = await Promise.all([
      deps.store.countRecent(ipHash, now - RATE_LIMIT.windowMs),
      deps.store.countRecent(ipHash, now - DAY_MS),
    ]);
  } catch {
    useDb = false;
    inWindow = memoryCount(ipHash, now - RATE_LIMIT.windowMs);
    inDay = memoryCount(ipHash, now - DAY_MS);
  }
  if (inDay >= RATE_LIMIT.perDay) {
    return fail(429, 'rate-limited', "That's a lot of courses for one day! Race some of them, or try a random course.");
  }
  if (inWindow >= RATE_LIMIT.perWindow) {
    return fail(429, 'rate-limited', "You're generating courses fast! Give it a few minutes, or race a random course meanwhile.");
  }
  if (useDb) {
    await deps.store!.logRequest(ipHash).catch(() => memoryLogRequest(ipHash, now));
  } else {
    memoryLogRequest(ipHash, now);
  }

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
  if (deps.store) {
    try {
      for (let i = 0; i < CODE_ATTEMPTS && code === null; i++) {
        const candidate = generateShareCode(deps.random);
        if ((await deps.store.insertCourse({ code: candidate, prompt, spec: course })) === 'ok') code = candidate;
      }
    } catch {
      code = null;
    }
  }

  return { status: 200, body: { ok: true, code, course, prompt, repairs: repairs.length } };
}
