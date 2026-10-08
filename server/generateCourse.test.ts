import { describe, expect, it } from 'vitest';
import { BUDGET, RATE_LIMIT, handleGenerate, type ClaimLimits, type ClaimResult, type CourseRow, type CourseStore, type GenerateDeps } from './generateCourse.js';
import { createRng } from '../src/util/rng.js';
import { COURSE_SYSTEM_PROMPT, PROMPT_MAX_CHARS, courseJsonSchema, courseUserMessage } from '../src/course/aiSchema.js';
import { DIFFICULTIES, type Course } from '../src/course/schema.js';

const GOOD = {
  name: 'Molten Mile',
  theme: 'lava',
  difficulty: 'medium',
  segments: [
    { type: 'ramp', length: 5000, angle: 52, side: 'right', curve: 0 },
    { type: 'checkpoint' },
    { type: 'ramp', length: 5000, angle: 54, side: 'left', curve: 20 },
    { type: 'drop', height: 1500 },
    { type: 'ramp', length: 6000, angle: 54, side: 'right', curve: -20 },
  ],
};

const DAY_MS = 24 * 60 * 60_000;

/** Same rules as the claim_generation SQL function, in memory. */
class FakeStore implements CourseStore {
  rows: CourseRow[] = [];
  requests: { ipHash: string; at: number }[] = [];
  lifetimeTotal = 0;
  takenCodes = new Set<string>();
  failInsert = false;
  failClaim = false;
  lastLimits: ClaimLimits | null = null;
  constructor(private readonly now: () => number) {}
  async claim(ipHash: string, limits: ClaimLimits): Promise<ClaimResult> {
    if (this.failClaim) throw new Error('db down');
    this.lastLimits = limits;
    const t = this.now();
    const since = (ms: number, ip?: string) => this.requests.filter((r) => r.at > t - ms && (ip === undefined || r.ipHash === ip)).length;
    if (this.lifetimeTotal >= limits.lifetime) return 'lifetime';
    if (since(DAY_MS) >= limits.globalPerDay) return 'global-day';
    if (since(DAY_MS, ipHash) >= limits.perIpPerDay) return 'ip-day';
    if (since(limits.windowMs, ipHash) >= limits.perIpPerWindow) return 'ip-window';
    this.requests.push({ ipHash, at: t });
    this.lifetimeTotal++;
    return 'ok';
  }
  async insertCourse(row: CourseRow): Promise<'ok' | 'duplicate'> {
    if (this.failInsert) throw new Error('db down');
    if (this.takenCodes.has(row.code)) return 'duplicate';
    this.rows.push(row);
    return 'ok';
  }
}

function setup(
  design: GenerateDeps['design'] = async () => GOOD,
  moderate: GenerateDeps['moderate'] = async (texts) => texts.map(() => false),
  ensure: GenerateDeps['ensure'] = (course) => ({ course, changes: [], beatable: true }),
) {
  let t = 1_000_000;
  const store = new FakeStore(() => t);
  const calls: string[] = [];
  const difficulties: string[] = [];
  const moderated: string[] = [];
  const deps: GenerateDeps = {
    design: async (prompt, difficulty, signal) => {
      calls.push(prompt);
      difficulties.push(difficulty);
      return design(prompt, difficulty, signal);
    },
    moderate: async (texts, signal) => {
      moderated.push(...texts);
      return moderate(texts, signal);
    },
    store,
    hashIp: (ip) => `h:${ip}`,
    random: createRng(1),
    ensure,
  };
  return { deps, store, calls, difficulties, moderated, advance: (ms: number) => (t += ms) };
}

describe('handleGenerate: every course is ridden before it is served', () => {
  it('saves and returns the course as the check left it (simplified until its bots finish)', async () => {
    const checked: Course[] = [];
    const { deps, store } = setup(undefined, undefined, (course) => {
      checked.push(course);
      return { course: { ...course, segments: course.segments.filter((s) => s.type !== 'drop') }, changes: ['speed reined in'], beatable: true };
    });
    const res = await handleGenerate({ prompt: 'lava' }, '1.2.3.4', deps);
    expect(checked).toHaveLength(1);
    expect(checked[0]!.segments.some((s) => s.type === 'drop')).toBe(true);
    expect(res.body).toMatchObject({ ok: true });
    const served = (res.body as { course: Course }).course;
    expect(served.segments.some((s) => s.type === 'drop')).toBe(false);
    expect(store.rows[0]!.spec).toEqual(served);
  });

  it("refuses a course even the simplest version of which can't be finished, and doesn't save it", async () => {
    const { deps, store } = setup(undefined, undefined, (course) => ({ course, changes: ['walls and spiral removed'], beatable: false }));
    const res = await handleGenerate({ prompt: 'lava' }, '1.2.3.4', deps);
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ ok: false, reason: 'ai-failed' });
    expect(store.rows).toEqual([]);
  });
});

