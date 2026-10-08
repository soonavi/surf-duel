import { describe, expect, it } from 'vitest';
import { LIKE_LIMITS, handleLike, type LikeDeps, type LikeLimits, type LikeOutcome, type LikeStore } from './likeCourse.js';

const PLAYER = '6f1c1d2e-8a4b-4c3d-9e2f-1a2b3c4d5e6f';
const OTHER = '0b9f3c2a-1d4e-4f5a-8b6c-7d8e9f0a1b2c';

/** Same rules as the like_course SQL function, in memory. */
class FakeLikeStore implements LikeStore {
  courses = new Set(['K7M2QX']);
  likes: { code: string; playerId: string; ipHash: string }[] = [];
  requests: string[] = [];
  fail = false;
  lastLimits: LikeLimits | null = null;

  async like(code: string, playerId: string, like: boolean, ipHash: string, limits: LikeLimits): Promise<LikeOutcome> {
    if (this.fail) throw new Error('db down');
    this.lastLimits = limits;
    if (!this.courses.has(code)) return { status: 'not-found' };
    if (this.requests.length >= limits.globalPerDay) return { status: 'global-day' };
    if (this.requests.filter((h) => h === ipHash).length >= limits.perIpWindow) return { status: 'ip-window' };
    this.requests.push(ipHash);
    const count = () => this.likes.filter((l) => l.code === code).length;
    const mine = this.likes.findIndex((l) => l.code === code && l.playerId === playerId);
    if (like && mine < 0) {
      if (this.likes.filter((l) => l.code === code && l.ipHash === ipHash).length >= limits.perIpCourse) return { status: 'ip-course', likes: count() };
      this.likes.push({ code, playerId, ipHash });
    }
    if (!like && mine >= 0) this.likes.splice(mine, 1);
    return { status: 'ok', liked: like, likes: count() };
  }
}

function setup() {
  const store = new FakeLikeStore();
  const deps: LikeDeps = { store, hashIp: (ip) => `hash:${ip}` };
  return { store, deps };
}

const body = (over: Record<string, unknown> = {}) => ({ code: 'K7M2QX', playerId: PLAYER, like: true, ...over });

describe('handleLike', () => {
  it('counts a like and reports the new total', async () => {
    const { deps, store } = setup();
    const res = await handleLike(body(), '1.2.3.4', deps);
    expect(res).toEqual({ status: 200, body: { ok: true, liked: true, likes: 1 } });
    expect(store.likes).toEqual([{ code: 'K7M2QX', playerId: PLAYER, ipHash: 'hash:1.2.3.4' }]);
  });

  it('counts one like per player, however often they press it', async () => {
    const { deps } = setup();
    await handleLike(body(), '1.2.3.4', deps);
    const again = await handleLike(body(), '1.2.3.4', deps);
    expect(again.body).toEqual({ ok: true, liked: true, likes: 1 });
  });

  it('takes a like back', async () => {
    const { deps } = setup();
    await handleLike(body(), '1.2.3.4', deps);
    await handleLike(body({ playerId: OTHER }), '5.6.7.8', deps);
    const undo = await handleLike(body({ like: false }), '1.2.3.4', deps);
    expect(undo.body).toEqual({ ok: true, liked: false, likes: 1 });
  });

  it('reads share codes the way players type them', async () => {
    const { deps } = setup();
    expect((await handleLike(body({ code: 'k7m2qx' }), '1.2.3.4', deps)).status).toBe(200);
  });

  it('refuses malformed requests before touching the database', async () => {
    const { deps, store } = setup();
    for (const bad of [null, 'like', body({ code: 'NOPE!!' }), body({ playerId: 'me' }), body({ like: 'yes' }), { code: 'K7M2QX' }]) {
      const res = await handleLike(bad, '1.2.3.4', deps);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ ok: false, reason: 'bad-request' });
    }
    expect(store.requests).toEqual([]);
  });

  it('says so when the course does not exist', async () => {
    const { deps } = setup();
    const res = await handleLike(body({ code: 'ZZZZZZ' }), '1.2.3.4', deps);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('rate-limits one network', async () => {
    const { deps, store } = setup();
    for (let i = 0; i < LIKE_LIMITS.perIpWindow; i++) await handleLike(body({ like: i % 2 === 0 }), '1.2.3.4', deps);
    const res = await handleLike(body(), '1.2.3.4', deps);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ ok: false, reason: 'rate-limited' });
    expect(store.lastLimits).toEqual({ windowMs: LIKE_LIMITS.windowMs, perIpWindow: LIKE_LIMITS.perIpWindow, perIpCourse: LIKE_LIMITS.perIpCourse, globalPerDay: LIKE_LIMITS.globalPerDay });
  });

  it('lets only a few players on one network like the same course (no stuffing it with made-up ids)', async () => {
    const { deps } = setup();
    for (let i = 0; i < LIKE_LIMITS.perIpCourse; i++) {
      const id = `${i}a1f3c2a-1d4e-4f5a-8b6c-7d8e9f0a1b2c`;
      expect((await handleLike(body({ playerId: id }), '1.2.3.4', deps)).status).toBe(200);
    }
    const res = await handleLike(body({ playerId: OTHER }), '1.2.3.4', deps);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ ok: false, reason: 'rate-limited' });
  });

  it('fails softly without a database, or when it is down', async () => {
    const { deps, store } = setup();
    expect((await handleLike(body(), '1.2.3.4', { ...deps, store: null })).status).toBe(503);
    store.fail = true;
    const res = await handleLike(body(), '1.2.3.4', deps);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, reason: 'unavailable' });
  });
});
