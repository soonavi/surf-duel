import { describe, expect, it } from 'vitest';
import { RATE_LIMIT, handleGenerate, type CourseRow, type CourseStore, type GenerateDeps } from './generateCourse';
import { createRng } from '../src/util/rng';

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

class FakeStore implements CourseStore {
  rows: CourseRow[] = [];
  requests: { ipHash: string; at: number }[] = [];
  takenCodes = new Set<string>();
  failInsert = false;
  failCount = false;
  constructor(private readonly now: () => number) {}
  async countRecent(ipHash: string, sinceMs: number): Promise<number> {
    if (this.failCount) throw new Error('db down');
    return this.requests.filter((r) => r.ipHash === ipHash && r.at >= sinceMs).length;
  }
  async logRequest(ipHash: string): Promise<void> {
    this.requests.push({ ipHash, at: this.now() });
  }
  async insertCourse(row: CourseRow): Promise<'ok' | 'duplicate'> {
    if (this.failInsert) throw new Error('db down');
    if (this.takenCodes.has(row.code)) return 'duplicate';
    this.rows.push(row);
    return 'ok';
  }
}

function setup(design: GenerateDeps['design'] = async () => GOOD) {
  let t = 1_000_000;
  const store = new FakeStore(() => t);
  const calls: string[] = [];
  const deps: GenerateDeps = {
    design: async (prompt, signal) => {
      calls.push(prompt);
      return design(prompt, signal);
    },
    store,
    hashIp: (ip) => `h:${ip}`,
    now: () => t,
    random: createRng(1),
  };
  return { deps, store, calls, advance: (ms: number) => (t += ms) };
}

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
      (_prompt, signal) =>
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

  it('falls back to a per-instance limit when the database is unreachable', async () => {
    const { deps, store } = setup();
    store.failCount = true;
    const statuses: number[] = [];
    for (let i = 0; i <= RATE_LIMIT.perWindow; i++) statuses.push((await handleGenerate({ prompt: 'a' }, '9.9.9.9', deps)).status);
    expect(statuses.slice(0, -1).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