describe('handleGenerate: difficulty', () => {
  it('designs at the difficulty the player picked, whatever the model answers', async () => {
    const { deps, store, difficulties } = setup(async () => ({ ...GOOD, difficulty: 'easy' }));
    const res = await handleGenerate({ prompt: 'lava', difficulty: 'expert' }, '1.2.3.4', deps);
    expect(difficulties).toEqual(['expert']);
    expect(res.body).toMatchObject({ ok: true, course: { difficulty: 'expert' } });
    expect(store.rows[0]!.spec.difficulty).toBe('expert');
  });

  it('uses medium when an older client sends none', async () => {
    const { deps, difficulties } = setup(async () => ({ ...GOOD, difficulty: 'hard' }));
    const res = await handleGenerate({ prompt: 'lava' }, '1.2.3.4', deps);
    expect(difficulties).toEqual(['medium']);
    expect(res.body).toMatchObject({ ok: true, course: { difficulty: 'medium' } });
  });

  it("refuses a difficulty it doesn't know, before anything is spent", async () => {
    const { deps, calls, store } = setup();
    const res = await handleGenerate({ prompt: 'lava', difficulty: 'nightmare' }, '1.2.3.4', deps);
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
    expect(store.lifetimeTotal).toBe(0);
  });
});

describe('handleGenerate: the request', () => {
  it('needs a prompt', async () => {
    const { deps, calls } = setup();
    for (const body of [null, {}, { prompt: 42 }, { prompt: '   ' }]) {
      const res = await handleGenerate(body, '1.2.3.4', deps);
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it('turns away prompts over 200 characters without calling the AI', async () => {
    const { deps, calls } = setup();
    const res = await handleGenerate({ prompt: 'x'.repeat(201) }, '1.2.3.4', deps);
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('handleGenerate: success', () => {
  it('returns the validated course with a share code, and stores it', async () => {
    const { deps, store } = setup();
    const res = await handleGenerate({ prompt: '  lava,   one huge drop ' }, '1.2.3.4', deps);
    expect(res.status).toBe(200);
    if (!res.body.ok) throw new Error('expected success');
    expect(res.body.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(res.body.course.name).toBe('Molten Mile');
    expect(store.rows).toEqual([{ code: res.body.code, prompt: 'lava, one huge drop', spec: res.body.course }]);
  });

  it('repairs a course that breaks the rules instead of failing', async () => {
    const { deps } = setup(async () => ({ ...GOOD, segments: [{ type: 'ramp', length: 5000, angle: 85, side: 'right', curve: 0 }, ...GOOD.segments] }));
    const res = await handleGenerate({ prompt: 'steep' }, '1.2.3.4', deps);
    if (!res.body.ok) throw new Error('expected success');
    expect(res.body.repairs).toBeGreaterThan(0);
    expect(Math.max(...res.body.course.segments.flatMap((s) => (s.type === 'ramp' ? [s.angle] : [])))).toBeLessThanOrEqual(60);
  });

  it('tries another share code when one is taken', async () => {
    const { deps, store } = setup();
    const first = await handleGenerate({ prompt: 'a' }, '1.2.3.4', deps);
    if (!first.body.ok) throw new Error('expected success');
    store.takenCodes.add(first.body.code!);
    // Same seed again, so the first code it tries is the taken one.
    const again = await handleGenerate({ prompt: 'a' }, '1.2.3.4', { ...deps, random: createRng(1) });
    if (!again.body.ok) throw new Error('expected success');
    expect(again.body.code).not.toBe(first.body.code);
  });

  it('still hands back the course when saving it fails (no share code)', async () => {
    const { deps, store } = setup();
    store.failInsert = true;
    const res = await handleGenerate({ prompt: 'a' }, '1.2.3.4', deps);
    expect(res.status).toBe(200);
    if (!res.body.ok) throw new Error('expected success');
    expect(res.body.code).toBeNull();
  });
});

describe('handleGenerate: malicious or unsuitable prompts', () => {
  it('refuses links and blocked words before claiming anything or asking any AI', async () => {
    const { deps, store, calls, moderated } = setup();
    for (const prompt of ['free robux at robux-gift.xyz', 'sh1t canyon', 'f\u200Buck ramps']) {
      const res = await handleGenerate({ prompt }, '1.2.3.4', deps);
      expect(res.status, prompt).toBe(422);
      expect(res.body).toMatchObject({ ok: false, reason: 'rejected' });
    }
    expect(store.lifetimeTotal).toBe(0);
    expect(calls).toEqual([]);
    expect(moderated).toEqual([]);
  });

  it('strips hidden text and markup before any AI sees the prompt, and stores the cleaned one', async () => {
    const { deps, store, calls, moderated } = setup();
    const res = await handleGenerate({ prompt: 'icy \u202Erun\u202C <script>\u200B' }, '1.2.3.4', deps);
    expect(res.status).toBe(200);
    expect(moderated[0]).toBe('icy run script');
    expect(calls).toEqual(['icy run script']);
    expect(store.rows[0]!.prompt).toBe('icy run script');
  });

  it('runs the moderation check on the prompt before the course designer sees it', async () => {
    const { deps, store, calls } = setup(undefined, async (texts) => texts.map((t) => t.includes('massacre')));
    const res = await handleGenerate({ prompt: 'bloody massacre canyon' }, '1.2.3.4', deps);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ ok: false, reason: 'rejected' });
    expect(calls).toEqual([]);
    expect(store.lifetimeTotal).toBe(1); // it was claimed, so the moderation check can't be spammed past the rate limit
  });

  it('fails closed when the moderation check errors or hangs', async () => {
    const broken = setup(undefined, async () => {
      throw new Error('moderation down');
    });
    const res = await handleGenerate({ prompt: 'ice' }, '1.2.3.4', broken.deps);
    expect(res.status).toBe(503);
    expect(broken.calls).toEqual([]);

    const hung = setup(undefined, () => new Promise(() => {}));
    const late = await handleGenerate({ prompt: 'ice' }, '1.2.3.4', { ...hung.deps, moderationTimeoutMs: 20 });
    expect(late.status).toBe(503);
    expect(hung.calls).toEqual([]);
  });

  it('checks the AI-made course name too, and replaces it if flagged', async () => {
    const { deps, store, moderated } = setup(undefined, async (texts) => texts.map((t) => t === 'Molten Mile'));
    const res = await handleGenerate({ prompt: 'lava' }, '1.2.3.4', deps);
    if (!res.body.ok) throw new Error('expected success');
    expect(moderated).toEqual(['lava', 'Molten Mile']);
    expect(res.body.course.name).toBe('Untitled Course');
    expect(store.rows[0]!.spec.name).toBe('Untitled Course');
  });

  it('replaces the name if the name check fails (still fails closed)', async () => {
    let n = 0;
    const { deps } = setup(undefined, async (texts) => {
      if (n++ > 0) throw new Error('moderation down');
      return texts.map(() => false);
    });
    const res = await handleGenerate({ prompt: 'lava' }, '1.2.3.4', deps);
    if (!res.body.ok) throw new Error('expected success');
    expect(res.body.course.name).toBe('Untitled Course');
  });

  it('replaces an AI name with a link or blocked word even without asking', async () => {
    const { deps, moderated } = setup(async () => ({ ...GOOD, name: 'Free robux at evil.com' }));
    const res = await handleGenerate({ prompt: 'lava' }, '1.2.3.4', deps);
    if (!res.body.ok) throw new Error('expected success');
    expect(res.body.course.name).toBe('Untitled Course');
    expect(moderated).toEqual(['lava']);
  });
});

describe('handleGenerate: failures', () => {
  it('reports AI output that is not a course at all', async () => {
    const { deps } = setup(async () => 'sorry, I cannot help with that');
    const res = await handleGenerate({ prompt: 'a' }, '1.2.3.4', deps);
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ ok: false, reason: 'ai-failed' });
  });

  it('reports an AI error', async () => {
    const { deps } = setup(async () => {
      throw new Error('500 from upstream');
    });
    const res = await handleGenerate({ prompt: 'a' }, '1.2.3.4', deps);
    expect(res.body).toMatchObject({ ok: false, reason: 'ai-failed' });
  });

  it('gives up after the timeout and cancels the AI call', async () => {
    let aborted = false;
    const { deps } = setup(
      (_prompt, _difficulty, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    );
    const res = await handleGenerate({ prompt: 'a' }, '1.2.3.4', { ...deps, timeoutMs: 20 });
    expect(res.status).toBe(504);
    expect(res.body).toMatchObject({ ok: false, reason: 'timeout' });
    expect(aborted).toBe(true);
  });
});

describe('handleGenerate: rate limit', () => {
  it(`allows ${RATE_LIMIT.perWindow} generations per IP per window, then says when to retry`, async () => {
    const { deps, calls, advance } = setup();
    for (let i = 0; i < RATE_LIMIT.perWindow; i++) expect((await handleGenerate({ prompt: 'a' }, '1.2.3.4', deps)).status).toBe(200);
    const limited = await handleGenerate({ prompt: 'a' }, '1.2.3.4', deps);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ ok: false, reason: 'rate-limited' });
    expect(calls).toHaveLength(RATE_LIMIT.perWindow);
    // Someone else isn't affected, and the window moves on.
    expect((await handleGenerate({ prompt: 'a' }, '5.6.7.8', deps)).status).toBe(200);
    advance(RATE_LIMIT.windowMs + 1);
    expect((await handleGenerate({ prompt: 'a' }, '1.2.3.4', deps)).status).toBe(200);
  });

  it('counts failed attempts too (they still cost an AI call)', async () => {
    const { deps, store } = setup(async () => 'nope');
    await handleGenerate({ prompt: 'a' }, '1.2.3.4', deps);
    expect(store.requests).toHaveLength(1);
  });

  it('passes the limits to the database, which enforces them in one locked step', async () => {
    const { deps, store } = setup();
    await handleGenerate({ prompt: 'a' }, '1.2.3.4', deps);
    expect(store.lastLimits).toEqual({
      windowMs: RATE_LIMIT.windowMs,
      perIpPerWindow: RATE_LIMIT.perWindow,
      perIpPerDay: RATE_LIMIT.perDay,
      globalPerDay: BUDGET.perDay,
      lifetime: BUDGET.lifetime,
    });
  });
});

describe('handleGenerate: spending caps (all players together)', () => {
  it(`stops after ${BUDGET.perDay} generations a day across everyone`, async () => {
    const { deps, calls, advance } = setup();
    for (let i = 0; i < BUDGET.perDay; i++) {
      expect((await handleGenerate({ prompt: 'a' }, `10.0.${Math.floor(i / 200)}.${i % 200}`, deps)).status).toBe(200);
    }
    const capped = await handleGenerate({ prompt: 'a' }, '99.99.99.99', deps);
    expect(capped.status).toBe(429);
    expect(capped.body).toMatchObject({ ok: false, reason: 'budget' });
    expect(calls).toHaveLength(BUDGET.perDay);
    advance(DAY_MS + 1);
    expect((await handleGenerate({ prompt: 'a' }, '99.99.99.99', deps)).status).toBe(200);
  });

  it(`stops for good after ${BUDGET.lifetime} generations in total`, async () => {
    const { deps, store, calls } = setup();
    store.lifetimeTotal = BUDGET.lifetime;
    const res = await handleGenerate({ prompt: 'a' }, '1.2.3.4', deps);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ ok: false, reason: 'budget' });
    expect(calls).toEqual([]);
  });

  it('really does send fewer input tokens than the cost math assumes', () => {
    // Under 3 characters per token is a pessimistic count for English text and JSON.
    for (const d of DIFFICULTIES) {
      const chars = COURSE_SYSTEM_PROMPT.length + JSON.stringify(courseJsonSchema(d)).length + courseUserMessage('x'.repeat(PROMPT_MAX_CHARS), d).length;
      expect(chars / 3).toBeLessThan(BUDGET.maxInputTokens);
    }
  });

  it('keeps the worst case under the $5 prepaid credit at gpt-5.4-nano prices', () => {
    // $0.20 per million input tokens, $1.25 per million output tokens (Oct 2026).
    const worstCall = BUDGET.maxInputTokens * 0.2e-6 + BUDGET.maxOutputTokens * 1.25e-6;
    expect(worstCall * BUDGET.lifetime).toBeLessThan(5);
  });

  it('refuses to call the AI when it cannot check the caps (database down)', async () => {
    const { deps, store, calls } = setup();
    store.failClaim = true;
    const res = await handleGenerate({ prompt: 'a' }, '1.2.3.4', deps);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(calls).toEqual([]);
  });

  it('refuses to call the AI without a database at all', async () => {
    const { deps, calls } = setup();
    const res = await handleGenerate({ prompt: 'a' }, '1.2.3.4', { ...deps, store: null });
    expect(res.status).toBe(503);
    expect(calls).toEqual([]);
  });
});
