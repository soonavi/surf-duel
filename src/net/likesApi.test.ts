import { describe, expect, it } from 'vitest';
import { LikedCourses, fetchPopular, sendLike, type PopularQuery } from './likesApi.js';
import type { KeyValueStorage } from '../game/records.js';

const PLAYER = '6f1c1d2e-8a4b-4c3d-9e2f-1a2b3c4d5e6f';

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

describe('sendLike', () => {
  it('posts the like and returns the new count', async () => {
    let sent: unknown = null;
    const spy = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ ok: true, liked: true, likes: 4 }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await sendLike('K7M2QX', PLAYER, true, { fetch: spy })).toEqual({ ok: true, liked: true, likes: 4 });
    expect(sent).toEqual({ code: 'K7M2QX', playerId: PLAYER, like: true });
  });

  it("passes on the server's friendly error", async () => {
    const out = await sendLike('K7M2QX', PLAYER, true, { fetch: respond(429, { ok: false, reason: 'rate-limited', error: 'Slow down!' }) });
    expect(out).toEqual({ ok: false, message: 'Slow down!' });
  });

  it('copes with a broken reply or no network', async () => {
    expect(await sendLike('K7M2QX', PLAYER, true, { fetch: respond(500, '<html>') })).toMatchObject({ ok: false });
    const offline = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await sendLike('K7M2QX', PLAYER, true, { fetch: offline })).toMatchObject({ ok: false });
  });
});

describe('fetchPopular', () => {
  const query = (data: unknown, error: { message: string } | null = null): PopularQuery => async () => ({ data, error });

  it('returns validated courses, most liked first, as the database sent them', async () => {
    const out = await fetchPopular(8, query([
      { code: 'K7M2QX', prompt: 'icy', likes: 5, spec: SPEC },
      { code: 'ABCDEF', prompt: 'more ice', likes: 0, spec: { ...SPEC, name: 'Second' } },
    ]));
    expect(out).toMatchObject({ ok: true, courses: [
      { code: 'K7M2QX', prompt: 'icy', likes: 5, course: { name: 'Ice Ribbon', difficulty: 'easy' } },
      { code: 'ABCDEF', likes: 0, course: { name: 'Second' } },
    ] });
  });

  it('repairs what it reads and skips rows it cannot use', async () => {
    const steep = { ...SPEC, segments: [{ type: 'ramp', length: 4000, angle: 89, side: 'right', curve: 0 }, ...SPEC.segments] };
    const out = await fetchPopular(8, query([
      { code: 'K7M2QX', prompt: 'icy', likes: 1, spec: steep },
      { code: 'nope', prompt: 'x', likes: 1, spec: SPEC },
      { code: 'ABCDEF', prompt: 'x', likes: -3, spec: SPEC },
      'junk',
    ]));
    if (!out.ok) throw new Error('expected success');
    expect(out.courses).toHaveLength(1);
    expect(out.courses[0]!.course.segments[0]).toMatchObject({ angle: 60 });
  });

  it('hides a prompt it should not show', async () => {
    const out = await fetchPopular(8, query([{ code: 'K7M2QX', prompt: 'visit cheats.xyz', likes: 1, spec: SPEC }]));
    if (!out.ok) throw new Error('expected success');
    expect(out.courses[0]!.prompt).toBeNull();
  });

  it('reports a database error', async () => {
    expect(await fetchPopular(8, query(null, { message: 'down' }))).toEqual({ ok: false });
    const throws: PopularQuery = async () => {
      throw new Error('offline');
    };
    expect(await fetchPopular(8, throws)).toEqual({ ok: false });
  });
});

describe('LikedCourses', () => {
  const memory = (): KeyValueStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };

  it('remembers what you liked, across visits', () => {
    const storage = memory();
    const liked = new LikedCourses(storage);
    expect(liked.has('K7M2QX')).toBe(false);
    liked.set('K7M2QX', true);
    expect(new LikedCourses(storage).has('K7M2QX')).toBe(true);
    liked.set('K7M2QX', false);
    expect(new LikedCourses(storage).has('K7M2QX')).toBe(false);
  });

  it('ignores stored junk and works without storage', () => {
    const storage = memory();
    storage.data.set('surfduel.likes.v1', '{"not":"a list"}');
    expect(new LikedCourses(storage).has('K7M2QX')).toBe(false);
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const liked = new LikedCourses(broken);
    liked.set('K7M2QX', true);
    expect(liked.has('K7M2QX')).toBe(true);
  });
});
