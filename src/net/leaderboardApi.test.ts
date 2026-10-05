import { describe, expect, it } from 'vitest';
import { fetchLeaderboard, fetchRunGhost, submitRun, type SubmitPayload } from './leaderboardApi.js';
import { encodeGhost } from '../game/ghost.js';

const ok = (data: unknown) => async () => ({ data, error: null });
const row = (over: Record<string, unknown> = {}) => ({
  id: 'b8a4c6a4-1111-4aaa-8bbb-222233334444',
  player_name: 'Wave Rider',
  time_ms: 21570,
  assist: false,
  checkpoint_splits: [5000, 12000],
  updated_at: '2026-10-06T10:00:00Z',
  ...over,
});

describe('fetchLeaderboard', () => {
  it('reads the top runs in order', async () => {
    const out = await fetchLeaderboard('c3-abc', 10, ok([row(), row({ id: 'x2', player_name: 'Bob', time_ms: 23000, assist: true })]));
    expect(out).toEqual({
      ok: true,
      entries: [
        { id: 'b8a4c6a4-1111-4aaa-8bbb-222233334444', name: 'Wave Rider', timeMs: 21570, assist: false },
        { id: 'x2', name: 'Bob', timeMs: 23000, assist: true },
      ],
    });
  });

  it('asks the database for the right course and size', async () => {
    let asked: unknown[] = [];
    await fetchLeaderboard('c3-abc', 5, async (key, limit) => {
      asked = [key, limit];
      return { data: [], error: null };
    });
    expect(asked).toEqual(['c3-abc', 5]);
  });

  it('cleans names again before showing them, and skips rows that make no sense', async () => {
    const out = await fetchLeaderboard('c3-abc', 10, ok([row({ player_name: 'sh1t lord' }), row({ time_ms: 'fast' }), row({ player_name: '‮evil‬' })]));
    expect(out.ok && out.entries.map((e) => e.name)).toEqual(['Surfer', 'evil']);
  });

  it('reports a failure instead of throwing', async () => {
    expect(await fetchLeaderboard('c3-abc', 10, async () => ({ data: null, error: { message: 'down' } }))).toEqual({ ok: false });
    expect(
      await fetchLeaderboard('c3-abc', 10, async () => {
        throw new Error('offline');
      }),
    ).toEqual({ ok: false });
  });
});

describe('fetchRunGhost', () => {
  const ghost = { rate: 20, samples: [{ x: 0, y: 0, z: 0, yaw: 0 }, { x: 10, y: 0, z: -40, yaw: 0.1 }] };

  it('decodes the ghost of one run', async () => {
    const out = await fetchRunGhost('id', ok({ ghost: encodeGhost(ghost), checkpoint_splits: [5000] }));
    expect(out?.ghost.samples).toHaveLength(2);
    expect(out?.splits).toEqual([5000]);
  });

  it('returns null for a missing or broken ghost', async () => {
    expect(await fetchRunGhost('id', ok(null))).toBeNull();
    expect(await fetchRunGhost('id', ok({ ghost: '***', checkpoint_splits: [] }))).toBeNull();
    expect(await fetchRunGhost('id', async () => ({ data: null, error: { message: 'down' } }))).toBeNull();
  });
});

describe('submitRun', () => {
  const payload: SubmitPayload = {
    course: { kind: 'shipped', id: 'speed-demon' },
    playerId: '6f1c1d2e-8a4b-4c3d-9e2f-1a2b3c4d5e6f',
    name: 'Wave Rider',
    timeMs: 21570,
    splits: [5000, 12000],
    ghost: 'AQ',
    assist: false,
  };
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('posts the run and reads the result', async () => {
    let sent: unknown = null;
    const spy = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ ok: true, improved: true, runId: 'r1', place: 2, total: 9, bestMs: 21570, name: 'Wave Rider' }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await submitRun(payload, { fetch: spy })).toEqual({ ok: true, improved: true, runId: 'r1', place: 2, total: 9, bestMs: 21570, name: 'Wave Rider' });
    expect(sent).toEqual({ url: '/api/submit-run', body: payload });
  });

  it("passes on the server's reason and message", async () => {
    const out = await submitRun(payload, { fetch: reply(422, { ok: false, reason: 'implausible', error: "That run didn't check out." }) });
    expect(out).toEqual({ ok: false, reason: 'implausible', message: "That run didn't check out." });
  });

  it('copes with no network, a timeout and nonsense replies', async () => {
    const offline = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await submitRun(payload, { fetch: offline })).toMatchObject({ ok: false, reason: 'network' });
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    expect(await submitRun(payload, { fetch: hang, timeoutMs: 20 })).toMatchObject({ ok: false, reason: 'network' });
    expect(await submitRun(payload, { fetch: reply(500, 'oops') })).toMatchObject({ ok: false, reason: 'unavailable' });
  });
});
