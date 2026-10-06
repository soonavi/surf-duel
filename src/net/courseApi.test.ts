import { describe, expect, it } from 'vitest';
import { fetchSharedCourse, requestCourse, type CourseQuery } from './courseApi.js';

const SPEC = {
  name: 'Ice Ribbon',
  theme: 'ice',
  difficulty: 'easy',
  segments: [
    { type: 'ramp', length: 4000, angle: 48, side: 'right', curve: 0 },
    { type: 'ramp', length: 4000, angle: 48, side: 'left', curve: 0 },
  ],
};

const respond = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as typeof fetch;

describe('requestCourse', () => {
  it('returns the course (re-validated), its share code and prompt', async () => {
    const out = await requestCourse('icy', { fetch: respond(200, { ok: true, code: 'K7M2QX', course: SPEC, prompt: 'icy', repairs: 0 }) });
    expect(out).toMatchObject({ ok: true, value: { code: 'K7M2QX', prompt: 'icy', course: { name: 'Ice Ribbon' } } });
  });

  it("never trusts the server's course blindly", async () => {
    const bad = { ...SPEC, segments: [{ type: 'ramp', length: 4000, angle: 89, side: 'right', curve: 0 }, ...SPEC.segments] };
    const out = await requestCourse('x', { fetch: respond(200, { ok: true, code: null, course: bad, prompt: 'x', repairs: 0 }) });
    if (!out.ok) throw new Error('expected success');
    expect(out.value.course.segments[0]).toMatchObject({ angle: 60 });
  });

  it("passes on the server's friendly error", async () => {
    const out = await requestCourse('x', { fetch: respond(429, { ok: false, reason: 'rate-limited', error: 'Slow down!' }) });
    expect(out).toEqual({ ok: false, reason: 'rate-limited', message: 'Slow down!' });
  });

  it('copes with a broken reply', async () => {
    const out = await requestCourse('x', { fetch: respond(500, '<html>oops</html>') });
    expect(out).toMatchObject({ ok: false, reason: 'ai-failed' });
  });

  it('reports a network failure', async () => {
    const out = await requestCourse('x', {
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as typeof fetch,
    });
    expect(out).toMatchObject({ ok: false, reason: 'network' });
  });

  it('gives up after its own timeout', async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch;
    const out = await requestCourse('x', { fetch: hang, timeoutMs: 20 });
    expect(out).toMatchObject({ ok: false, reason: 'timeout' });
  });
});

describe('fetchSharedCourse', () => {
  const query = (result: Awaited<ReturnType<CourseQuery>>): CourseQuery => async () => result;

  it('rejects a malformed code without asking the database', async () => {
    let asked = false;
    const out = await fetchSharedCourse('nope', async () => {
      asked = true;
      return { data: null, error: null };
    });
    expect(out).toEqual({ ok: false, reason: 'invalid-code' });
    expect(asked).toBe(false);
  });

  it('loads and validates a shared course', async () => {
    const out = await fetchSharedCourse('k7m-2qx', query({ data: { code: 'K7M2QX', prompt: 'icy', spec: SPEC }, error: null }));
    expect(out).toMatchObject({ ok: true, value: { code: 'K7M2QX', prompt: 'icy', course: { name: 'Ice Ribbon' } } });
  });

  it('says when no course has that code', async () => {
    expect(await fetchSharedCourse('K7M2QX', query({ data: null, error: null }))).toEqual({ ok: false, reason: 'not-found' });
  });

  it('reports database errors as a network problem', async () => {
    expect(await fetchSharedCourse('K7M2QX', query({ data: null, error: { message: 'boom' } }))).toEqual({ ok: false, reason: 'network' });
  });
});

describe('requestCourse: prompt checks in the browser', () => {
  it('refuses links and blocked words without contacting the server', async () => {
    let fetched = false;
    const fetchSpy = (async () => {
      fetched = true;
      throw new Error('should not be called');
    }) as unknown as typeof fetch;
    for (const prompt of ['free robux at robux-gift.xyz', 'sh1t canyon']) {
      const out = await requestCourse(prompt, { fetch: fetchSpy });
      expect(out).toMatchObject({ ok: false, reason: 'rejected' });
    }
    expect(fetched).toBe(false);
  });

  it('sends the cleaned prompt', async () => {
    let sent: unknown = null;
    const fetchSpy = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ok: false, reason: 'unavailable', error: 'x' }), { status: 503 });
    }) as unknown as typeof fetch;
    await requestCourse('  icy \u202Erun\u202C <b>', { fetch: fetchSpy });
    expect(sent).toEqual({ prompt: 'icy run b', difficulty: 'medium' });
  });

  it('sends the difficulty the player picked', async () => {
    let sent: unknown = null;
    const fetchSpy = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ok: false, reason: 'unavailable', error: 'x' }), { status: 503 });
    }) as unknown as typeof fetch;
    await requestCourse('icy', { fetch: fetchSpy, difficulty: 'expert' });
    expect(sent).toEqual({ prompt: 'icy', difficulty: 'expert' });
  });

  it("understands the server's 'rejected' reason", async () => {
    const fetchSpy = (async () =>
      new Response(JSON.stringify({ ok: false, reason: 'rejected', error: "Let's keep it friendly." }), { status: 422 })) as unknown as typeof fetch;
    expect(await requestCourse('ice', { fetch: fetchSpy })).toEqual({ ok: false, reason: 'rejected', message: "Let's keep it friendly." });
  });
});

describe('fetchSharedCourse: the saved prompt', () => {
  const row = (prompt: string) => async () => ({ data: { code: 'ABCDEF', prompt, spec: {} }, error: null });

  it('is cleaned before it is shown', async () => {
    const out = await fetchSharedCourse('ABCDEF', row('icy \u202Erun\u202C\u200B'));
    expect(out.ok && out.value.prompt).toBe('icy run');
  });

  it('is hidden if it holds a link or a blocked word (defence in depth: the server refuses those)', async () => {
    for (const prompt of ['visit evil.com', 'sh1t canyon']) {
      const out = await fetchSharedCourse('ABCDEF', row(prompt));
      expect(out.ok && out.value.prompt, prompt).toBeNull();
    }
  });
});
